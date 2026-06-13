use memmap2::MmapOptions;
use napi::{Error, Result};
use napi_derive::napi;
use sha2::{Digest, Sha256};
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

const MAX_ASAR_HEADER_SIZE: usize = 128 * 1024 * 1024;
const INTEGRITY_MARKER: &[u8] = br#""file":"resources\\app.asar""#;
const VALUE_MARKER: &[u8] = br#""value":""#;
const SHA256_HEX_LENGTH: usize = 64;

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn digest_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(SHA256_HEX_LENGTH);
    for byte in digest {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn read_asar_header_string(path: &Path) -> std::result::Result<Vec<u8>, String> {
    let mut file = File::open(path)
        .map_err(|error| format!("Failed to open ASAR '{}': {error}", path.display()))?;
    let mut size_pickle = [0_u8; 8];
    file.read_exact(&mut size_pickle)
        .map_err(|error| format!("Unable to read ASAR header size: {error}"))?;

    let header_size =
        u32::from_le_bytes(size_pickle[4..8].try_into().expect("fixed slice")) as usize;
    if !(8..=MAX_ASAR_HEADER_SIZE).contains(&header_size) {
        return Err(format!("Invalid ASAR header size: {header_size}"));
    }

    file.seek(SeekFrom::Start(8))
        .map_err(|error| format!("Unable to seek to ASAR header: {error}"))?;
    let mut header_pickle = vec![0_u8; header_size];
    file.read_exact(&mut header_pickle)
        .map_err(|error| format!("Unable to read ASAR header: {error}"))?;

    if header_pickle.len() < 8 {
        return Err("ASAR header pickle is truncated".to_owned());
    }
    let payload_size =
        u32::from_le_bytes(header_pickle[0..4].try_into().expect("fixed slice")) as usize;
    let string_size =
        u32::from_le_bytes(header_pickle[4..8].try_into().expect("fixed slice")) as usize;
    let string_end = 8_usize
        .checked_add(string_size)
        .ok_or_else(|| "ASAR header string size overflow".to_owned())?;

    if payload_size > header_pickle.len().saturating_sub(4) || string_end > header_pickle.len() {
        return Err("ASAR header pickle contains invalid lengths".to_owned());
    }

    let header_string = header_pickle[8..string_end].to_vec();
    std::str::from_utf8(&header_string)
        .map_err(|error| format!("ASAR header is not valid UTF-8: {error}"))?;
    Ok(header_string)
}

fn calculate_header_hash(path: &Path) -> std::result::Result<String, String> {
    read_asar_header_string(path).map(|header| digest_hex(&header))
}

#[napi]
pub fn calculate_asar_header_hash(path: String) -> Result<String> {
    calculate_header_hash(Path::new(&path)).map_err(Error::from_reason)
}

#[napi]
pub fn patch_windows_integrity(exe_path: String, asar_path: String) -> Result<String> {
    let hash = calculate_header_hash(Path::new(&asar_path)).map_err(Error::from_reason)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&exe_path)
        .map_err(|error| {
            Error::from_reason(format!("Failed to open executable '{exe_path}': {error}"))
        })?;
    let mut map = unsafe { MmapOptions::new().map_mut(&file) }.map_err(|error| {
        Error::from_reason(format!("Failed to map executable '{exe_path}': {error}"))
    })?;

    let marker_offset = find_bytes(&map, INTEGRITY_MARKER)
        .ok_or_else(|| Error::from_reason("resources\\app.asar integrity record not found"))?;
    let object_start = map[..marker_offset]
        .iter()
        .rposition(|byte| *byte == b'{')
        .ok_or_else(|| Error::from_reason("Integrity JSON object start not found"))?;
    let object_end = map[marker_offset..]
        .iter()
        .position(|byte| *byte == b'}')
        .map(|offset| marker_offset + offset)
        .ok_or_else(|| Error::from_reason("Integrity JSON object end not found"))?;
    let object = &map[object_start..=object_end];
    let value_marker_offset = find_bytes(object, VALUE_MARKER)
        .map(|offset| object_start + offset)
        .ok_or_else(|| Error::from_reason("Integrity value field not found"))?;
    let value_offset = value_marker_offset + VALUE_MARKER.len();
    let value_end = value_offset + SHA256_HEX_LENGTH;

    if value_end >= map.len() || map[value_end] != b'"' {
        return Err(Error::from_reason(
            "Integrity SHA-256 value has unexpected length",
        ));
    }
    if !map[value_offset..value_end]
        .iter()
        .all(u8::is_ascii_hexdigit)
    {
        return Err(Error::from_reason(
            "Integrity value is not a SHA-256 hex string",
        ));
    }

    map[value_offset..value_end].copy_from_slice(hash.as_bytes());
    map.flush_range(value_offset, SHA256_HEX_LENGTH)
        .map_err(|error| {
            Error::from_reason(format!(
                "Failed to flush executable integrity patch: {error}"
            ))
        })?;
    Ok(hash)
}
