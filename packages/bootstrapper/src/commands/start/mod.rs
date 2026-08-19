#[cfg(windows)]
use crate::core::install_state::collect_runtime_garbage;
use crate::{
    cli::args::{Args, arg_value, state_root_arg},
    core::{
        active_app::{
            ActiveAppLeaseState, arm_handoff, cancel_handoff, current_process_identity,
            verified_live_lease,
        },
        error::Result,
        install_state::{
            recover_unowned_pending_runtime, recover_unowned_pending_runtime_with_host,
        },
        layout::{
            Layout, LayoutKind, canonical_install_root, resolve_layout, resolve_macos_layout,
        },
        operation_lock::UpdateLock,
        self_update::{
            SelfUpdateMutationGate, read_self_update_reservation, reconcile_self_update_mutation,
            remove_self_update_reservation, reservation_child_is_live,
        },
        session_lock::SessionLock,
    },
    domain::{
        launcher::launch_app,
        macos_bundle,
        transactions::{apply_transaction_file, newest_transaction, rollback_transaction_file},
    },
};
use serde_json::{Value, json};
use std::{
    env,
    ffi::OsString,
    path::{Path, PathBuf},
    time::Duration,
};
mod handoff;
mod self_update;

pub(crate) use handoff::{HandoffContext, launch_handoff_successor, launch_with_active_lease};
use handoff::{
    StartRecovery, active_lease_result, emit_handoff_armed, fail_handoff_if_armed, handoff_request,
    launch_for_start, recover_start_state, reload_handoff_context, self_update_bound_lease,
    self_update_busy_result, wait_for_process_exit,
};

use self_update::{
    infer_install_root, launch_self_update_handoff, prepared_bootstrapper_path,
    read_transaction_file,
};

fn resolve_current_app_executable(
    install_root: Option<&PathBuf>,
    host_bundle: Option<&PathBuf>,
    app_executable_name: Option<String>,
    fallback: &Path,
) -> Result<PathBuf> {
    if host_bundle.is_some() {
        return Ok(fallback.to_path_buf());
    }
    if let Some(install_root) = install_root {
        return Ok(resolve_layout(install_root.clone(), app_executable_name)?.app_executable);
    }

    Ok(fallback.to_path_buf())
}

fn ensure_app_executable(app_executable: &Path) -> Result<()> {
    if !app_executable.is_file() {
        return Err(format!(
            "app executable path is not a file: {}",
            app_executable.display()
        )
        .into());
    }

    Ok(())
}

fn current_macos_seed(layout: &Layout) -> Result<PathBuf> {
    let current_helper = env::current_exe()
        .map_err(|error| format!("current macOS bootstrapper cannot be resolved: {error}"))?;
    let current_canonical = current_helper.canonicalize().map_err(|error| {
        format!("current macOS bootstrapper path cannot be canonicalized: {error}")
    })?;
    let managed_helper = layout.bootstrapper_dir.join("pulsesync-bootstrapper");
    let bundle_helper = layout
        .host_bundle
        .as_ref()
        .ok_or("macOS host bundle is missing")?
        .join("Contents")
        .join("Resources")
        .join("bootstrapper")
        .join("pulsesync-bootstrapper");
    let matches_known_helper = [&managed_helper, &bundle_helper].iter().any(|candidate| {
        candidate
            .canonicalize()
            .is_ok_and(|canonical| canonical == current_canonical)
    });
    if !matches_known_helper {
        return Err(format!(
            "macOS update must be armed by the managed helper or bundle seed: {}",
            current_helper.display()
        )
        .into());
    }
    Ok(current_helper)
}

pub fn start(args: &Args) -> Result<Value> {
    if arg_value(args, "--transaction-root").is_some() {
        return Err(
            "--transaction-root is not supported; it is derived from the selected state root"
                .into(),
        );
    }
    let handoff_request = handoff_request(args)?;
    let explicit_install_root = state_root_arg(args)?.map(PathBuf::from);
    let inferred_install_root = explicit_install_root
        .clone()
        .or_else(|| infer_install_root().ok());
    let install_root = explicit_install_root
        .or(inferred_install_root)
        .map(|path| canonical_install_root(&path))
        .transpose()?;
    let app_executable_name = arg_value(args, "--app-executable-name");
    let host_bundle = arg_value(args, "--host-bundle").map(PathBuf::from);
    let explicit_app_executable = arg_value(args, "--app-executable").map(PathBuf::from);
    let layout = match (&install_root, &host_bundle, &explicit_app_executable) {
        (Some(state_root), Some(host_bundle), Some(app_executable)) => Some(resolve_macos_layout(
            state_root.clone(),
            host_bundle.clone(),
            app_executable.clone(),
        )?),
        (Some(install_root), None, _) => Some(resolve_layout(
            install_root.clone(),
            app_executable_name.clone(),
        )?),
        (_, Some(_), None) => return Err("--host-bundle requires --app-executable".into()),
        _ => None,
    };
    if let Some(layout) = layout.as_ref()
        && matches!(
            layout.layout_kind,
            LayoutKind::VersionedComponents | LayoutKind::MacosHybrid
        )
    {
        if layout.layout_kind == LayoutKind::MacosHybrid {
            recover_unowned_pending_runtime_with_host(
                &layout.state_root,
                layout.host_bundle.as_deref(),
            )?;
        } else {
            recover_unowned_pending_runtime(&layout.state_root)?;
        }
    }
    let transaction_root = layout
        .as_ref()
        .map(|value| value.transaction_root.clone())
        .ok_or("--state-root or legacy --install-root is required")?;
    if let Some(install_root) = install_root.as_deref() {
        let session_lock = SessionLock::acquire(install_root, Duration::from_secs(10))?;
        if let Some(reservation) = read_self_update_reservation(install_root)?
            && reservation_child_is_live(&reservation)?
        {
            if handoff_request.is_none()
                && let Some(lease) = self_update_bound_lease(install_root, &reservation)?
            {
                return active_lease_result(install_root, args, lease);
            }
            return Ok(self_update_busy_result(&reservation));
        }
        if let Some(lease) = verified_live_lease(install_root)? {
            if let Some(request) = handoff_request.as_ref() {
                if lease.lease_id != request.active_lease_id
                    || lease.pid != request.wait_for_pid
                    || lease.state != ActiveAppLeaseState::Active
                {
                    return Ok(json!({
                        "schemaVersion": 1,
                        "state": "blocked",
                        "launched": false,
                        "block": {
                            "code": "active-lease-mismatch",
                            "retryable": false,
                            "safeToContinue": true,
                        }
                    }));
                }
            } else {
                return active_lease_result(install_root, args, lease);
            }
        }
        drop(session_lock);
    }

    let mut update_lock = install_root
        .as_deref()
        .map(|root| UpdateLock::acquire(root, Duration::from_secs(30)))
        .transpose()?;
    let mut session_lock = install_root
        .as_deref()
        .map(|root| SessionLock::acquire(root, Duration::from_secs(10)))
        .transpose()?;
    let mut handoff_context = None;
    if let Some(install_root) = install_root.as_deref() {
        match reconcile_self_update_mutation(install_root)? {
            SelfUpdateMutationGate::Busy(result) => {
                let reservation = read_self_update_reservation(install_root)?
                    .ok_or("live self-update reservation disappeared")?;
                if handoff_request.is_none()
                    && let Some(lease) = self_update_bound_lease(install_root, &reservation)?
                {
                    return active_lease_result(install_root, args, lease);
                }
                return Ok(json!({
                    "schemaVersion": 1,
                    "state": "busy",
                    "launched": false,
                    "selfUpdate": result,
                    "block": {
                        "code": "self-update-busy",
                        "retryable": true,
                        "safeToContinue": false,
                    }
                }));
            }
            SelfUpdateMutationGate::Clear => {}
        }
        let live_lease = verified_live_lease(install_root)?;
        #[cfg(windows)]
        if live_lease.is_none()
            && let Err(error) = collect_runtime_garbage(install_root)
        {
            eprintln!("runtime cleanup deferred during start: {error}");
        }
        match (live_lease, handoff_request.as_ref()) {
            (Some(lease), None) => return active_lease_result(install_root, args, lease),
            (Some(lease), Some(request)) => {
                if lease.lease_id != request.active_lease_id
                    || lease.pid != request.wait_for_pid
                    || lease.state != ActiveAppLeaseState::Active
                {
                    return Ok(json!({
                        "schemaVersion": 1,
                        "state": "blocked",
                        "launched": false,
                        "block": {
                            "code": "active-lease-mismatch",
                            "retryable": false,
                            "safeToContinue": true,
                        }
                    }));
                }
                let rust_process = current_process_identity()?;
                let (predecessor, transfer) = arm_handoff(install_root, &lease, &rust_process)?;
                let mut context = HandoffContext {
                    predecessor,
                    transfer,
                    rust_process,
                };

                if let Some(selected) = newest_transaction(&transaction_root)?
                    && selected.state == "prepared"
                {
                    let transaction_value = read_transaction_file(&selected.path)?;
                    if macos_bundle::is_macos_transaction(&transaction_value) {
                        let layout = layout.as_ref().ok_or("macOS runtime layout is missing")?;
                        let current_helper = current_macos_seed(layout)?;
                        let prepared_helper =
                            macos_bundle::arm_transaction(&selected.path, &current_helper)?;
                        let app_executable = explicit_app_executable
                            .clone()
                            .or_else(|| Some(layout.app_executable.clone()))
                            .ok_or("--app-executable is required for a macOS bundle update")?;
                        let passthrough_args = args
                            .passthrough
                            .iter()
                            .map(OsString::from)
                            .collect::<Vec<_>>();
                        let parent = context.predecessor.process_identity();
                        drop(session_lock.take());
                        let mut reserved = launch_self_update_handoff(
                            &prepared_helper,
                            &selected.path,
                            install_root,
                            host_bundle.as_deref(),
                            app_executable_name.as_deref(),
                            &app_executable,
                            &passthrough_args,
                            Some(&mut context),
                            Some(&parent),
                        )?;
                        emit_handoff_armed(args, &context);
                        reserved["appExecutable"] = json!(app_executable);
                        reserved["hostBundle"] = json!(host_bundle);
                        reserved["transactionRoot"] = json!(transaction_root);
                        reserved["transactionAction"] = json!("macos-bundle-handoff");
                        reserved["selectedTransactionFile"] = json!(selected.path);
                        reserved["preparedBootstrapper"] = json!(prepared_helper);
                        return Ok(reserved);
                    }
                }
                emit_handoff_armed(args, &context);
                drop(session_lock.take());

                if !wait_for_process_exit(
                    &context.predecessor.process_identity(),
                    request.wait_timeout,
                )? {
                    let _session_lock =
                        SessionLock::acquire(install_root, Duration::from_secs(10))?;
                    context = reload_handoff_context(install_root, &context)?;
                    let (restored, canceled) = cancel_handoff(
                        install_root,
                        &context.predecessor,
                        &context.transfer,
                        &context.rust_process,
                    )?;
                    return Ok(json!({
                        "schemaVersion": 1,
                        "state": "blocked",
                        "launched": false,
                        "lease": restored,
                        "transfer": canceled,
                        "block": {
                            "code": "wait-for-pid-timeout",
                            "retryable": true,
                            "safeToContinue": true,
                        }
                    }));
                }

                let verify_lock = SessionLock::acquire(install_root, Duration::from_secs(10))?;
                context = reload_handoff_context(install_root, &context)?;
                drop(verify_lock);
                handoff_context = Some(context);
            }
            (None, Some(_)) => {
                return Ok(json!({
                    "schemaVersion": 1,
                    "state": "blocked",
                    "launched": false,
                    "block": {
                        "code": "active-lease-mismatch",
                        "retryable": true,
                        "safeToContinue": false,
                    }
                }));
            }
            (None, None) => match recover_start_state(install_root)? {
                StartRecovery::None => {}
                StartRecovery::Context(context) => {
                    handoff_context = Some(context);
                    drop(session_lock.take());
                }
                StartRecovery::LiveSuccessor(lease) => {
                    return active_lease_result(install_root, args, lease);
                }
                StartRecovery::Blocked(result) => return Ok(result),
            },
        }
    }
    let app_executable = explicit_app_executable
        .or_else(|| layout.as_ref().map(|value| value.app_executable.clone()))
        .ok_or("--state-root/--install-root or --app-executable is required")?;

    let passthrough_args = args
        .passthrough
        .iter()
        .map(OsString::from)
        .collect::<Vec<_>>();
    let selected = newest_transaction(&transaction_root)?;
    if let Some(selected) = selected {
        match selected.state.as_str() {
            "prepared" => {
                let transaction_value = read_transaction_file(&selected.path)?;
                if macos_bundle::is_macos_transaction(&transaction_value) {
                    if handoff_context.is_none() {
                        return Ok(json!({
                            "schemaVersion": 1,
                            "state": "blocked",
                            "launched": false,
                            "block": {
                                "code": "macos-update-requires-active-handoff",
                                "retryable": true,
                                "safeToContinue": true,
                            }
                        }));
                    }
                    let layout = layout.as_ref().ok_or("macOS runtime layout is missing")?;
                    let current_helper = current_macos_seed(layout)?;
                    let prepared_helper =
                        match macos_bundle::arm_transaction(&selected.path, &current_helper) {
                            Ok(helper) => helper,
                            Err(error) => {
                                let _ = launch_app(&app_executable, &[], install_root.as_deref());
                                return Err(error);
                            }
                        };
                    drop(session_lock.take());
                    drop(update_lock.take());
                    let install_root = install_root
                        .as_deref()
                        .ok_or("macOS bundle update requires --state-root")?;
                    let mut reserved = launch_self_update_handoff(
                        &prepared_helper,
                        &selected.path,
                        install_root,
                        host_bundle.as_deref(),
                        app_executable_name.as_deref(),
                        &app_executable,
                        &passthrough_args,
                        handoff_context.as_mut(),
                        None,
                    )?;
                    reserved["appExecutable"] = json!(app_executable);
                    reserved["hostBundle"] = json!(host_bundle);
                    reserved["transactionRoot"] = json!(transaction_root);
                    reserved["transactionAction"] = json!("macos-bundle-handoff");
                    reserved["selectedTransactionFile"] = json!(selected.path);
                    reserved["preparedBootstrapper"] = json!(prepared_helper);
                    return Ok(reserved);
                }
                if let Some(prepared_bootstrapper) = prepared_bootstrapper_path(&selected.path)? {
                    drop(session_lock.take());
                    drop(update_lock.take());
                    let install_root = install_root
                        .as_deref()
                        .ok_or("self-update requires --install-root")?;
                    let mut reserved = launch_self_update_handoff(
                        &prepared_bootstrapper,
                        &selected.path,
                        install_root,
                        host_bundle.as_deref(),
                        app_executable_name.as_deref(),
                        &app_executable,
                        &passthrough_args,
                        handoff_context.as_mut(),
                        None,
                    )?;
                    reserved["appExecutable"] = json!(app_executable);
                    reserved["hostBundle"] = json!(host_bundle);
                    reserved["transactionRoot"] = json!(transaction_root);
                    reserved["transactionAction"] = json!("self-update-handoff");
                    reserved["selectedTransactionFile"] = json!(selected.path);
                    reserved["preparedBootstrapper"] = json!(prepared_bootstrapper);
                    reserved["transactionStateBefore"] = json!(selected.state);
                    return Ok(reserved);
                }
                let applied = apply_transaction_file(&selected.path)?;
                if applied.get("state").and_then(Value::as_str) != Some("applied") {
                    let transfer =
                        fail_handoff_if_armed(install_root.as_deref(), &mut handoff_context)?;
                    return Ok(json!({
                        "schemaVersion": 1,
                        "state": "blocked",
                        "launched": false,
                        "appExecutable": app_executable,
                        "transactionRoot": transaction_root,
                        "transactionAction": "apply",
                        "selectedTransactionFile": selected.path,
                        "transactionStateBefore": selected.state,
                        "transactionStateAfter": applied.get("state").and_then(Value::as_str).unwrap_or("failed"),
                        "transfer": transfer,
                        "reason": "Prepared transaction did not apply cleanly"
                    }));
                }
                let launch_executable = resolve_current_app_executable(
                    install_root.as_ref(),
                    host_bundle.as_ref(),
                    app_executable_name.clone(),
                    &app_executable,
                )?;
                ensure_app_executable(&launch_executable)?;
                let (pid, lease) = launch_for_start(
                    install_root.as_deref(),
                    &launch_executable,
                    &passthrough_args,
                    handoff_context.as_mut(),
                )?;
                return Ok(json!({
                    "schemaVersion": 1,
                    "state": "launched",
                    "launched": true,
                    "pid": pid,
                    "lease": lease,
                    "appExecutable": launch_executable,
                    "transactionRoot": transaction_root,
                    "transactionAction": "apply",
                    "selectedTransactionFile": selected.path,
                    "transactionStateBefore": selected.state,
                    "transactionStateAfter": "applied",
                    "reason": "Prepared transaction applied before launch"
                }));
            }
            "failed" | "applying" => {
                let rolled_back = rollback_transaction_file(&selected.path)?;
                if rolled_back.get("state").and_then(Value::as_str) != Some("rolled-back") {
                    let transfer =
                        fail_handoff_if_armed(install_root.as_deref(), &mut handoff_context)?;
                    return Ok(json!({
                        "schemaVersion": 1,
                        "state": "blocked",
                        "launched": false,
                        "appExecutable": app_executable,
                        "transactionRoot": transaction_root,
                        "transactionAction": "rollback",
                        "selectedTransactionFile": selected.path,
                        "transactionStateBefore": selected.state,
                        "transactionStateAfter": rolled_back.get("state").and_then(Value::as_str).unwrap_or("failed"),
                        "transfer": transfer,
                        "reason": "Failed transaction did not roll back cleanly"
                    }));
                }
                let launch_executable = resolve_current_app_executable(
                    install_root.as_ref(),
                    host_bundle.as_ref(),
                    app_executable_name.clone(),
                    &app_executable,
                )?;
                ensure_app_executable(&launch_executable)?;
                let (pid, lease) = launch_for_start(
                    install_root.as_deref(),
                    &launch_executable,
                    &passthrough_args,
                    handoff_context.as_mut(),
                )?;
                return Ok(json!({
                    "schemaVersion": 1,
                    "state": "launched",
                    "launched": true,
                    "pid": pid,
                    "lease": lease,
                    "appExecutable": launch_executable,
                    "transactionRoot": transaction_root,
                    "transactionAction": "rollback",
                    "selectedTransactionFile": selected.path,
                    "transactionStateBefore": selected.state,
                    "transactionStateAfter": "rolled-back",
                    "reason": "Failed transaction rolled back before launch"
                }));
            }
            "commit-slot-ready" | "exchanged" | "verified" | "rollback-persisted" => {
                let transaction_value = read_transaction_file(&selected.path)?;
                if macos_bundle::is_macos_transaction(&transaction_value) {
                    let reconciled = if selected.state == "verified"
                        && macos_bundle::startup_acknowledged(&selected.path)?
                    {
                        macos_bundle::finalize_transaction(&selected.path)?
                    } else {
                        macos_bundle::recover_transaction(&selected.path)?
                    };
                    if let Some(install_root) = install_root.as_deref() {
                        remove_self_update_reservation(install_root)?;
                    }
                    macos_bundle::remove_recovery_agent(&selected.path)?;
                    let launch_executable = resolve_current_app_executable(
                        install_root.as_ref(),
                        host_bundle.as_ref(),
                        app_executable_name.clone(),
                        &app_executable,
                    )?;
                    ensure_app_executable(&launch_executable)?;
                    let (pid, lease) = launch_for_start(
                        install_root.as_deref(),
                        &launch_executable,
                        &passthrough_args,
                        handoff_context.as_mut(),
                    )?;
                    return Ok(json!({
                        "schemaVersion": 1,
                        "state": "launched",
                        "launched": true,
                        "pid": pid,
                        "lease": lease,
                        "appExecutable": launch_executable,
                        "transactionRoot": transaction_root,
                        "transactionAction": "macos-reconcile",
                        "selectedTransactionFile": selected.path,
                        "transactionStateBefore": selected.state,
                        "transactionStateAfter": reconciled.get("state").and_then(Value::as_str).unwrap_or("failed"),
                    }));
                }
            }
            "applied" | "complete" | "rolled-back" => {
                let transaction_value = read_transaction_file(&selected.path)?;
                if macos_bundle::is_macos_transaction(&transaction_value) {
                    macos_bundle::remove_recovery_agent(&selected.path)?;
                }
                let launch_executable = resolve_current_app_executable(
                    install_root.as_ref(),
                    host_bundle.as_ref(),
                    app_executable_name.clone(),
                    &app_executable,
                )?;
                ensure_app_executable(&launch_executable)?;
                let (pid, lease) = launch_for_start(
                    install_root.as_deref(),
                    &launch_executable,
                    &passthrough_args,
                    handoff_context.as_mut(),
                )?;
                return Ok(json!({
                    "schemaVersion": 1,
                    "state": "launched",
                    "launched": true,
                    "pid": pid,
                    "lease": lease,
                    "appExecutable": launch_executable,
                    "transactionRoot": transaction_root,
                    "transactionAction": "skip",
                    "selectedTransactionFile": selected.path,
                    "transactionStateBefore": selected.state,
                    "transactionStateAfter": selected.state,
                    "reason": format!("Transaction is already in safe terminal state: {}", selected.state)
                }));
            }
            "blocked" | "rollback-blocked" => {
                let transfer =
                    fail_handoff_if_armed(install_root.as_deref(), &mut handoff_context)?;
                return Ok(json!({
                    "schemaVersion": 1,
                    "state": "blocked",
                    "launched": false,
                    "appExecutable": app_executable,
                    "transactionRoot": transaction_root,
                    "transactionAction": "block",
                    "selectedTransactionFile": selected.path,
                    "transactionStateBefore": selected.state,
                    "transactionStateAfter": selected.state,
                    "transfer": transfer,
                    "reason": format!("Transaction state blocks launch: {}", selected.state)
                }));
            }
            _ => {}
        }
    }

    let launch_executable = resolve_current_app_executable(
        install_root.as_ref(),
        host_bundle.as_ref(),
        app_executable_name,
        &app_executable,
    )?;
    ensure_app_executable(&launch_executable)?;
    let (pid, lease) = launch_for_start(
        install_root.as_deref(),
        &launch_executable,
        &passthrough_args,
        handoff_context.as_mut(),
    )?;
    Ok(json!({
        "schemaVersion": 1,
        "state": "launched",
        "launched": true,
        "pid": pid,
        "lease": lease,
        "appExecutable": launch_executable,
        "transactionRoot": transaction_root,
        "transactionAction": "none",
        "reason": "No pending transaction was found"
    }))
}
