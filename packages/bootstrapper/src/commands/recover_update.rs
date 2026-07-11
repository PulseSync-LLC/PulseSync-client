use crate::{
    cli::args::{Args, required_arg},
    core::{
        active_app::{process_start_is_live, read_active_lease},
        error::Result,
        operation_lock::UpdateLock,
        self_update::remove_self_update_reservation,
        session_lock::SessionLock,
    },
    domain::macos_bundle,
};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    process::{Command, Stdio},
    thread,
    time::Duration,
};

pub fn recover_update(args: &Args) -> Result<Value> {
    let transaction_file = PathBuf::from(required_arg(args, "--transaction-file")?);
    let supervised_pid = required_arg(args, "--supervise-pid")?
        .parse::<u32>()
        .map_err(|_| "--supervise-pid must be a positive process id")?;
    let supervised_start_id = required_arg(args, "--supervise-start-id")?;
    while process_start_is_live(supervised_pid, &supervised_start_id)? {
        thread::sleep(Duration::from_millis(100));
    }

    let state_root = macos_bundle::transaction_state_root(&transaction_file)?;
    let _update_lock = UpdateLock::acquire(&state_root, Duration::from_secs(60))?;
    let mut session_lock = Some(SessionLock::acquire(&state_root, Duration::from_secs(10))?);
    let state = macos_bundle::transaction_state(&transaction_file)?;
    if state == "complete" {
        macos_bundle::remove_recovery_agent(&transaction_file)?;
        return Ok(json!({
            "schemaVersion": 1,
            "state": "complete",
            "recovered": false,
            "transactionFile": transaction_file,
        }));
    }
    if state == "verified" && macos_bundle::startup_acknowledged(&transaction_file)? {
        let finalized = macos_bundle::finalize_transaction(&transaction_file)?;
        remove_self_update_reservation(&state_root)?;
        macos_bundle::remove_recovery_agent(&transaction_file)?;
        return Ok(json!({
            "schemaVersion": 1,
            "state": "complete",
            "recovered": true,
            "resumedFinalization": true,
            "transactionFile": transaction_file,
            "finalizeResult": finalized,
        }));
    }
    if state == "rollback-persisted" {
        let finalized = macos_bundle::recover_transaction(&transaction_file)?;
        remove_self_update_reservation(&state_root)?;
        macos_bundle::remove_recovery_agent(&transaction_file)?;
        return Ok(json!({
            "schemaVersion": 1,
            "state": "complete",
            "recovered": true,
            "resumedFinalization": true,
            "transactionFile": transaction_file,
            "finalizeResult": finalized,
        }));
    }

    if let Some(lease) = read_active_lease(&state_root)?
        && process_start_is_live(lease.pid, &lease.process_start_id)?
    {
        drop(session_lock.take());
        macos_bundle::signal_process(lease.pid, false)?;
        for _ in 0..100 {
            if !process_start_is_live(lease.pid, &lease.process_start_id)? {
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
        if process_start_is_live(lease.pid, &lease.process_start_id)? {
            macos_bundle::signal_process(lease.pid, true)?;
            for _ in 0..100 {
                if !process_start_is_live(lease.pid, &lease.process_start_id)? {
                    break;
                }
                thread::sleep(Duration::from_millis(50));
            }
        }
        if process_start_is_live(lease.pid, &lease.process_start_id)? {
            return Err(
                "macOS recovery refused to exchange bundles while the successor is still live"
                    .into(),
            );
        }
        session_lock = Some(SessionLock::acquire(&state_root, Duration::from_secs(10))?);
    }
    let recovered = macos_bundle::recover_transaction(&transaction_file)?;
    remove_self_update_reservation(&state_root)?;
    let recovered_state = recovered
        .get("state")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let host_bundle = macos_bundle::transaction_host_bundle(&transaction_file)?;
    let mut relaunched = false;
    if recovered_state == "rolled-back"
        && !(cfg!(debug_assertions)
            && std::env::var_os("PULSESYNC_SKIP_RECOVERY_RELAUNCH").is_some())
    {
        Command::new(macos_bundle::transaction_app_executable(&transaction_file)?)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()?;
        relaunched = true;
    }
    macos_bundle::remove_recovery_agent(&transaction_file)?;
    drop(session_lock.take());
    Ok(json!({
        "schemaVersion": 1,
        "state": recovered_state,
        "recovered": true,
        "relaunched": relaunched,
        "hostBundle": host_bundle,
        "transactionFile": transaction_file,
    }))
}
