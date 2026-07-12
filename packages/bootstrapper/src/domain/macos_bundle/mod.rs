use crate::{
    core::{
        active_app::write_json_atomic,
        error::Result,
        fs_ops::sha256_file,
        layout::{assert_inside, is_inside},
    },
    domain::transactions::transaction_records,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
#[cfg(all(test, target_os = "macos"))]
use uuid::Uuid;

mod launch_agent;
mod staging;
mod transaction;

pub use launch_agent::{register_recovery_agent, remove_recovery_agent};
#[cfg(all(test, target_os = "macos"))]
use staging::validate_archive_entries;
pub use staging::{arm_transaction, prepare_transaction};
pub use transaction::{
    exchange_transaction, finalize_transaction, recover_transaction, rollback_transaction,
};
#[cfg(all(test, target_os = "macos"))]
use transaction::{exchange_transaction_with_fault, finalize_transaction_with_fault};

pub const MACOS_TRANSACTION_KIND: &str = "macos-bundle";

#[cfg(target_os = "macos")]
pub fn signal_process(pid: u32, force: bool) -> Result<()> {
    let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
    if unsafe { libc::kill(pid as libc::pid_t, signal) } != 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::ESRCH) {
            return Err(error.into());
        }
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn signal_process(_pid: u32, _force: bool) -> Result<()> {
    Err("macOS process signaling is only supported on macOS".into())
}

#[cfg(target_os = "macos")]
fn effective_user_id() -> Result<u32> {
    Ok(unsafe { libc::geteuid() })
}

#[cfg(not(target_os = "macos"))]
fn effective_user_id() -> Result<u32> {
    Err("LaunchAgent operations are only supported on macOS".into())
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleFingerprint {
    pub bundle_version: String,
    pub executable_sha256: String,
    pub file_id: u64,
    pub volume_id: u64,
}

fn run_checked(program: &str, args: &[&std::ffi::OsStr], label: &str) -> Result<()> {
    let output = Command::new(program).args(args).output()?;
    if !output.status.success() {
        return Err(format!(
            "{label} failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )
        .into());
    }
    Ok(())
}

fn plist_version(bundle: &Path) -> Result<String> {
    let output = Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleShortVersionString"])
        .arg(bundle.join("Contents").join("Info.plist"))
        .output()?;
    if !output.status.success() {
        return Err("macOS bundle Info.plist is missing CFBundleShortVersionString".into());
    }
    let version = String::from_utf8(output.stdout)?.trim().to_string();
    if version.is_empty() {
        return Err("macOS bundle version is empty".into());
    }
    Ok(version)
}

fn executable_path(bundle: &Path, relative: &Path) -> Result<PathBuf> {
    let executable = bundle.join(relative);
    assert_inside(
        &bundle.join("Contents").join("MacOS"),
        &executable,
        "bundle executable",
    )?;
    if !executable.is_file() {
        return Err(format!(
            "macOS bundle executable is missing: {}",
            executable.display()
        )
        .into());
    }
    Ok(executable)
}

fn validate_bundle(bundle: &Path, relative_executable: &Path) -> Result<()> {
    if !bundle.is_dir() || !bundle.join("Contents").join("Info.plist").is_file() {
        return Err(format!("invalid macOS bundle: {}", bundle.display()).into());
    }
    executable_path(bundle, relative_executable)?;
    let seed = bundle
        .join("Contents")
        .join("Resources")
        .join("bootstrapper")
        .join("pulsesync-bootstrapper");
    if !seed.is_file() {
        return Err(format!(
            "macOS bundle bootstrapper seed is missing: {}",
            seed.display()
        )
        .into());
    }
    Ok(())
}

pub fn bundle_fingerprint(bundle: &Path, relative_executable: &Path) -> Result<BundleFingerprint> {
    validate_bundle(bundle, relative_executable)?;
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    #[cfg(unix)]
    let (volume_id, file_id) = {
        let metadata = fs::metadata(bundle)?;
        (metadata.dev(), metadata.ino())
    };
    #[cfg(not(unix))]
    let (volume_id, file_id) = (0, 0);
    Ok(BundleFingerprint {
        bundle_version: plist_version(bundle)?,
        executable_sha256: sha256_file(&executable_path(bundle, relative_executable)?)?,
        file_id,
        volume_id,
    })
}

fn fingerprints_match(left: &BundleFingerprint, right: &BundleFingerprint) -> bool {
    left.bundle_version == right.bundle_version
        && left
            .executable_sha256
            .eq_ignore_ascii_case(&right.executable_sha256)
        && left.file_id == right.file_id
        && left.volume_id == right.volume_id
}

pub fn is_macos_transaction(value: &Value) -> bool {
    value.get("kind").and_then(Value::as_str) == Some(MACOS_TRANSACTION_KIND)
}

fn required_path(value: &Value, key: &str) -> Result<PathBuf> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(PathBuf::from)
        .ok_or_else(|| format!("macOS transaction is missing {key}").into())
}

fn read_transaction(path: &Path) -> Result<Value> {
    Ok(serde_json::from_slice(&fs::read(path)?)?)
}

fn write_state(path: &Path, transaction: &mut Value, state: &str) -> Result<()> {
    transaction["state"] = json!(state);
    write_json_atomic(path, transaction)
}

fn recorded_fingerprint(value: &Value, key: &str) -> Result<BundleFingerprint> {
    Ok(serde_json::from_value(
        value
            .get(key)
            .cloned()
            .ok_or_else(|| format!("macOS transaction is missing {key}"))?,
    )?)
}

fn remove_path(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}

pub fn transaction_state(transaction_file: &Path) -> Result<String> {
    Ok(read_transaction(transaction_file)?
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string())
}

pub fn transaction_host_bundle(transaction_file: &Path) -> Result<PathBuf> {
    required_path(&read_transaction(transaction_file)?, "hostBundle")
}

pub fn transaction_state_root(transaction_file: &Path) -> Result<PathBuf> {
    required_path(&read_transaction(transaction_file)?, "stateRoot")
}

pub fn transaction_app_executable(transaction_file: &Path) -> Result<PathBuf> {
    let transaction = read_transaction(transaction_file)?;
    Ok(required_path(&transaction, "hostBundle")?
        .join(required_path(&transaction, "appExecutableRelative")?))
}

pub fn bind_app_handoff(transaction_file: &Path, handoff_id: Option<&str>) -> Result<()> {
    let mut transaction = read_transaction(transaction_file)?;
    if !is_macos_transaction(&transaction) {
        return Ok(());
    }
    transaction["appHandoffId"] = handoff_id.map_or(Value::Null, |id| json!(id));
    transaction["startupAcknowledged"] = json!(false);
    write_json_atomic(transaction_file, &transaction)
}

pub fn acknowledge_app_startup(state_root: &Path, handoff_id: &str) -> Result<bool> {
    let transaction_root = state_root.join("updates").join("transactions");
    for record in transaction_records(&transaction_root)? {
        if !is_macos_transaction(&record.value)
            || record.value.get("appHandoffId").and_then(Value::as_str) != Some(handoff_id)
            || record.value.get("state").and_then(Value::as_str) != Some("verified")
        {
            continue;
        }
        let mut transaction = record.value;
        transaction["startupAcknowledged"] = json!(true);
        write_json_atomic(&record.candidate.path, &transaction)?;
        return Ok(true);
    }
    Ok(false)
}

pub fn startup_acknowledged(transaction_file: &Path) -> Result<bool> {
    Ok(read_transaction(transaction_file)?
        .get("startupAcknowledged")
        .and_then(Value::as_bool)
        == Some(true))
}

pub fn app_handoff_bound(transaction_file: &Path) -> Result<bool> {
    Ok(read_transaction(transaction_file)?
        .get("appHandoffId")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty()))
}

pub fn transaction_helper_matches(transaction_file: &Path, helper: &Path) -> Result<bool> {
    let transaction = read_transaction(transaction_file)?;
    let recorded = required_path(&transaction, "helperPath")?;
    let expected_sha = transaction
        .get("helperSha256")
        .and_then(Value::as_str)
        .ok_or("macOS transaction is missing helperSha256")?;
    Ok(recorded.canonicalize()? == helper.canonicalize()?
        && sha256_file(helper)?.eq_ignore_ascii_case(expected_sha)
        && is_inside(&required_path(&transaction, "transactionDir")?, helper))
}

pub fn recovery_agent_ready(transaction_file: &Path) -> Result<bool> {
    Ok(read_transaction(transaction_file)?
        .get("recoveryAgentReady")
        .and_then(Value::as_bool)
        == Some(true))
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "pulsesync-macos-bundle-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    }

    fn create_bundle(path: &Path, version: &str, marker: &str) {
        let contents = path.join("Contents");
        let executable = contents.join("MacOS").join("PulseSync");
        let seed = contents
            .join("Resources")
            .join("bootstrapper")
            .join("pulsesync-bootstrapper");
        fs::create_dir_all(executable.parent().unwrap()).unwrap();
        fs::create_dir_all(seed.parent().unwrap()).unwrap();
        fs::write(&executable, marker.as_bytes()).unwrap();
        fs::write(&seed, b"helper").unwrap();
        fs::write(
            contents.join("Info.plist"),
            format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict><key>CFBundleShortVersionString</key><string>{version}</string></dict></plist>\n"
            ),
        )
        .unwrap();
    }

    fn write_exchange_transaction(root: &Path) -> PathBuf {
        let host = root.join("Applications").join("PulseSync.app");
        let slot = root
            .join("Applications")
            .join(".pulsesync-update-test.bundle-slot");
        create_bundle(&host, "1.0.0", "old");
        create_bundle(&slot, "2.0.0", "new");
        let relative = PathBuf::from("Contents/MacOS/PulseSync");
        let old = bundle_fingerprint(&host, &relative).unwrap();
        let new = bundle_fingerprint(&slot, &relative).unwrap();
        let transaction_dir = root.join("state/updates/transactions/test");
        fs::create_dir_all(&transaction_dir).unwrap();
        let transaction_file = transaction_dir.join("transaction.json");
        write_json_atomic(
            &transaction_file,
            &json!({
                "schemaVersion": 1,
                "kind": MACOS_TRANSACTION_KIND,
                "transactionId": Uuid::new_v4().to_string(),
                "state": "commit-slot-ready",
                "stateRoot": root.join("state"),
                "hostBundle": host,
                "appExecutableRelative": relative,
                "commitSlot": slot,
                "backupDir": root.join("state/backups/1.0.0-test"),
                "transactionDir": transaction_dir,
                "oldFingerprint": old,
                "newFingerprint": new,
            }),
        )
        .unwrap();
        transaction_file
    }

    #[test]
    fn exchanges_and_rolls_back_complete_bundles() {
        let root = temp_root("rollback");
        let transaction = write_exchange_transaction(&root);
        let exchanged = exchange_transaction(&transaction).unwrap();
        assert_eq!(
            exchanged.get("state").and_then(Value::as_str),
            Some("verified")
        );
        assert_eq!(
            fs::read_to_string(root.join("Applications/PulseSync.app/Contents/MacOS/PulseSync"))
                .unwrap(),
            "new"
        );
        rollback_transaction(&transaction).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("Applications/PulseSync.app/Contents/MacOS/PulseSync"))
                .unwrap(),
            "old"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn finalization_persists_previous_bundle_and_removes_slot() {
        let root = temp_root("finalize");
        let transaction = write_exchange_transaction(&root);
        create_bundle(&root.join("state/backups/stale"), "0.9.0", "stale");
        exchange_transaction(&transaction).unwrap();
        let finalized = finalize_transaction(&transaction).unwrap();
        assert_eq!(
            finalized.get("state").and_then(Value::as_str),
            Some("complete")
        );
        assert!(
            !root
                .join("Applications/.pulsesync-update-test.bundle-slot")
                .exists()
        );
        assert_eq!(
            fs::read_to_string(root.join("state/backups/1.0.0-test/Contents/MacOS/PulseSync"))
                .unwrap(),
            "old"
        );
        assert!(!root.join("state/backups/stale").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_finishes_finalization_after_rollback_is_durable() {
        let root = temp_root("finalize-recovery");
        let transaction = write_exchange_transaction(&root);
        exchange_transaction(&transaction).unwrap();
        assert!(
            finalize_transaction_with_fault(&transaction, Some("after-rollback-persisted"))
                .is_err()
        );
        assert_eq!(
            transaction_state(&transaction).unwrap(),
            "rollback-persisted"
        );
        let recovered = recover_transaction(&transaction).unwrap();
        assert_eq!(
            recovered.get("state").and_then(Value::as_str),
            Some("complete")
        );
        assert_eq!(
            fs::read_to_string(root.join("Applications/PulseSync.app/Contents/MacOS/PulseSync"))
                .unwrap(),
            "new"
        );
        assert!(
            !root
                .join("Applications/.pulsesync-update-test.bundle-slot")
                .exists()
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn identity_change_blocks_exchange_without_mutating_target() {
        let root = temp_root("identity");
        let transaction = write_exchange_transaction(&root);
        fs::write(
            root.join("Applications/PulseSync.app/Contents/MacOS/PulseSync"),
            b"tampered",
        )
        .unwrap();
        assert!(exchange_transaction(&transaction).is_err());
        assert_eq!(
            fs::read_to_string(root.join("Applications/PulseSync.app/Contents/MacOS/PulseSync"))
                .unwrap(),
            "tampered"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn injected_failure_before_exchange_leaves_old_bundle_live() {
        let root = temp_root("before-exchange");
        let transaction = write_exchange_transaction(&root);
        assert!(exchange_transaction_with_fault(&transaction, Some("before-exchange")).is_err());
        assert_eq!(
            fs::read_to_string(root.join("Applications/PulseSync.app/Contents/MacOS/PulseSync"))
                .unwrap(),
            "old"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_detects_exchange_before_phase_persistence() {
        let root = temp_root("after-exchange");
        let transaction = write_exchange_transaction(&root);
        assert!(exchange_transaction_with_fault(&transaction, Some("after-exchange")).is_err());
        assert_eq!(
            transaction_state(&transaction).unwrap(),
            "commit-slot-ready"
        );
        assert_eq!(
            fs::read_to_string(root.join("Applications/PulseSync.app/Contents/MacOS/PulseSync"))
                .unwrap(),
            "new"
        );
        let recovered = recover_transaction(&transaction).unwrap();
        assert_eq!(
            recovered.get("state").and_then(Value::as_str),
            Some("rolled-back")
        );
        assert_eq!(
            fs::read_to_string(root.join("Applications/PulseSync.app/Contents/MacOS/PulseSync"))
                .unwrap(),
            "old"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn backup_persistence_failure_remains_rollback_safe() {
        let root = temp_root("backup-failure");
        let transaction = write_exchange_transaction(&root);
        exchange_transaction(&transaction).unwrap();
        assert!(finalize_transaction_with_fault(&transaction, Some("after-backup-copy")).is_err());
        let recovered = recover_transaction(&transaction).unwrap();
        assert_eq!(
            recovered.get("state").and_then(Value::as_str),
            Some("rolled-back")
        );
        assert_eq!(
            fs::read_to_string(root.join("Applications/PulseSync.app/Contents/MacOS/PulseSync"))
                .unwrap(),
            "old"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unwritable_target_parent_blocks_exchange_without_mutation() {
        let root = temp_root("permissions");
        let transaction = write_exchange_transaction(&root);
        let applications = root.join("Applications");
        fs::set_permissions(&applications, fs::Permissions::from_mode(0o555)).unwrap();
        let result = exchange_transaction(&transaction);
        fs::set_permissions(&applications, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(root.join("Applications/PulseSync.app/Contents/MacOS/PulseSync"))
                .unwrap(),
            "old"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn archive_preflight_rejects_path_traversal() {
        let root = temp_root("archive-traversal");
        fs::create_dir_all(&root).unwrap();
        let archive_path = root.join("malicious.zip");
        let file = fs::File::create(&archive_path).unwrap();
        let mut archive = zip::ZipWriter::new(file);
        archive
            .start_file("../escaped", zip::write::SimpleFileOptions::default())
            .unwrap();
        archive.write_all(b"nope").unwrap();
        archive.finish().unwrap();
        assert!(validate_archive_entries(&archive_path).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
