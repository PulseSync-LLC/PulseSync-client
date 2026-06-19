use memmap2::MmapOptions;
use napi::{Error, Result};
use napi_derive::napi;
#[cfg(target_os = "macos")]
use plist::Value;
use serde_json::Value;
use sha2::{Digest, Sha256};
#[cfg(target_os = "macos")]
use std::fs;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
#[cfg(target_os = "macos")]
use std::process::Command;

const MAX_ASAR_HEADER_SIZE: usize = 128 * 1024 * 1024;
const INTEGRITY_MARKER: &[u8] = br#""file":"resources\\app.asar""#;
const VALUE_MARKER: &[u8] = br#""value":""#;
const SHA256_HEX_LENGTH: usize = 64;
const MAX_ASAR_PACKAGE_JSON_SIZE: usize = 1024 * 1024;

struct AsarHeader {
    json: Vec<u8>,
    pickle_size: usize,
}

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

fn read_asar_header(file: &mut File) -> std::result::Result<AsarHeader, String> {
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
    Ok(AsarHeader {
        json: header_string,
        pickle_size: header_size,
    })
}

fn read_asar_header_string(path: &Path) -> std::result::Result<Vec<u8>, String> {
    let mut file = File::open(path)
        .map_err(|error| format!("Failed to open ASAR '{}': {error}", path.display()))?;
    read_asar_header(&mut file).map(|header| header.json)
}

fn calculate_header_hash(path: &Path) -> std::result::Result<String, String> {
    read_asar_header_string(path).map(|header| digest_hex(&header))
}

#[napi]
pub fn calculate_asar_header_hash(path: String) -> Result<String> {
    calculate_header_hash(Path::new(&path)).map_err(Error::from_reason)
}

fn read_asar_version_impl(path: &Path) -> std::result::Result<String, String> {
    let package_json = {
        let mut file = File::open(path)
            .map_err(|error| format!("Failed to open ASAR '{}': {error}", path.display()))?;
        let header = read_asar_header(&mut file)?;
        let header_json: Value = serde_json::from_slice(&header.json)
            .map_err(|error| format!("Failed to parse ASAR header JSON: {error}"))?;
        let package_entry = header_json
            .get("files")
            .and_then(Value::as_object)
            .and_then(|files| files.get("package.json"))
            .ok_or_else(|| "package.json was not found in ASAR header".to_owned())?;
        if package_entry
            .get("unpacked")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            return Err("Unpacked package.json is not supported".to_owned());
        }

        let package_size = package_entry
            .get("size")
            .and_then(Value::as_u64)
            .ok_or_else(|| "ASAR package.json size is missing".to_owned())?;
        let package_size = usize::try_from(package_size)
            .map_err(|_| "ASAR package.json size is too large".to_owned())?;
        if package_size == 0 || package_size > MAX_ASAR_PACKAGE_JSON_SIZE {
            return Err(format!("Invalid ASAR package.json size: {package_size}"));
        }
        let package_offset = package_entry
            .get("offset")
            .and_then(Value::as_str)
            .ok_or_else(|| "ASAR package.json offset is missing".to_owned())?
            .parse::<u64>()
            .map_err(|error| format!("Invalid ASAR package.json offset: {error}"))?;
        let data_offset = 8_u64
            .checked_add(header.pickle_size as u64)
            .and_then(|offset| offset.checked_add(package_offset))
            .ok_or_else(|| "ASAR package.json offset overflow".to_owned())?;

        file.seek(SeekFrom::Start(data_offset))
            .map_err(|error| format!("Unable to seek to ASAR package.json: {error}"))?;
        let mut package_json = vec![0_u8; package_size];
        file.read_exact(&mut package_json)
            .map_err(|error| format!("Unable to read ASAR package.json: {error}"))?;
        package_json
    };

    let package: Value = serde_json::from_slice(&package_json)
        .map_err(|error| format!("Failed to parse ASAR package.json: {error}"))?;
    let version = package
        .get("modification")
        .and_then(|modification| modification.get("realYMVersion"))
        .and_then(Value::as_str)
        .or_else(|| package.get("version").and_then(Value::as_str))
        .map(str::trim)
        .filter(|version| !version.is_empty())
        .ok_or_else(|| "ASAR package.json does not contain a version".to_owned())?;
    Ok(version.to_owned())
}

#[napi]
pub fn read_asar_version(path: String) -> Result<String> {
    read_asar_version_impl(Path::new(&path)).map_err(Error::from_reason)
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

#[cfg(target_os = "macos")]
fn update_mac_info_plist(
    info_plist_path: &Path,
    asar_path: &Path,
) -> std::result::Result<String, String> {
    let hash = calculate_header_hash(asar_path)?;
    let mut plist = Value::from_file(info_plist_path).map_err(|error| {
        format!(
            "Failed to read Info.plist '{}': {error}",
            info_plist_path.display()
        )
    })?;
    let root = plist
        .as_dictionary_mut()
        .ok_or_else(|| "Info.plist root is not a dictionary".to_owned())?;
    let integrity = root
        .get_mut("ElectronAsarIntegrity")
        .and_then(Value::as_dictionary_mut)
        .ok_or_else(|| "ElectronAsarIntegrity is missing from Info.plist".to_owned())?;
    let app_asar = integrity
        .get_mut("Resources/app.asar")
        .and_then(Value::as_dictionary_mut)
        .ok_or_else(|| {
            "Resources/app.asar integrity entry is missing from Info.plist".to_owned()
        })?;

    app_asar.insert("hash".to_owned(), Value::String(hash.clone()));
    let output = File::create(info_plist_path).map_err(|error| {
        format!(
            "Failed to open Info.plist '{}' for writing: {error}",
            info_plist_path.display()
        )
    })?;
    plist
        .to_writer_xml(output)
        .map_err(|error| format!("Failed to write Info.plist: {error}"))?;
    Ok(hash)
}

#[cfg(target_os = "macos")]
fn command_output(command: &mut Command, action: &str) -> std::result::Result<Vec<u8>, String> {
    let output = command
        .output()
        .map_err(|error| format!("Failed to run {action}: {error}"))?;
    if output.status.success() {
        return Ok(output.stdout);
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("exit status {}", output.status)
    };
    Err(format!("Failed to {action}: {detail}"))
}

#[cfg(target_os = "macos")]
fn dump_mac_entitlements(
    app_bundle_path: &Path,
    entitlements_path: &Path,
) -> std::result::Result<(), String> {
    let mut command = Command::new("codesign");
    command
        .arg("-d")
        .arg("--entitlements")
        .arg(":-")
        .arg(app_bundle_path);
    let entitlements = command_output(&mut command, "dump macOS code signing entitlements")?;
    if entitlements.is_empty() {
        return Err("codesign returned empty entitlements".to_owned());
    }
    if let Some(parent) = entitlements_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create entitlements directory '{}': {error}",
                parent.display()
            )
        })?;
    }
    fs::write(entitlements_path, entitlements).map_err(|error| {
        format!(
            "Failed to write entitlements '{}': {error}",
            entitlements_path.display()
        )
    })
}

#[cfg(target_os = "macos")]
fn sign_mac_app(
    app_bundle_path: &Path,
    entitlements_path: &Path,
) -> std::result::Result<(), String> {
    let mut command = Command::new("codesign");
    command
        .arg("--force")
        .arg("--entitlements")
        .arg(entitlements_path)
        .arg("--sign")
        .arg("-")
        .arg(app_bundle_path);
    command_output(&mut command, "re-sign macOS application").map(|_| ())
}

#[napi]
#[cfg(target_os = "macos")]
pub fn patch_mac_integrity(
    app_bundle_path: String,
    asar_path: String,
    entitlements_path: String,
) -> Result<String> {
    let app_bundle_path = Path::new(&app_bundle_path);
    let asar_path = Path::new(&asar_path);
    let entitlements_path = Path::new(&entitlements_path);
    let info_plist_path = app_bundle_path.join("Contents").join("Info.plist");

    let hash = update_mac_info_plist(&info_plist_path, asar_path).map_err(Error::from_reason)?;
    let result = dump_mac_entitlements(app_bundle_path, entitlements_path)
        .and_then(|_| sign_mac_app(app_bundle_path, entitlements_path));
    let _ = fs::remove_file(entitlements_path);
    result.map_err(Error::from_reason)?;
    Ok(hash)
}

#[napi]
#[cfg(not(target_os = "macos"))]
pub fn patch_mac_integrity(
    _app_bundle_path: String,
    _asar_path: String,
    _entitlements_path: String,
) -> Result<String> {
    Err(Error::from_reason(
        "macOS integrity patching is only available on macOS",
    ))
}
