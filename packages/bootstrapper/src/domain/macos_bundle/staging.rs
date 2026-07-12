use super::{
    MACOS_TRANSACTION_KIND, bundle_fingerprint, fingerprints_match, is_macos_transaction,
    read_transaction, recorded_fingerprint, remove_path, required_path, run_checked,
    validate_bundle, write_state,
};
use crate::{
    core::{
        active_app::write_json_atomic,
        error::Result,
        fs_ops::{ensure_executable, sha256_file},
        layout::{Layout, assert_inside, is_inside},
        packaged_runtime::packaged_bundle_version,
        path_segment::sanitize_path_segment,
    },
    domain::{
        artifacts::{ArtifactKey, artifact_file_name},
        manifest::BootstrapperUpdateDecision,
        update_workflow::PreparedTransactionRef,
    },
};
use serde_json::{Value, json};
use std::{
    fs::{self, OpenOptions},
    io::Read,
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

fn transaction_dir(
    layout: &Layout,
    decision: &BootstrapperUpdateDecision,
    id: &str,
) -> Result<PathBuf> {
    Ok(layout
        .transaction_root
        .join(sanitize_path_segment(&decision.channel)?)
        .join(sanitize_path_segment(&decision.bundle_version)?)
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
    let source_name = artifact_file_name(&artifacts.host, &ArtifactKey::Host)?;
    let staging_dir = staging_root
        .join(sanitize_path_segment(&decision.channel)?)
        .join(sanitize_path_segment(&decision.bundle_version)?)
        .join(sanitize_path_segment(&decision.dist)?);
    let source_path = staging_dir.join(source_name);
    let source_size = fs::metadata(&source_path)?.len();
    let source_sha = sha256_file(&source_path)?;
    if !source_sha.eq_ignore_ascii_case(&artifacts.host.sha256)
        || artifacts.host.size.is_some_and(|size| size != source_size)
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
        "bundleVersion": decision.bundle_version,
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
            "key": "host",
            "required": true,
            "fileOperations": [],
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

pub(super) fn validate_archive_entries(archive_path: &Path) -> Result<()> {
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

pub(super) fn cleanup_old_backups(backup_dir: &Path) -> Result<Vec<PathBuf>> {
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
    let packaged_version = packaged_bundle_version(&commit_slot)?;
    if new_fingerprint.bundle_version
        != transaction
            .get("bundleVersion")
            .and_then(Value::as_str)
            .ok_or("bundleVersion is missing")?
    {
        remove_path(&commit_slot)?;
        return Err("staged macOS bundle version does not match bundleVersion".into());
    }
    if packaged_version != new_fingerprint.bundle_version {
        remove_path(&commit_slot)?;
        return Err("staged macOS runtime descriptor does not match CFBundleVersion".into());
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
