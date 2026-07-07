use crate::{
    core::error::Result,
    domain::transactions::store::{transaction_artifacts, write_transaction},
};
use serde_json::{Value, json};
use std::{fs, path::Path};

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
            if artifact.target_path.exists() {
                if artifact.target_path.is_dir() {
                    fs::remove_dir_all(&artifact.target_path)?;
                } else {
                    fs::remove_file(&artifact.target_path)?;
                }
            }
            if let Some(parent) = artifact.target_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::rename(&artifact.backup_path, &artifact.target_path)?;
            "restored"
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
    write_transaction(transaction_file, &transaction)?;
    Ok(transaction)
}
