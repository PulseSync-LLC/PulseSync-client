use napi_derive::napi;
use sha2::{Digest, Sha256};
#[cfg(target_os = "linux")]
use std::fs;
#[cfg(target_os = "macos")]
use std::process::Command;
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Registry::{
    HKEY_LOCAL_MACHINE, REG_VALUE_TYPE, RRF_RT_REG_SZ, RegGetValueW,
};

const HWID_NAMESPACE: &str = "pulsesync-client-hwid-v1";

#[napi(object)]
pub struct HardwareIdentity {
    pub hash: String,
    pub source: String,
    pub algorithm: String,
}

fn sha256_hex(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(HWID_NAMESPACE.as_bytes());
    hasher.update(b"\n");
    hasher.update(value.trim().as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(target_os = "windows")]
fn read_raw_hardware_id() -> Option<(String, String)> {
    let subkey = windows_wide_null(r"SOFTWARE\Microsoft\Cryptography");
    let value_name = windows_wide_null("MachineGuid");
    let mut value_type: REG_VALUE_TYPE = 0;
    let mut buffer = vec![0u16; 256];
    let mut byte_len = (buffer.len() * std::mem::size_of::<u16>()) as u32;

    let status = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            subkey.as_ptr(),
            value_name.as_ptr(),
            RRF_RT_REG_SZ,
            &mut value_type,
            buffer.as_mut_ptr().cast(),
            &mut byte_len,
        )
    };
    if status != 0 {
        return None;
    }

    let char_len = (byte_len as usize / std::mem::size_of::<u16>()).saturating_sub(1);
    let value = String::from_utf16_lossy(&buffer[..char_len])
        .trim_matches(char::from(0))
        .trim()
        .to_string();
    if value.is_empty() {
        None
    } else {
        Some((value, "windows_machine_guid".to_string()))
    }
}

#[cfg(target_os = "windows")]
fn windows_wide_null(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "macos")]
fn read_raw_hardware_id() -> Option<(String, String)> {
    let output = Command::new("ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        if !line.contains("IOPlatformUUID") {
            continue;
        }
        let value = line.split('=').nth(1)?.trim().trim_matches('"').to_string();
        if !value.is_empty() {
            return Some((value, "macos_platform_uuid".to_string()));
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn read_raw_hardware_id() -> Option<(String, String)> {
    for path in ["/etc/machine-id", "/var/lib/dbus/machine-id"] {
        let value = match fs::read_to_string(path) {
            Ok(value) => value.trim().to_string(),
            Err(_) => continue,
        };
        if !value.is_empty() {
            return Some((value, "linux_machine_id".to_string()));
        }
    }
    None
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn read_raw_hardware_id() -> Option<(String, String)> {
    None
}

#[napi]
pub fn get_hardware_identity() -> napi::Result<Option<HardwareIdentity>> {
    Ok(
        read_raw_hardware_id().map(|(raw_id, source)| HardwareIdentity {
            hash: sha256_hex(&raw_id),
            source,
            algorithm: "sha256".to_string(),
        }),
    )
}
