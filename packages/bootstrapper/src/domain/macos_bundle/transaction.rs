use super::{
    bundle_fingerprint, fingerprints_match, is_macos_transaction, read_transaction,
    recorded_fingerprint, remove_path, required_path, run_checked, staging::cleanup_old_backups,
    write_state,
};
use crate::core::error::Result;
use serde_json::{Value, json};
use std::{fs, path::Path};

#[cfg(target_os = "macos")]
fn atomic_exchange(left: &Path, right: &Path) -> Result<()> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    const AT_FDCWD: libc::c_int = -2;
    const RENAME_SWAP: libc::c_uint = 0x0000_0002;
    unsafe extern "C" {
        fn renameatx_np(
            fromfd: libc::c_int,
            from: *const libc::c_char,
            tofd: libc::c_int,
            to: *const libc::c_char,
            flags: libc::c_uint,
        ) -> libc::c_int;
    }
    let left = CString::new(left.as_os_str().as_bytes())?;
    let right = CString::new(right.as_os_str().as_bytes())?;
    let result = unsafe {
        renameatx_np(
            AT_FDCWD,
            left.as_ptr(),
            AT_FDCWD,
            right.as_ptr(),
            RENAME_SWAP,
        )
    };
    if result != 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn atomic_exchange(_left: &Path, _right: &Path) -> Result<()> {
    Err("macOS bundle exchange is only supported on macOS".into())
}

pub(super) fn exchange_transaction_with_fault(
    transaction_file: &Path,
    fault: Option<&str>,
) -> Result<Value> {
    let mut transaction = read_transaction(transaction_file)?;
    if !is_macos_transaction(&transaction)
        || transaction.get("state").and_then(Value::as_str) != Some("commit-slot-ready")
    {
        return Err("macOS transaction is not ready for exchange".into());
    }
    let host_bundle = required_path(&transaction, "hostBundle")?;
    let commit_slot = required_path(&transaction, "commitSlot")?;
    let relative_executable = required_path(&transaction, "appExecutableRelative")?;
    let expected_old = recorded_fingerprint(&transaction, "oldFingerprint")?;
    let expected_new = recorded_fingerprint(&transaction, "newFingerprint")?;
    if !fingerprints_match(
        &bundle_fingerprint(&host_bundle, &relative_executable)?,
        &expected_old,
    ) || !fingerprints_match(
        &bundle_fingerprint(&commit_slot, &relative_executable)?,
        &expected_new,
    ) {
        return Err("macOS bundle identity changed after preparation".into());
    }
    if fault == Some("before-exchange") {
        return Err("injected failure before macOS bundle exchange".into());
    }
    atomic_exchange(&host_bundle, &commit_slot)?;
    if fault == Some("after-exchange") {
        return Err("injected failure after macOS bundle exchange".into());
    }
    write_state(transaction_file, &mut transaction, "exchanged")?;
    let target = bundle_fingerprint(&host_bundle, &relative_executable)?;
    let previous = bundle_fingerprint(&commit_slot, &relative_executable)?;
    if !fingerprints_match(&target, &expected_new) || !fingerprints_match(&previous, &expected_old)
    {
        let _ = atomic_exchange(&host_bundle, &commit_slot);
        write_state(transaction_file, &mut transaction, "rolled-back")?;
        return Err(
            "macOS bundle post-exchange verification failed; previous bundle restored".into(),
        );
    }
    write_state(transaction_file, &mut transaction, "verified")?;
    Ok(transaction)
}

pub fn exchange_transaction(transaction_file: &Path) -> Result<Value> {
    exchange_transaction_with_fault(transaction_file, None)
}

pub fn rollback_transaction(transaction_file: &Path) -> Result<Value> {
    let mut transaction = read_transaction(transaction_file)?;
    let state = transaction
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if state == "rolled-back" {
        return Ok(transaction);
    }
    if !matches!(state, "exchanged" | "verified") {
        return Err(format!("macOS transaction cannot roll back from state {state}").into());
    }
    let host_bundle = required_path(&transaction, "hostBundle")?;
    let commit_slot = required_path(&transaction, "commitSlot")?;
    let relative_executable = required_path(&transaction, "appExecutableRelative")?;
    let expected_old = recorded_fingerprint(&transaction, "oldFingerprint")?;
    let expected_new = recorded_fingerprint(&transaction, "newFingerprint")?;
    if !fingerprints_match(
        &bundle_fingerprint(&host_bundle, &relative_executable)?,
        &expected_new,
    ) || !fingerprints_match(
        &bundle_fingerprint(&commit_slot, &relative_executable)?,
        &expected_old,
    ) {
        return Err("macOS rollback identity mismatch; manual repair is required".into());
    }
    atomic_exchange(&host_bundle, &commit_slot)?;
    if !fingerprints_match(
        &bundle_fingerprint(&host_bundle, &relative_executable)?,
        &expected_old,
    ) {
        return Err("macOS rollback verification failed".into());
    }
    write_state(transaction_file, &mut transaction, "rolled-back")?;
    Ok(transaction)
}

pub(super) fn finalize_transaction_with_fault(
    transaction_file: &Path,
    fault: Option<&str>,
) -> Result<Value> {
    let mut transaction = read_transaction(transaction_file)?;
    if transaction.get("state").and_then(Value::as_str) != Some("verified") {
        return Err("macOS transaction must be verified before finalization".into());
    }
    let commit_slot = required_path(&transaction, "commitSlot")?;
    let backup_dir = required_path(&transaction, "backupDir")?;
    let relative_executable = required_path(&transaction, "appExecutableRelative")?;
    remove_path(&backup_dir)?;
    if let Some(parent) = backup_dir.parent() {
        fs::create_dir_all(parent)?;
    }
    run_checked(
        "/usr/bin/ditto",
        &[commit_slot.as_os_str(), backup_dir.as_os_str()],
        "macOS rollback bundle persistence",
    )?;
    if fault == Some("after-backup-copy") {
        return Err("injected failure after macOS rollback bundle copy".into());
    }
    let expected_old = recorded_fingerprint(&transaction, "oldFingerprint")?;
    let copied = bundle_fingerprint(&backup_dir, &relative_executable)?;
    if copied.bundle_version != expected_old.bundle_version
        || !copied
            .executable_sha256
            .eq_ignore_ascii_case(&expected_old.executable_sha256)
    {
        return Err("persisted macOS rollback bundle verification failed".into());
    }
    transaction["rollbackFingerprint"] = serde_json::to_value(&copied)?;
    write_state(transaction_file, &mut transaction, "rollback-persisted")?;
    if fault == Some("after-rollback-persisted") {
        return Err("injected failure after rollback persistence".into());
    }
    remove_path(&commit_slot)?;
    transaction["removedOldBackups"] = json!(cleanup_old_backups(&backup_dir)?);
    write_state(transaction_file, &mut transaction, "complete")?;
    Ok(transaction)
}

pub fn finalize_transaction(transaction_file: &Path) -> Result<Value> {
    finalize_transaction_with_fault(transaction_file, None)
}

pub fn recover_transaction(transaction_file: &Path) -> Result<Value> {
    let mut transaction = read_transaction(transaction_file)?;
    let state = transaction
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match state {
        "exchanged" | "verified" | "commit-slot-ready" => {
            let host_bundle = required_path(&transaction, "hostBundle")?;
            let commit_slot = required_path(&transaction, "commitSlot")?;
            let relative_executable = required_path(&transaction, "appExecutableRelative")?;
            let expected_old = recorded_fingerprint(&transaction, "oldFingerprint")?;
            let expected_new = recorded_fingerprint(&transaction, "newFingerprint")?;
            let target = bundle_fingerprint(&host_bundle, &relative_executable)?;
            let slot = bundle_fingerprint(&commit_slot, &relative_executable)?;
            if fingerprints_match(&target, &expected_new)
                && fingerprints_match(&slot, &expected_old)
            {
                if state == "commit-slot-ready" {
                    write_state(transaction_file, &mut transaction, "exchanged")?;
                }
                return rollback_transaction(transaction_file);
            }
            if fingerprints_match(&target, &expected_old)
                && fingerprints_match(&slot, &expected_new)
            {
                remove_path(&commit_slot)?;
                write_state(transaction_file, &mut transaction, "rolled-back")?;
                return Ok(transaction);
            }
            Err("macOS recovery fingerprints are ambiguous; manual repair is required".into())
        }
        "rollback-persisted" => {
            let host_bundle = required_path(&transaction, "hostBundle")?;
            let commit_slot = required_path(&transaction, "commitSlot")?;
            let backup_dir = required_path(&transaction, "backupDir")?;
            let relative_executable = required_path(&transaction, "appExecutableRelative")?;
            let expected_old = recorded_fingerprint(&transaction, "oldFingerprint")?;
            let expected_new = recorded_fingerprint(&transaction, "newFingerprint")?;
            let target = bundle_fingerprint(&host_bundle, &relative_executable)?;
            let backup = bundle_fingerprint(&backup_dir, &relative_executable)?;
            if !fingerprints_match(&target, &expected_new)
                || backup.bundle_version != expected_old.bundle_version
                || !backup
                    .executable_sha256
                    .eq_ignore_ascii_case(&expected_old.executable_sha256)
            {
                return Err(
                    "persisted macOS recovery identity mismatch; manual repair is required".into(),
                );
            }
            if commit_slot.exists() {
                let slot = bundle_fingerprint(&commit_slot, &relative_executable)?;
                if !fingerprints_match(&slot, &expected_old) {
                    return Err("macOS recovery commit slot identity mismatch".into());
                }
                remove_path(&commit_slot)?;
            }
            transaction["removedOldBackups"] = json!(cleanup_old_backups(&backup_dir)?);
            write_state(transaction_file, &mut transaction, "complete")?;
            Ok(transaction)
        }
        "prepared" | "rolled-back" | "complete" => Ok(transaction),
        _ => Err(format!("unsupported macOS recovery state: {state}").into()),
    }
}
