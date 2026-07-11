use super::{
    DISCARD_COMMAND, DiscardPreparedUpdateResult, DiscardReason, RemovedPreparedState,
    UPDATE_LOCK_TIMEOUT, UpdateWorkflowError,
    common::{
        current_install_is_safe, paths_match, reject_live_self_update, scoped_update_path,
        value_path, workflow_error,
    },
};
use crate::{
    core::{
        error::Result as CoreResult,
        layout::{assert_inside, canonical_install_root, is_inside, resolve_layout},
        operation_lock::UpdateLock,
    },
    domain::{
        macos_bundle,
        transactions::{
            TransactionRecord, transaction_artifacts, transaction_records, transactions_with_id,
        },
    },
};
use serde_json::Value;
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;

fn referenced_by_other_transaction(records: &[TransactionRecord], candidate: &Path) -> bool {
    records.iter().any(|record| {
        let references = ["transactionDir", "stagingDir", "backupDir", "planFile"]
            .into_iter()
            .filter_map(|key| value_path(&record.value, key))
            .chain(
                record
                    .value
                    .get("artifacts")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .flat_map(|artifact| {
                        ["sourcePath", "backupPath", "preparedPath"]
                            .into_iter()
                            .filter_map(|key| value_path(artifact, key))
                    }),
            );
        references.into_iter().any(|path| {
            paths_match(candidate, &path)
                || is_inside(candidate, &path)
                || is_inside(&path, candidate)
        })
    })
}

fn remove_contained_directory(path: &Path, root: &Path) -> CoreResult<bool> {
    if !path.exists() {
        return Ok(false);
    }
    if paths_match(path, root) || !is_inside(root, path) {
        return Err(format!(
            "refusing to remove directory outside owned root: {}",
            path.display()
        )
        .into());
    }
    fs::remove_dir_all(path)?;
    Ok(true)
}

pub fn discard_prepared_update(
    install_root: PathBuf,
    transaction_id: String,
) -> std::result::Result<DiscardPreparedUpdateResult, UpdateWorkflowError> {
    if Uuid::parse_str(&transaction_id).is_err() {
        return Err(workflow_error(
            DISCARD_COMMAND,
            "invalid-transaction-id",
            "validate-input",
            "transaction id must be a UUID",
            false,
            false,
        ));
    }
    let install_root = canonical_install_root(&install_root).map_err(|error| {
        workflow_error(
            DISCARD_COMMAND,
            "unsafe-install-root",
            "validate-input",
            error,
            false,
            false,
        )
    })?;
    let prelock_layout = resolve_layout(install_root.clone(), None).ok();
    let prelock_safe = prelock_layout
        .as_ref()
        .is_some_and(|layout| current_install_is_safe(layout, None));
    let _update_lock =
        UpdateLock::acquire(&install_root, UPDATE_LOCK_TIMEOUT).map_err(|error| {
            workflow_error(
                DISCARD_COMMAND,
                "update-busy",
                "lock",
                error,
                true,
                prelock_safe,
            )
        })?;
    reject_live_self_update(&install_root, DISCARD_COMMAND, prelock_safe)?;
    let layout = resolve_layout(install_root, None).map_err(|error| {
        workflow_error(
            DISCARD_COMMAND,
            "layout-resolution-failed",
            "validate-input",
            error,
            false,
            false,
        )
    })?;
    let safe_to_continue = current_install_is_safe(&layout, None);
    if !is_inside(&layout.install_root, &layout.updates_dir)
        || !is_inside(&layout.updates_dir, &layout.transaction_root)
    {
        return Err(workflow_error(
            DISCARD_COMMAND,
            "unsafe-transaction-layout",
            "discard",
            "update directories escape the canonical install root",
            false,
            safe_to_continue,
        ));
    }
    let mut matches =
        transactions_with_id(&layout.transaction_root, &transaction_id).map_err(|error| {
            workflow_error(
                DISCARD_COMMAND,
                "transaction-scan-failed",
                "discard",
                error,
                false,
                safe_to_continue,
            )
        })?;
    let empty_removed = RemovedPreparedState {
        transaction: false,
        staging: false,
        backup: false,
    };
    if matches.is_empty() {
        return Ok(DiscardPreparedUpdateResult {
            schema_version: 1,
            state: "not-found".to_string(),
            transaction_id,
            target_version: None,
            reason: DiscardReason {
                code: "transaction-not-found".to_string(),
                retryable: false,
                safe_to_continue,
            },
            removed: empty_removed,
        });
    }
    if matches.len() != 1 {
        return Ok(DiscardPreparedUpdateResult {
            schema_version: 1,
            state: "blocked".to_string(),
            transaction_id,
            target_version: None,
            reason: DiscardReason {
                code: "transaction-ambiguous".to_string(),
                retryable: false,
                safe_to_continue,
            },
            removed: empty_removed,
        });
    }
    let record = matches.remove(0);
    let target_version = record
        .value
        .get("targetVersion")
        .and_then(Value::as_str)
        .map(str::to_string);
    if record.candidate.state != "prepared" {
        return Ok(DiscardPreparedUpdateResult {
            schema_version: 1,
            state: "blocked".to_string(),
            transaction_id,
            target_version,
            reason: DiscardReason {
                code: "transaction-not-prepared".to_string(),
                retryable: false,
                safe_to_continue,
            },
            removed: empty_removed,
        });
    }

    if macos_bundle::is_macos_transaction(&record.value) {
        let transaction_dir = record
            .candidate
            .path
            .parent()
            .map(Path::to_path_buf)
            .ok_or_else(|| {
                workflow_error(
                    DISCARD_COMMAND,
                    "unsafe-transaction-layout",
                    "discard",
                    "macOS transaction file has no parent directory",
                    false,
                    safe_to_continue,
                )
            })?;
        let recorded_state_root = value_path(&record.value, "stateRoot");
        let staging_dir = value_path(&record.value, "stagingDir");
        if !is_inside(&layout.transaction_root, &transaction_dir)
            || recorded_state_root
                .as_ref()
                .is_none_or(|root| !paths_match(root, &layout.state_root))
            || staging_dir
                .as_ref()
                .is_none_or(|path| !is_inside(&layout.updates_dir, path))
        {
            return Err(workflow_error(
                DISCARD_COMMAND,
                "unsafe-transaction-layout",
                "discard",
                "macOS transaction paths are outside the state root",
                false,
                safe_to_continue,
            ));
        }
        fs::remove_dir_all(&transaction_dir).map_err(|error| {
            workflow_error(
                DISCARD_COMMAND,
                "transaction-discard-failed",
                "discard",
                error,
                false,
                safe_to_continue,
            )
        })?;
        let staging_removed = staging_dir.as_ref().is_some_and(|path| {
            remove_contained_directory(path, &layout.updates_dir).unwrap_or(false)
        });
        return Ok(DiscardPreparedUpdateResult {
            schema_version: 1,
            state: "discarded".to_string(),
            transaction_id,
            target_version,
            reason: DiscardReason {
                code: "discarded".to_string(),
                retryable: false,
                safe_to_continue,
            },
            removed: RemovedPreparedState {
                transaction: true,
                staging: staging_removed,
                backup: false,
            },
        });
    }

    let transaction_dir = record
        .candidate
        .path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            workflow_error(
                DISCARD_COMMAND,
                "unsafe-transaction-layout",
                "discard",
                "transaction file has no parent directory",
                false,
                safe_to_continue,
            )
        })?;
    let recorded_transaction_dir =
        value_path(&record.value, "transactionDir").ok_or_else(|| {
            workflow_error(
                DISCARD_COMMAND,
                "unsafe-transaction-layout",
                "discard",
                "transaction is missing transactionDir",
                false,
                safe_to_continue,
            )
        })?;
    let staging_dir = value_path(&record.value, "stagingDir").ok_or_else(|| {
        workflow_error(
            DISCARD_COMMAND,
            "unsafe-transaction-layout",
            "discard",
            "transaction is missing stagingDir",
            false,
            safe_to_continue,
        )
    })?;
    let backup_dir = value_path(&record.value, "backupDir").ok_or_else(|| {
        workflow_error(
            DISCARD_COMMAND,
            "unsafe-transaction-layout",
            "discard",
            "transaction is missing backupDir",
            false,
            safe_to_continue,
        )
    })?;
    let channel = record
        .value
        .get("channel")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            workflow_error(
                DISCARD_COMMAND,
                "unsafe-transaction-layout",
                "discard",
                "transaction is missing channel",
                false,
                safe_to_continue,
            )
        })?;
    let dist = record
        .value
        .get("dist")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            workflow_error(
                DISCARD_COMMAND,
                "unsafe-transaction-layout",
                "discard",
                "transaction is missing dist",
                false,
                safe_to_continue,
            )
        })?;
    let target_version_value = target_version.as_deref().ok_or_else(|| {
        workflow_error(
            DISCARD_COMMAND,
            "unsafe-transaction-layout",
            "discard",
            "transaction is missing targetVersion",
            false,
            safe_to_continue,
        )
    })?;
    let staging_root = staging_dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            workflow_error(
                DISCARD_COMMAND,
                "unsafe-transaction-layout",
                "discard",
                "transaction stagingDir does not have the canonical channel/version/dist shape",
                false,
                safe_to_continue,
            )
        })?;
    let backup_root = staging_root.join("backups");
    let discard_root = layout.updates_dir.join("discarded");
    let expected_transaction_dir = scoped_update_path(
        &layout.transaction_root,
        channel,
        target_version_value,
        dist,
    )
    .map(|path| path.join(&transaction_id));
    let expected_staging_dir =
        scoped_update_path(&staging_root, channel, target_version_value, dist);
    let expected_backup_dir = scoped_update_path(&backup_root, channel, target_version_value, dist);
    let plan_file = value_path(&record.value, "planFile");
    let install_dir = value_path(&record.value, "installDir");
    let artifacts = transaction_artifacts(&record.value).map_err(|error| {
        workflow_error(
            DISCARD_COMMAND,
            "unsafe-transaction-layout",
            "discard",
            error,
            false,
            safe_to_continue,
        )
    })?;
    let mut artifact_keys = BTreeSet::new();
    let artifacts_contained = !artifacts.is_empty()
        && artifacts.iter().all(|artifact| {
            artifact_keys.insert(artifact.key.clone())
                && is_inside(&transaction_dir, &artifact.prepared_path)
                && is_inside(&staging_dir, &artifact.source_path)
                && is_inside(&backup_dir, &artifact.backup_path)
                && is_inside(&layout.install_root, &artifact.target_path)
        });
    if record.value.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || record.value.get("transactionId").and_then(Value::as_str)
            != Some(transaction_id.as_str())
        || !paths_match(&transaction_dir, &recorded_transaction_dir)
        || expected_transaction_dir
            .as_ref()
            .is_none_or(|expected| !paths_match(&transaction_dir, expected))
        || transaction_dir.file_name().and_then(|value| value.to_str())
            != Some(transaction_id.as_str())
        || !is_inside(&layout.transaction_root, &transaction_dir)
        || paths_match(&staging_root, &layout.updates_dir)
        || !is_inside(&layout.updates_dir, &staging_root)
        || is_inside(&layout.transaction_root, &staging_root)
        || is_inside(&discard_root, &staging_root)
        || paths_match(&staging_dir, &staging_root)
        || !is_inside(&staging_root, &staging_dir)
        || expected_staging_dir
            .as_ref()
            .is_none_or(|expected| !paths_match(&staging_dir, expected))
        || paths_match(&backup_dir, &backup_root)
        || !is_inside(&backup_root, &backup_dir)
        || expected_backup_dir
            .as_ref()
            .is_none_or(|expected| !paths_match(&backup_dir, expected))
        || plan_file
            .as_ref()
            .is_none_or(|path| !paths_match(path, &staging_dir.join("install-plan.json")))
        || install_dir
            .as_ref()
            .is_none_or(|path| !paths_match(path, &layout.install_root))
        || !artifacts_contained
    {
        return Err(workflow_error(
            DISCARD_COMMAND,
            "unsafe-transaction-layout",
            "discard",
            "transaction paths are outside the canonical update layout",
            false,
            safe_to_continue,
        ));
    }

    fs::create_dir_all(&discard_root).map_err(|error| {
        workflow_error(
            DISCARD_COMMAND,
            "discard-quarantine-failed",
            "discard",
            error,
            false,
            safe_to_continue,
        )
    })?;
    let quarantined = discard_root.join(format!("{}-{}", transaction_id, Uuid::new_v4()));
    assert_inside(&layout.updates_dir, &quarantined, "discard quarantine").map_err(|error| {
        workflow_error(
            DISCARD_COMMAND,
            "unsafe-discard-quarantine",
            "discard",
            error,
            false,
            safe_to_continue,
        )
    })?;
    fs::rename(&transaction_dir, &quarantined).map_err(|error| {
        workflow_error(
            DISCARD_COMMAND,
            "transaction-quarantine-failed",
            "discard",
            error,
            false,
            safe_to_continue,
        )
    })?;
    let remaining = transaction_records(&layout.transaction_root).map_err(|error| {
        workflow_error(
            DISCARD_COMMAND,
            "transaction-rescan-failed",
            "discard",
            error,
            false,
            safe_to_continue,
        )
    })?;
    let remove_staging = !referenced_by_other_transaction(&remaining, &staging_dir);
    let remove_backup = !referenced_by_other_transaction(&remaining, &backup_dir);
    let staging_removed = if remove_staging {
        remove_contained_directory(&staging_dir, &staging_root).map_err(|error| {
            workflow_error(
                DISCARD_COMMAND,
                "staging-discard-failed",
                "discard",
                error,
                false,
                safe_to_continue,
            )
        })?
    } else {
        false
    };
    let backup_removed = if remove_backup {
        remove_contained_directory(&backup_dir, &backup_root).map_err(|error| {
            workflow_error(
                DISCARD_COMMAND,
                "backup-discard-failed",
                "discard",
                error,
                false,
                safe_to_continue,
            )
        })?
    } else {
        false
    };
    fs::remove_dir_all(&quarantined).map_err(|error| {
        workflow_error(
            DISCARD_COMMAND,
            "transaction-discard-failed",
            "discard",
            error,
            false,
            safe_to_continue,
        )
    })?;

    Ok(DiscardPreparedUpdateResult {
        schema_version: 1,
        state: "discarded".to_string(),
        transaction_id,
        target_version,
        reason: DiscardReason {
            code: "discarded".to_string(),
            retryable: false,
            safe_to_continue,
        },
        removed: RemovedPreparedState {
            transaction: true,
            staging: staging_removed,
            backup: backup_removed,
        },
    })
}
