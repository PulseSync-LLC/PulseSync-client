use crate::{
    core::{
        error::Result,
        layout::{clear_current_version, write_current_version},
    },
    domain::transactions::store::{transaction_artifacts, write_transaction},
};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
};

fn remove_target(path: &Path) -> Result<bool> {
    if !path.exists() {
        return Ok(false);
    }
    if path.is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(true)
}

fn restore_current_version(transaction: &mut Value) -> Result<()> {
    if transaction
        .get("currentVersion")
        .and_then(Value::as_str)
        .is_none()
        && transaction
            .get("previousCurrentVersion")
            .and_then(Value::as_str)
            .is_none()
    {
        return Ok(());
    }

    let install_dir = PathBuf::from(
        transaction
            .get("installDir")
            .and_then(Value::as_str)
            .ok_or("installDir is required to restore current version")?,
    );
    let restored = match transaction
        .get("previousCurrentVersion")
        .and_then(Value::as_str)
    {
        Some(previous_version) => {
            let path = write_current_version(&install_dir, previous_version)?;
            json!({
                "state": "restored",
                "version": previous_version,
                "currentVersionFile": path,
            })
        }
        None => {
            let path = clear_current_version(&install_dir)?;
            json!({
                "state": "cleared",
                "currentVersionFile": path,
            })
        }
    };

    transaction["currentVersionRestored"] = restored;
    Ok(())
}

pub fn rollback_transaction_file(transaction_file: &Path) -> Result<Value> {
    let payload = fs::read_to_string(transaction_file)?;
    let mut transaction: Value = serde_json::from_str(&payload)?;
    let state = transaction
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if state == "rolled-back" {
        return Ok(transaction);
    }
    if state != "applied" && state != "failed" {
        return Err(format!("transaction cannot be rolled back from state: {state}").into());
    }

    let artifacts = transaction_artifacts(&transaction)?;
    let mut rolled_back = Vec::new();
    for artifact in artifacts {
        let rollback_status = if artifact.backup_path.exists() {
            remove_target(&artifact.target_path)?;
            if let Some(parent) = artifact.target_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::rename(&artifact.backup_path, &artifact.target_path)?;
            "restored"
        } else if remove_target(&artifact.target_path)? {
            "removed"
        } else {
            "missing"
        };
        rolled_back.push(json!({
            "key": artifact.key,
            "backupPath": artifact.backup_path,
            "targetPath": artifact.target_path,
            "rollbackStatus": rollback_status
        }));
    }

    transaction["state"] = json!("rolled-back");
    transaction["rolledBack"] = json!(true);
    transaction["artifacts"] = Value::Array(rolled_back);
    restore_current_version(&mut transaction)?;
    write_transaction(transaction_file, &transaction)?;
    Ok(transaction)
}
