use crate::{
    cli::args::{Args, arg_value, required_arg, required_state_root},
    commands::start::{HandoffContext, launch_handoff_successor, launch_with_active_lease},
    core::{
        active_app::{
            HandoffTransferState, current_process_identity, mark_handoff_launch_failed,
            process_start_is_live, read_active_lease, read_handoff_transfer,
            take_over_failed_handoff, write_json_atomic,
        },
        error::Result,
        layout::{assert_inside, canonical_install_root, resolve_layout, resolve_macos_layout},
        operation_lock::UpdateLock,
        self_update::{
            read_self_update_reservation, remove_self_update_reservation, write_self_update_result,
        },
        session_lock::SessionLock,
    },
    domain::{
        macos_bundle,
        transactions::{apply_transaction_file, transaction_artifacts},
    },
};
use serde_json::{Value, json};
use std::{
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

const SELF_UPDATE_LOCK_TIMEOUT: Duration = Duration::from_secs(60);
const PARENT_WAIT_TIMEOUT: Duration = Duration::from_secs(60);

fn paths_match(left: &Path, right: &Path) -> bool {
    let left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
    if cfg!(windows) {
        left.to_string_lossy()
            .replace('/', "\\")
            .eq_ignore_ascii_case(&right.to_string_lossy().replace('/', "\\"))
    } else {
        left == right
    }
}

fn wait_for_parent_exit(pid: u32, process_start_id: &str) -> Result<bool> {
    let started = Instant::now();
    while process_start_is_live(pid, process_start_id)? {
        if started.elapsed() >= PARENT_WAIT_TIMEOUT {
            return Ok(false);
        }
        thread::sleep(Duration::from_millis(25));
    }
    Ok(true)
}

fn transaction_contains_current_bootstrapper(
    transaction_file: &Path,
    current_executable: &Path,
) -> Result<bool> {
    let transaction: Value = serde_json::from_slice(&fs::read(transaction_file)?)?;
    Ok(transaction_artifacts(&transaction)?
        .into_iter()
        .any(|artifact| {
            artifact.key == "bootstrapper"
                && paths_match(&artifact.prepared_path, current_executable)
        }))
}

pub fn complete_self_update(args: &Args) -> Result<Value> {
    match complete_self_update_inner(args) {
        Ok(result) => Ok(result),
        Err(error) => {
            if let Ok(state_root) = required_state_root(args) {
                let install_root = PathBuf::from(state_root);
                let reservation = read_self_update_reservation(&install_root).ok().flatten();
                let payload = json!({
                    "schemaVersion": 1,
                    "state": "error",
                    "command": "complete-self-update",
                    "error": error.to_string(),
                    "handoffId": reservation.as_ref().map(|value| value.id.as_str()),
                    "parentPid": reservation.as_ref().map(|value| value.parent_pid),
                    "childPid": reservation.as_ref().map(|value| value.child_pid),
                });
                let _ = write_json_atomic(
                    &install_root.join("updates/self-update-handoff-error.json"),
                    &payload,
                );
            }
            Err(error)
        }
    }
}

fn complete_self_update_inner(args: &Args) -> Result<Value> {
    let install_root = canonical_install_root(&PathBuf::from(required_state_root(args)?))?;
    let transaction_file = PathBuf::from(required_arg(args, "--transaction-file")?);
    let transaction_value: Value = serde_json::from_slice(&fs::read(&transaction_file)?)?;
    let is_macos_bundle = macos_bundle::is_macos_transaction(&transaction_value);
    let expected_reservation_id = env::var("PULSESYNC_SELF_UPDATE_HANDOFF_ID")
        .map_err(|_| "PULSESYNC_SELF_UPDATE_HANDOFF_ID is required")?;
    let current_process = current_process_identity()?;

    let mut session_lock = Some(SessionLock::acquire(
        &install_root,
        Duration::from_secs(10),
    )?);
    let reservation = read_self_update_reservation(&install_root)?
        .ok_or("self-update handoff reservation is missing")?;
    if reservation.id != expected_reservation_id
        || reservation.child_pid != current_process.pid
        || reservation.child_process_start_id != current_process.process_start_id
        || !paths_match(
            &reservation.prepared_executable,
            &current_process.executable,
        )
    {
        return Err("self-update handoff reservation identity mismatch".into());
    }
    let host_bundle = arg_value(args, "--host-bundle").map(PathBuf::from);
    let explicit_app_executable = PathBuf::from(required_arg(args, "--app-executable")?);
    let layout = if let Some(host_bundle) = host_bundle.as_ref() {
        resolve_macos_layout(
            install_root.clone(),
            host_bundle.clone(),
            explicit_app_executable.clone(),
        )?
    } else {
        resolve_layout(
            install_root.clone(),
            arg_value(args, "--app-executable-name"),
        )?
    };
    assert_inside(
        &layout.transaction_root,
        &transaction_file,
        "self-update transaction file",
    )?;
    if is_macos_bundle {
        if !macos_bundle::transaction_helper_matches(
            &transaction_file,
            &current_process.executable,
        )? {
            return Err("macOS transaction helper identity mismatch".into());
        }
        if !macos_bundle::recovery_agent_ready(&transaction_file)? {
            return Err("macOS recovery agent activation was not durably acknowledged".into());
        }
        if !macos_bundle::app_handoff_bound(&transaction_file)? {
            return Err("macOS bundle exchange requires a transaction-bound app handoff".into());
        }
    } else if !transaction_contains_current_bootstrapper(
        &transaction_file,
        &current_process.executable,
    )? {
        return Err(
            "self-update transaction does not contain the running prepared bootstrapper".into(),
        );
    }

    drop(session_lock.take());
    if !wait_for_parent_exit(reservation.parent_pid, &reservation.parent_process_start_id)? {
        return Ok(json!({
            "schemaVersion": 1,
            "state": "blocked",
            "launched": false,
            "block": {
                "code": "self-update-parent-timeout",
                "retryable": true,
                "safeToContinue": false,
            }
        }));
    }

    let _update_lock = UpdateLock::acquire(&install_root, SELF_UPDATE_LOCK_TIMEOUT)?;
    session_lock = Some(SessionLock::acquire(
        &install_root,
        Duration::from_secs(10),
    )?);
    let mut handoff_context = match (
        reservation.app_handoff_id.as_deref(),
        reservation.active_lease_id.as_deref(),
        reservation.inbox_id.as_deref(),
        reservation.inbox_generation,
    ) {
        (Some(handoff_id), Some(active_lease_id), Some(inbox_id), Some(inbox_generation)) => {
            let predecessor = read_active_lease(&install_root)?
                .ok_or("self-update predecessor lease is missing")?;
            let transfer = read_handoff_transfer(&install_root, handoff_id)?
                .ok_or("self-update app handoff transfer is missing")?;
            if predecessor.lease_id != active_lease_id
                || predecessor.inbox_id != inbox_id
                || predecessor.inbox_generation != inbox_generation
                || transfer.state != HandoffTransferState::Armed
                || reservation.transfer_state.as_deref() != Some("armed")
            {
                return Err("self-update app handoff binding mismatch".into());
            }
            let (predecessor, transfer) =
                take_over_failed_handoff(&install_root, &predecessor, &transfer, &current_process)?;
            Some(HandoffContext {
                predecessor,
                transfer,
                rust_process: current_process.clone(),
            })
        }
        (None, None, None, None) => None,
        _ => return Err("self-update reservation has a partial app handoff binding".into()),
    };
    let consumed = write_self_update_result(&install_root, "consumed", &reservation)?;
    remove_self_update_reservation(&install_root)?;
    drop(session_lock.take());

    let applied = if is_macos_bundle {
        macos_bundle::exchange_transaction(&transaction_file)?
    } else {
        apply_transaction_file(&transaction_file)?
    };
    let expected_applied_state = if is_macos_bundle {
        "verified"
    } else {
        "applied"
    };
    if applied.get("state").and_then(Value::as_str) != Some(expected_applied_state) {
        if let Some(context) = handoff_context.as_mut() {
            let _session_lock = SessionLock::acquire(&install_root, Duration::from_secs(10))?;
            context.transfer = mark_handoff_launch_failed(&install_root, &context.transfer)?;
        }
        return Ok(json!({
            "schemaVersion": 1,
            "state": "blocked",
            "launched": false,
            "selfUpdate": consumed,
            "applyResult": applied,
            "block": {
                "code": "self-update-apply-failed",
                "retryable": true,
                "safeToContinue": false,
            }
        }));
    }

    let launch_executable = if is_macos_bundle {
        explicit_app_executable
    } else {
        layout.app_executable.clone()
    };
    if !launch_executable.is_file() {
        return Err("self-update target app executable is missing".into());
    }
    let passthrough_args = args
        .passthrough
        .iter()
        .map(OsString::from)
        .collect::<Vec<_>>();
    let launch_result = if let Some(context) = handoff_context.as_mut() {
        launch_handoff_successor(
            &install_root,
            context,
            &launch_executable,
            &passthrough_args,
        )
        .map(|(pid, lease)| (pid, Some(lease)))
    } else {
        let _session_lock = SessionLock::acquire(&install_root, Duration::from_secs(10))?;
        launch_with_active_lease(Some(&install_root), &launch_executable, &passthrough_args)
    };
    let (pid, lease) = match launch_result {
        Ok(result) => result,
        Err(error) if is_macos_bundle => {
            let rollback = macos_bundle::rollback_transaction(&transaction_file)?;
            return Ok(json!({
                "schemaVersion": 1,
                "state": "blocked",
                "launched": false,
                "block": {
                    "code": "macos-successor-launch-failed",
                    "retryable": true,
                    "safeToContinue": true,
                },
                "error": error.to_string(),
                "rollback": rollback,
            }));
        }
        Err(error) => return Err(error),
    };
    if is_macos_bundle {
        {
            let _session_lock = SessionLock::acquire(&install_root, Duration::from_secs(10))?;
            macos_bundle::mark_successor_ready_for_claim(&transaction_file, pid)?;
        }
        let started = Instant::now();
        while !macos_bundle::startup_acknowledged(&transaction_file)?
            && started.elapsed() < Duration::from_secs(30)
        {
            thread::sleep(Duration::from_millis(50));
        }
        if !macos_bundle::startup_acknowledged(&transaction_file)? {
            let successor = lease
                .as_ref()
                .ok_or("macOS successor lease is missing during startup rollback")?;
            macos_bundle::signal_process(pid, false)?;
            let mut stopped = false;
            for _ in 0..100 {
                if !process_start_is_live(pid, &successor.process_start_id)? {
                    stopped = true;
                    break;
                }
                thread::sleep(Duration::from_millis(50));
            }
            if !stopped {
                macos_bundle::signal_process(pid, true)?;
                for _ in 0..100 {
                    if !process_start_is_live(pid, &successor.process_start_id)? {
                        stopped = true;
                        break;
                    }
                    thread::sleep(Duration::from_millis(50));
                }
            }
            if !stopped {
                return Ok(json!({
                    "schemaVersion": 1,
                    "state": "blocked",
                    "launched": false,
                    "block": {
                        "code": "macos-successor-still-live",
                        "retryable": true,
                        "safeToContinue": false,
                    }
                }));
            }
            let rollback = macos_bundle::rollback_transaction(&transaction_file)?;
            return Ok(json!({
                "schemaVersion": 1,
                "state": "blocked",
                "launched": false,
                "block": {
                    "code": "macos-startup-ack-timeout",
                    "retryable": true,
                    "safeToContinue": true,
                },
                "rollback": rollback,
            }));
        }
    }
    let finalized = if is_macos_bundle {
        let result = macos_bundle::finalize_transaction(&transaction_file)?;
        macos_bundle::remove_recovery_agent(&transaction_file)?;
        Some(result)
    } else {
        None
    };
    Ok(json!({
        "schemaVersion": 1,
        "state": "launched",
        "launched": true,
        "pid": pid,
        "lease": lease,
        "selfUpdate": consumed,
        "transactionFile": transaction_file,
        "applyResult": applied,
        "finalizeResult": finalized,
    }))
}
