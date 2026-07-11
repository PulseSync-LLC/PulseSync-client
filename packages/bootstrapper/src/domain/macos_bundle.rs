use crate::{
    core::{
        active_app::write_json_atomic,
        error::Result,
        fs_ops::{ensure_executable, sha256_file},
        layout::{Layout, assert_inside, is_inside},
        path_segment::sanitize_path_segment,
    },
    domain::{
        artifacts::{ArtifactKey, artifact_file_name},
        manifest::BootstrapperUpdateDecision,
        transactions::transaction_records,
        update_workflow::PreparedTransactionRef,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs::{self, OpenOptions},
    io::Read,
    path::Component,
    path::{Path, PathBuf},
    process::Command,
};
use uuid::Uuid;

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

fn transaction_dir(
    layout: &Layout,
    decision: &BootstrapperUpdateDecision,
    id: &str,
) -> Result<PathBuf> {
    Ok(layout
        .transaction_root
        .join(sanitize_path_segment(&decision.channel)?)
        .join(sanitize_path_segment(&decision.target_version)?)
        .join(sanitize_path_segment(&decision.dist)?)
        .join(id))
}

pub fn prepare_transaction(
    layout: &Layout,
    decision: &BootstrapperUpdateDecision,
    staging_root: &Path,
    active_lease_id: &str,
) -> Result<PreparedTransactionRef> {
    let artifacts = decision
        .artifacts
        .as_ref()
        .ok_or("macOS manifest artifacts are missing")?;
    let source_name = artifact_file_name(&artifacts.app, &ArtifactKey::App)?;
    let staging_dir = staging_root
        .join(sanitize_path_segment(&decision.channel)?)
        .join(sanitize_path_segment(&decision.target_version)?)
        .join(sanitize_path_segment(&decision.dist)?);
    let source_path = staging_dir.join(source_name);
    let source_size = fs::metadata(&source_path)?.len();
    let source_sha = sha256_file(&source_path)?;
    if !source_sha.eq_ignore_ascii_case(&artifacts.app.sha256)
        || artifacts.app.size.is_some_and(|size| size != source_size)
    {
        return Err("staged macOS host artifact does not match the manifest".into());
    }
    let id = Uuid::new_v4().to_string();
    let dir = transaction_dir(layout, decision, &id)?;
    assert_inside(
        &layout.transaction_root,
        &dir,
        "macOS transaction directory",
    )?;
    let prepared_dir = dir.join("prepared");
    fs::create_dir_all(&prepared_dir)?;
    let archive_path = prepared_dir.join("host-bundle.zip");
    fs::copy(&source_path, &archive_path)?;
    let host_bundle = layout
        .host_bundle
        .as_ref()
        .ok_or("macOS host bundle is missing")?;
    let target_parent = host_bundle
        .parent()
        .ok_or("macOS host bundle has no parent")?;
    let permission_probe = target_parent.join(format!(".pulsesync-write-probe-{id}"));
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&permission_probe)
    {
        Ok(_) => fs::remove_file(&permission_probe)?,
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::ReadOnlyFilesystem
            ) =>
        {
            return Err(format!(
                "elevation-required: cannot update {} without write access to {}",
                host_bundle.display(),
                target_parent.display()
            )
            .into());
        }
        Err(error) => return Err(error.into()),
    }
    let old_fingerprint = bundle_fingerprint(host_bundle, Path::new(&layout.app_executable_name))?;
    let commit_slot = target_parent.join(format!(".pulsesync-update-{id}.bundle-slot"));
    let backup_dir = layout.updates_dir.join("backups").join(format!(
        "{}-{id}",
        sanitize_path_segment(&decision.current_version)?
    ));
    let transaction_file = dir.join("transaction.json");
    let payload = json!({
        "schemaVersion": 1,
        "kind": MACOS_TRANSACTION_KIND,
        "transactionId": id,
        "state": "prepared",
        "prepared": true,
        "channel": decision.channel,
        "dist": decision.dist,
        "currentVersion": decision.current_version,
        "targetVersion": decision.target_version,
        "stateRoot": layout.state_root,
        "hostBundle": host_bundle,
        "appExecutableRelative": layout.app_executable_name,
        "stagingDir": staging_dir,
        "backupDir": backup_dir,
        "transactionDir": dir,
        "archivePath": archive_path,
        "archiveSha256": source_sha,
        "archiveSize": source_size,
        "commitSlot": commit_slot,
        "oldFingerprint": old_fingerprint,
        "applyDeferredByLeaseId": active_lease_id,
        "artifacts": [{
            "action": "replace-macos-bundle",
            "backupPath": backup_dir,
            "key": "app",
            "preparedKind": "archive",
            "preparedPath": archive_path,
            "sha256": source_sha,
            "size": source_size,
            "sourcePath": source_path,
            "targetPath": host_bundle,
        }],
    });
    write_json_atomic(&transaction_file, &payload)?;
    Ok(PreparedTransactionRef {
        id,
        dir,
        file: transaction_file,
    })
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

fn normalized_archive_path(path: &Path) -> Option<PathBuf> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => normalized.push(value),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return None;
                }
            }
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(normalized)
}

fn validate_archive_entries(archive_path: &Path) -> Result<()> {
    const MAX_ENTRIES: usize = 200_000;
    const MAX_UNCOMPRESSED_BYTES: u64 = 4 * 1024 * 1024 * 1024;
    let file = fs::File::open(archive_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    if archive.len() > MAX_ENTRIES {
        return Err("macOS host archive contains too many entries".into());
    }
    let mut total = 0_u64;
    let mut bundle_root: Option<PathBuf> = None;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        total = total
            .checked_add(entry.size())
            .ok_or("macOS host archive size overflow")?;
        if total > MAX_UNCOMPRESSED_BYTES {
            return Err("macOS host archive exceeds the uncompressed size limit".into());
        }
        let enclosed = entry
            .enclosed_name()
            .ok_or("macOS host archive contains an unsafe path")?
            .to_path_buf();
        let normalized = normalized_archive_path(&enclosed)
            .ok_or("macOS host archive contains path traversal")?;
        let first = normalized
            .components()
            .next()
            .and_then(|component| match component {
                Component::Normal(value) => Some(PathBuf::from(value)),
                _ => None,
            })
            .ok_or("macOS host archive contains an empty path")?;
        if first != Path::new("__MACOSX") {
            if first.extension().and_then(|value| value.to_str()) != Some("app") {
                return Err("macOS host archive has content outside its top-level .app".into());
            }
            if bundle_root.as_ref().is_some_and(|root| root != &first) {
                return Err("macOS host archive contains multiple top-level .app bundles".into());
            }
            bundle_root = Some(first.clone());
        }
        let mode = entry.unix_mode().unwrap_or(0);
        if mode & 0o170000 == 0o120000 {
            let mut target = String::new();
            entry.read_to_string(&mut target)?;
            let target = Path::new(&target);
            if target.is_absolute() {
                return Err("macOS host archive contains an absolute symbolic link".into());
            }
            let resolved = normalized_archive_path(
                &normalized
                    .parent()
                    .unwrap_or_else(|| Path::new(""))
                    .join(target),
            )
            .ok_or("macOS host archive symbolic link escapes the bundle")?;
            if !resolved.starts_with(&first) {
                return Err("macOS host archive symbolic link escapes the bundle".into());
            }
        }
    }
    if bundle_root.is_none() {
        return Err("macOS host archive is missing a top-level .app".into());
    }
    Ok(())
}

fn cleanup_old_backups(backup_dir: &Path) -> Result<Vec<PathBuf>> {
    let Some(root) = backup_dir.parent() else {
        return Err("macOS backup directory has no parent".into());
    };
    let mut removed = Vec::new();
    if !root.is_dir() {
        return Ok(removed);
    }
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if path == backup_dir || !path.is_dir() || !is_inside(root, &path) {
            continue;
        }
        fs::remove_dir_all(&path)?;
        removed.push(path);
    }
    Ok(removed)
}

pub fn arm_transaction(transaction_file: &Path, current_helper: &Path) -> Result<PathBuf> {
    let mut transaction = read_transaction(transaction_file)?;
    if !is_macos_transaction(&transaction)
        || transaction.get("state").and_then(Value::as_str) != Some("prepared")
    {
        return Err("macOS transaction must be prepared before arming".into());
    }
    let transaction_dir = required_path(&transaction, "transactionDir")?;
    let host_bundle = required_path(&transaction, "hostBundle")?;
    let archive = required_path(&transaction, "archivePath")?;
    let commit_slot = required_path(&transaction, "commitSlot")?;
    let relative_executable = required_path(&transaction, "appExecutableRelative")?;
    let target_parent = host_bundle
        .parent()
        .ok_or("macOS host bundle has no parent")?;
    let unpack_dir = target_parent.join(format!(
        ".pulsesync-unpack-{}",
        transaction
            .get("transactionId")
            .and_then(Value::as_str)
            .ok_or("macOS transaction id is missing")?
    ));
    validate_archive_entries(&archive)?;
    remove_path(&unpack_dir)?;
    remove_path(&commit_slot)?;
    fs::create_dir(&unpack_dir)?;
    let extraction = (|| -> Result<PathBuf> {
        run_checked(
            "/usr/bin/ditto",
            &[
                std::ffi::OsStr::new("-x"),
                std::ffi::OsStr::new("-k"),
                archive.as_os_str(),
                unpack_dir.as_os_str(),
            ],
            "macOS host archive extraction",
        )?;
        let bundles = fs::read_dir(&unpack_dir)?
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("app"))
            .collect::<Vec<_>>();
        if bundles.len() != 1 {
            return Err("macOS host archive must contain exactly one top-level .app".into());
        }
        validate_bundle(&bundles[0], &relative_executable)?;
        fs::rename(&bundles[0], &commit_slot)?;
        Ok(commit_slot.clone())
    })();
    let _ = remove_path(&unpack_dir);
    extraction?;
    let expected_old = recorded_fingerprint(&transaction, "oldFingerprint")?;
    let old_fingerprint = bundle_fingerprint(&host_bundle, &relative_executable)?;
    if !fingerprints_match(&old_fingerprint, &expected_old) {
        remove_path(&commit_slot)?;
        return Err("macOS bundle identity changed after update preparation".into());
    }
    let new_fingerprint = bundle_fingerprint(&commit_slot, &relative_executable)?;
    if new_fingerprint.bundle_version
        != transaction
            .get("targetVersion")
            .and_then(Value::as_str)
            .ok_or("targetVersion is missing")?
    {
        remove_path(&commit_slot)?;
        return Err("staged macOS bundle version does not match targetVersion".into());
    }
    let helper_dir = transaction_dir.join("helper");
    fs::create_dir_all(&helper_dir)?;
    let helper_path = helper_dir.join("pulsesync-bootstrapper");
    fs::copy(current_helper, &helper_path)?;
    ensure_executable(&helper_path)?;
    let helper_sha = sha256_file(&helper_path)?;
    if !helper_sha.eq_ignore_ascii_case(&sha256_file(current_helper)?) {
        return Err("external macOS helper copy hash mismatch".into());
    }
    transaction["newFingerprint"] = serde_json::to_value(new_fingerprint)?;
    transaction["helperPath"] = json!(helper_path);
    transaction["helperSha256"] = json!(helper_sha);
    transaction["recoveryAgentReady"] = json!(false);
    write_state(transaction_file, &mut transaction, "commit-slot-ready")?;
    Ok(helper_path)
}

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

fn recorded_fingerprint(value: &Value, key: &str) -> Result<BundleFingerprint> {
    Ok(serde_json::from_value(
        value
            .get(key)
            .cloned()
            .ok_or_else(|| format!("macOS transaction is missing {key}"))?,
    )?)
}

fn exchange_transaction_with_fault(transaction_file: &Path, fault: Option<&str>) -> Result<Value> {
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

fn finalize_transaction_with_fault(transaction_file: &Path, fault: Option<&str>) -> Result<Value> {
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

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub fn register_recovery_agent(
    transaction_file: &Path,
    helper: &Path,
    supervised_pid: u32,
    supervised_start_id: &str,
) -> Result<()> {
    let mut transaction = read_transaction(transaction_file)?;
    if !is_macos_transaction(&transaction) {
        return Err("recovery agent requires a macOS bundle transaction".into());
    }
    if cfg!(debug_assertions) && std::env::var_os("PULSESYNC_DISABLE_LAUNCH_AGENT").is_some() {
        transaction["recoveryAgentReady"] = json!(true);
        transaction["recoveryAgentMode"] = json!("disabled-debug");
        write_json_atomic(transaction_file, &transaction)?;
        return Ok(());
    }
    let id = transaction
        .get("transactionId")
        .and_then(Value::as_str)
        .ok_or("macOS transaction id is missing")?;
    let label = format!("app.pulsesync.update.{id}");
    let home = std::env::var_os("HOME").ok_or("HOME is required to register recovery agent")?;
    let plist = PathBuf::from(home)
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{label}.plist"));
    let transaction_dir = required_path(&transaction, "transactionDir")?;
    let stdout_log = transaction_dir.join("recovery-agent.stdout.log");
    let stderr_log = transaction_dir.join("recovery-agent.stderr.log");
    transaction["recoveryAgentLabel"] = json!(label);
    transaction["recoveryAgentPlist"] = json!(plist);
    transaction["recoveryAgentStdout"] = json!(stdout_log);
    transaction["recoveryAgentStderr"] = json!(stderr_log);
    write_json_atomic(transaction_file, &transaction)?;
    fs::create_dir_all(plist.parent().expect("LaunchAgents parent"))?;
    let args = [
        helper.to_string_lossy().to_string(),
        "recover-update".to_string(),
        "--transaction-file".to_string(),
        transaction_file.to_string_lossy().to_string(),
        "--supervise-pid".to_string(),
        supervised_pid.to_string(),
        "--supervise-start-id".to_string(),
        supervised_start_id.to_string(),
    ];
    let arguments = args
        .iter()
        .map(|arg| format!("        <string>{}</string>", xml_escape(arg)))
        .collect::<Vec<_>>()
        .join("\n");
    let payload = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n    <key>Label</key>\n    <string>{}</string>\n    <key>ProgramArguments</key>\n    <array>\n{}\n    </array>\n    <key>EnvironmentVariables</key>\n    <dict><key>PULSESYNC_RECOVERY_AGENT</key><string>1</string></dict>\n    <key>RunAtLoad</key>\n    <true/>\n    <key>KeepAlive</key>\n    <dict><key>SuccessfulExit</key><false/></dict>\n    <key>ThrottleInterval</key>\n    <integer>5</integer>\n    <key>StandardOutPath</key>\n    <string>{}</string>\n    <key>StandardErrorPath</key>\n    <string>{}</string>\n    <key>ProcessType</key>\n    <string>Background</string>\n</dict>\n</plist>\n",
        xml_escape(&label),
        arguments,
        xml_escape(&stdout_log.to_string_lossy()),
        xml_escape(&stderr_log.to_string_lossy()),
    );
    fs::write(&plist, payload)?;
    let domain = format!("gui/{}", effective_user_id()?);
    let output = Command::new("/bin/launchctl")
        .args(["bootstrap", &domain])
        .arg(&plist)
        .output()?;
    if !output.status.success() {
        let _ = fs::remove_file(&plist);
        return Err(format!(
            "launchctl bootstrap failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )
        .into());
    }
    transaction["recoveryAgentReady"] = json!(true);
    transaction["recoveryAgentMode"] = json!("launch-agent");
    write_json_atomic(transaction_file, &transaction)?;
    Ok(())
}

pub fn remove_recovery_agent(transaction_file: &Path) -> Result<()> {
    let mut transaction = read_transaction(transaction_file)?;
    let label = transaction
        .get("recoveryAgentLabel")
        .and_then(Value::as_str)
        .map(str::to_string);
    let plist = transaction
        .get("recoveryAgentPlist")
        .and_then(Value::as_str)
        .map(PathBuf::from);
    if let Some(plist) = plist {
        match fs::remove_file(&plist) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        if let Some(label) = label.as_deref() {
            let service = format!("gui/{}/{}", effective_user_id()?, label);
            transaction["recoveryAgentCleanup"] = json!("bootout-requested");
            write_json_atomic(transaction_file, &transaction)?;
            let output = Command::new("/bin/launchctl")
                .args(["bootout", &service])
                .output()?;
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !output.status.success()
                && !stderr.contains("Could not find service")
                && !stderr.contains("No such process")
            {
                return Err(format!("launchctl bootout failed: {}", stderr.trim()).into());
            }
        }
        transaction["recoveryAgentPlist"] = Value::Null;
        transaction["recoveryAgentLabel"] = Value::Null;
        transaction["recoveryAgentCleanup"] = json!("complete");
        write_json_atomic(transaction_file, &transaction)?;
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
