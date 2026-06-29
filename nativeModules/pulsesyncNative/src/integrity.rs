use memmap2::MmapOptions;
use napi::{Error, Result};
use napi_derive::napi;
#[cfg(target_os = "macos")]
use plist::Value as PlistValue;
use serde_json::Value;
use sha2::{Digest, Sha256};
#[cfg(target_os = "macos")]
use std::fs;
use std::fs::{File, OpenOptions};
#[cfg(target_os = "macos")]
use std::io::Write;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;
#[cfg(target_os = "macos")]
use std::process::Command;
use std::thread;
use std::time::Duration;

const MAX_ASAR_HEADER_SIZE: usize = 128 * 1024 * 1024;
const INTEGRITY_MARKER: &[u8] = br#""file":"resources\\app.asar""#;
const VALUE_MARKER: &[u8] = br#""value":""#;
const SHA256_HEX_LENGTH: usize = 64;
const MAX_ASAR_PACKAGE_JSON_SIZE: usize = 1024 * 1024;
const WINDOWS_INTEGRITY_OPEN_ATTEMPTS: u32 = 8;
const WINDOWS_INTEGRITY_OPEN_BACKOFF_MS: u64 = 200;

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

fn is_windows_lock_error(error: &io::Error) -> bool {
    cfg!(windows) && matches!(error.raw_os_error(), Some(32 | 33))
}

fn open_windows_integrity_executable(exe_path: &str) -> Result<File> {
    let attempts = if cfg!(windows) {
        WINDOWS_INTEGRITY_OPEN_ATTEMPTS
    } else {
        1
    };

    for attempt in 1..=attempts {
        match OpenOptions::new().read(true).write(true).open(exe_path) {
            Ok(file) => return Ok(file),
            Err(error) => {
                if is_windows_lock_error(&error) && attempt < attempts {
                    thread::sleep(Duration::from_millis(
                        WINDOWS_INTEGRITY_OPEN_BACKOFF_MS * u64::from(attempt),
                    ));
                    continue;
                }

                let attempts_suffix = if attempt > 1 {
                    format!(" after {attempt} attempts")
                } else {
                    String::new()
                };
                return Err(Error::from_reason(format!(
                    "Failed to open executable '{exe_path}'{attempts_suffix}: {error}"
                )));
            }
        }
    }

    Err(Error::from_reason(format!(
        "Failed to open executable '{exe_path}'"
    )))
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
    let file = open_windows_integrity_executable(&exe_path)?;
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
) -> std::result::Result<(String, Vec<u8>), String> {
    let hash = calculate_header_hash(asar_path)?;
    let original = fs::read(info_plist_path).map_err(|error| {
        format!(
            "Failed to read Info.plist '{}': {error}",
            info_plist_path.display()
        )
    })?;
    let is_binary = original.starts_with(b"bplist");
    let mut plist = PlistValue::from_reader(std::io::Cursor::new(&original)).map_err(|error| {
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
        .and_then(PlistValue::as_dictionary_mut)
        .ok_or_else(|| "ElectronAsarIntegrity is missing from Info.plist".to_owned())?;
    let app_asar = integrity
        .get_mut("Resources/app.asar")
        .and_then(PlistValue::as_dictionary_mut)
        .ok_or_else(|| {
            "Resources/app.asar integrity entry is missing from Info.plist".to_owned()
        })?;

    app_asar.insert("hash".to_owned(), PlistValue::String(hash.clone()));
    let mut output = Vec::new();
    if is_binary {
        plist.to_writer_binary(&mut output)
    } else {
        plist.to_writer_xml(&mut output)
    }
    .map_err(|error| format!("Failed to serialize Info.plist: {error}"))?;

    write_file_atomically(info_plist_path, &output)?;
    Ok((hash, original))
}

#[cfg(target_os = "macos")]
fn write_file_atomically(path: &Path, contents: &[u8]) -> std::result::Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("File '{}' has no parent directory", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("File '{}' has an invalid name", path.display()))?;
    let permissions = fs::metadata(path)
        .map(|metadata| metadata.permissions())
        .map_err(|error| {
            format!(
                "Failed to read permissions for '{}': {error}",
                path.display()
            )
        })?;

    for attempt in 0..10 {
        let temporary_path = parent.join(format!(
            ".{file_name}.pulsesync-{}-{attempt}.tmp",
            std::process::id()
        ));
        let mut temporary = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!(
                    "Failed to create temporary file '{}': {error}",
                    temporary_path.display()
                ));
            }
        };

        let result = temporary
            .write_all(contents)
            .and_then(|_| temporary.sync_all())
            .and_then(|_| fs::set_permissions(&temporary_path, permissions.clone()))
            .and_then(|_| fs::rename(&temporary_path, path));
        if let Err(error) = result {
            let _ = fs::remove_file(&temporary_path);
            return Err(format!(
                "Failed to replace '{}' atomically: {error}",
                path.display()
            ));
        }
        return Ok(());
    }

    Err(format!(
        "Failed to create a unique temporary file for '{}'",
        path.display()
    ))
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

    dump_mac_entitlements(app_bundle_path, entitlements_path).map_err(Error::from_reason)?;
    let (hash, original_info_plist) = match update_mac_info_plist(&info_plist_path, asar_path) {
        Ok(result) => result,
        Err(error) => {
            let _ = fs::remove_file(entitlements_path);
            return Err(Error::from_reason(error));
        }
    };
    let result = sign_mac_app(app_bundle_path, entitlements_path);
    let _ = fs::remove_file(entitlements_path);
    if let Err(error) = result {
        return match write_file_atomically(&info_plist_path, &original_info_plist) {
            Ok(()) => Err(Error::from_reason(error)),
            Err(rollback_error) => Err(Error::from_reason(format!(
                "{error}; failed to restore Info.plist: {rollback_error}"
            ))),
        };
    }
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

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    const INFO_PLIST_XML: &[u8] = br#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>ElectronAsarIntegrity</key>
    <dict>
        <key>Resources/app.asar</key>
        <dict>
            <key>algorithm</key>
            <string>SHA256</string>
            <key>hash</key>
            <string>old</string>
        </dict>
    </dict>
</dict>
</plist>
"#;

    fn test_directory(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after UNIX epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "pulsesync-integrity-{name}-{}-{nonce}",
            std::process::id()
        ))
    }

    fn write_test_asar(path: &Path) {
        let header = br#"{"files":{}}"#;
        let header_size = 8 + header.len();
        let mut archive = Vec::new();
        archive.extend_from_slice(&0_u32.to_le_bytes());
        archive.extend_from_slice(&(header_size as u32).to_le_bytes());
        archive.extend_from_slice(&((header_size - 4) as u32).to_le_bytes());
        archive.extend_from_slice(&(header.len() as u32).to_le_bytes());
        archive.extend_from_slice(header);
        fs::write(path, archive).expect("test ASAR should be written");
    }

    fn installed_hash(path: &Path) -> String {
        let plist = PlistValue::from_file(path).expect("updated plist should parse");
        plist
            .as_dictionary()
            .and_then(|root| root.get("ElectronAsarIntegrity"))
            .and_then(PlistValue::as_dictionary)
            .and_then(|integrity| integrity.get("Resources/app.asar"))
            .and_then(PlistValue::as_dictionary)
            .and_then(|entry| entry.get("hash"))
            .and_then(PlistValue::as_string)
            .expect("updated plist should contain integrity hash")
            .to_owned()
    }

    fn assert_plist_update(name: &str, original: Vec<u8>, expected_prefix: &[u8]) {
        let directory = test_directory(name);
        fs::create_dir_all(&directory).expect("test directory should be created");
        let plist_path = directory.join("Info.plist");
        let asar_path = directory.join("app.asar");
        fs::write(&plist_path, &original).expect("test plist should be written");
        write_test_asar(&asar_path);

        let (hash, preserved_original) =
            update_mac_info_plist(&plist_path, &asar_path).expect("plist update should succeed");

        assert_eq!(preserved_original, original);
        assert!(
            fs::read(&plist_path)
                .expect("updated plist should be readable")
                .starts_with(expected_prefix)
        );
        assert_eq!(installed_hash(&plist_path), hash);
        assert_eq!(hash.len(), SHA256_HEX_LENGTH);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn updates_xml_plist_atomically() {
        assert_plist_update("xml", INFO_PLIST_XML.to_vec(), b"<?xml");
    }

    #[test]
    fn preserves_binary_plist_format() {
        let plist = PlistValue::from_reader(std::io::Cursor::new(INFO_PLIST_XML))
            .expect("test XML plist should parse");
        let mut binary = Vec::new();
        plist
            .to_writer_binary(&mut binary)
            .expect("test binary plist should serialize");

        assert_plist_update("binary", binary, b"bplist");
    }
}
