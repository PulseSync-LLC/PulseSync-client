use crate::{
    core::{
        error::Result,
        install_state::{
            ActivationState, InstallStateV3, RuntimeActivationV3, read_install_state_metadata,
            write_install_state,
        },
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

fn install_state_before(transaction: &Value) -> Result<Option<InstallStateV3>> {
    transaction
        .get("installStateBefore")
        .cloned()
        .map(serde_json::from_value)
        .transpose()
        .map_err(Into::into)
}

fn restore_install_state(
    transaction: &mut Value,
    previous_state: Option<InstallStateV3>,
) -> Result<()> {
    let install_dir = PathBuf::from(
        transaction
            .get("installDir")
            .and_then(Value::as_str)
            .ok_or("installDir is required to restore install state")?,
    );
    let mut state = match previous_state {
        Some(state) => {
            let path = write_install_state(&install_dir, &state)?;
            transaction["installStateRestored"] = json!({
                "state": "restored-snapshot",
                "generation": state.generation,
                "path": path
            });
            return Ok(());
        }
        None => read_install_state_metadata(&install_dir)?,
    };
    if !matches!(state.activation.state, ActivationState::Pending) {
        transaction["installStateRestored"] = json!({
            "state": "unchanged",
            "generation": state.generation,
            "path": crate::core::install_state::install_state_path(&install_dir)
        });
        return Ok(());
    }
    state.latest = state.known_good.clone();
    state.running = state.known_good.clone();
    state.generation = state
        .generation
        .checked_add(1)
        .ok_or("install-state generation overflow")?;
    state.activation = RuntimeActivationV3 {
        state: ActivationState::Confirmed,
        generation: state.generation,
        launch_owner: None,
    };
    let path = write_install_state(&install_dir, &state)?;
    transaction["installStateRestored"] =
        json!({ "state": "restored", "generation": state.generation, "path": path });
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
    if state != "applied" && state != "failed" && state != "applying" {
        return Err(format!("transaction cannot be rolled back from state: {state}").into());
    }

    let artifacts = transaction_artifacts(&transaction)?;
    let previous_state = install_state_before(&transaction)?;
    let mut rolled_back = Vec::new();
    for artifact in artifacts.into_iter().rev() {
        let rollback_status = if artifact.backup_path.exists() {
            remove_target(&artifact.target_path)?;
            if let Some(parent) = artifact.target_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::rename(&artifact.backup_path, &artifact.target_path)?;
            "restored"
        } else if artifact.target_existed == Some(true) {
            "preserved"
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
    restore_install_state(&mut transaction, previous_state)?;

    transaction["state"] = json!("rolled-back");
    transaction["rolledBack"] = json!(true);
    transaction["artifacts"] = Value::Array(rolled_back);
    write_transaction(transaction_file, &transaction)?;
    Ok(transaction)
}
