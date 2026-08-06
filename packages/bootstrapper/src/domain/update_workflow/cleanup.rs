use super::{
    UPDATE_LOCK_TIMEOUT,
    common::{
        paths_match, referenced_by_transaction, remove_contained_directory, scoped_update_path,
        value_path,
    },
};
use crate::{
    core::{
        error::Result,
        layout::{canonical_install_root, is_inside, resolve_layout},
        operation_lock::UpdateLock,
    },
    domain::{
        macos_bundle,
        transactions::{TransactionRecord, transaction_records},
    },
};
use serde_json::Value;
use std::path::{Path, PathBuf};

struct TerminalWorkspace {
    transaction_dir: PathBuf,
    staging_dir: PathBuf,
    staging_root: PathBuf,
    backup_dir: PathBuf,
    backup_root: PathBuf,
}

fn terminal_standard_transaction(record: &TransactionRecord) -> bool {
    matches!(record.candidate.state.as_str(), "applied" | "rolled-back")
        && !macos_bundle::is_macos_transaction(&record.value)
}

fn validate_workspace(
    install_root: &Path,
    updates_dir: &Path,
    transaction_root: &Path,
    record: &TransactionRecord,
) -> Result<TerminalWorkspace> {
    let transaction_dir = record
        .candidate
        .path
        .parent()
        .map(Path::to_path_buf)
        .ok_or("terminal transaction file has no parent directory")?;
    let recorded_transaction_dir = value_path(&record.value, "transactionDir")
        .ok_or("terminal transaction is missing transactionDir")?;
    let staging_dir = value_path(&record.value, "stagingDir")
        .ok_or("terminal transaction is missing stagingDir")?;
    let backup_dir = value_path(&record.value, "backupDir")
        .ok_or("terminal transaction is missing backupDir")?;
    let channel = record
        .value
        .get("channel")
        .and_then(Value::as_str)
        .ok_or("terminal transaction is missing channel")?;
    let bundle_version = record
        .value
        .get("bundleVersion")
        .and_then(Value::as_str)
        .ok_or("terminal transaction is missing bundleVersion")?;
    let dist = record
        .value
        .get("dist")
        .and_then(Value::as_str)
        .ok_or("terminal transaction is missing dist")?;
    let transaction_id = record
        .value
        .get("transactionId")
        .and_then(Value::as_str)
        .ok_or("terminal transaction is missing transactionId")?;
    let staging_root = staging_dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .ok_or("terminal transaction stagingDir has an invalid shape")?;
    let backup_root = staging_root.join("backups");
    let expected_transaction_dir =
        scoped_update_path(transaction_root, channel, bundle_version, dist)
            .map(|path| path.join(transaction_id))
            .ok_or("terminal transaction path contains an unsafe segment")?;
    let expected_staging_dir = scoped_update_path(&staging_root, channel, bundle_version, dist)
        .ok_or("terminal staging path contains an unsafe segment")?;
    let expected_backup_dir = scoped_update_path(&backup_root, channel, bundle_version, dist)
        .ok_or("terminal backup path contains an unsafe segment")?;
    let plan_file =
        value_path(&record.value, "planFile").ok_or("terminal transaction is missing planFile")?;
    let recorded_install_root = value_path(&record.value, "installDir")
        .ok_or("terminal transaction is missing installDir")?;

    if record.value.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || !paths_match(&transaction_dir, &recorded_transaction_dir)
        || !paths_match(&transaction_dir, &expected_transaction_dir)
        || !is_inside(transaction_root, &transaction_dir)
        || paths_match(&staging_root, updates_dir)
        || !is_inside(updates_dir, &staging_root)
        || is_inside(transaction_root, &staging_root)
        || !paths_match(&staging_dir, &expected_staging_dir)
        || !paths_match(&backup_dir, &expected_backup_dir)
        || !paths_match(&plan_file, &staging_dir.join("install-plan.json"))
        || !paths_match(&recorded_install_root, install_root)
    {
        return Err("terminal transaction paths are outside the canonical update layout".into());
    }

    Ok(TerminalWorkspace {
        transaction_dir,
        staging_dir,
        staging_root,
        backup_dir,
        backup_root,
    })
}

pub fn cleanup_terminal_update_workspaces(install_root: &Path) -> Result<Vec<PathBuf>> {
    let install_root = canonical_install_root(install_root)?;
    let _update_lock = UpdateLock::acquire(&install_root, UPDATE_LOCK_TIMEOUT)?;
    let layout = resolve_layout(install_root.clone(), None)?;
    let mut records = transaction_records(&layout.transaction_root)?;
    let terminal = records
        .iter()
        .filter(|record| terminal_standard_transaction(record))
        .cloned()
        .collect::<Vec<_>>();
    let mut removed = Vec::new();

    for record in terminal {
        let remaining = records
            .iter()
            .filter(|candidate| candidate.candidate.path != record.candidate.path)
            .cloned()
            .collect::<Vec<_>>();
        let workspace = match validate_workspace(
            &layout.install_root,
            &layout.updates_dir,
            &layout.transaction_root,
            &record,
        ) {
            Ok(workspace) => workspace,
            Err(error) => {
                eprintln!(
                    "terminal update cache cleanup skipped for {}: {error}",
                    record.candidate.path.display()
                );
                continue;
            }
        };

        let cleanup_result = (|| -> Result<()> {
            if !referenced_by_transaction(&remaining, &workspace.staging_dir)
                && remove_contained_directory(&workspace.staging_dir, &workspace.staging_root)?
            {
                removed.push(workspace.staging_dir.clone());
            }
            if !referenced_by_transaction(&remaining, &workspace.backup_dir)
                && remove_contained_directory(&workspace.backup_dir, &workspace.backup_root)?
            {
                removed.push(workspace.backup_dir.clone());
            }
            if remove_contained_directory(&workspace.transaction_dir, &layout.transaction_root)? {
                removed.push(workspace.transaction_dir.clone());
            }
            Ok(())
        })();
        if let Err(error) = cleanup_result {
            eprintln!(
                "terminal update cache cleanup deferred for {}: {error}",
                record.candidate.path.display()
            );
            continue;
        }
        records.retain(|candidate| candidate.candidate.path != record.candidate.path);
    }

    Ok(removed)
}
