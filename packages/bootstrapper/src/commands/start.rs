use crate::{
    cli::args::{Args, arg_value},
    core::{
        active_app::{
            ActiveAppLease, ActiveAppLeaseState, HandoffTransfer, HandoffTransferState,
            LaunchReservationRecovery, ProcessIdentity, arm_crash_recovery, arm_handoff,
            cancel_handoff, current_process_identity, finish_launch_reservation,
            inspect_launch_reservation_recovery, inspect_process_with_retry,
            mark_handoff_launch_failed, mark_handoff_successor_spawning, new_launch_reservation,
            process_identity_is_live, publish_handoff_successor, read_active_lease,
            read_handoff_transfer, read_launch_reservation, record_spawned_launch_reservation,
            remove_launch_reservation, take_over_failed_handoff, verified_live_lease,
        },
        error::Result,
        layout::{assert_inside, canonical_install_root, resolve_layout},
        operation_lock::UpdateLock,
        self_update::{
            SelfUpdateHandoffReservation, SelfUpdateMutationGate, new_self_update_reservation,
            read_self_update_reservation, reconcile_self_update_mutation,
            remove_self_update_reservation, reservation_child_is_live, reservation_preserves_lease,
            write_self_update_reservation, write_self_update_result,
        },
        session_lock::SessionLock,
    },
    domain::{
        launch_inbox::{
            LaunchRequestInput, LaunchRequestKind, bind_inbox_to_lease, enqueue_request,
            launch_request_result_value,
        },
        launcher::{launch_app, launch_app_with_env},
        transactions::{
            apply_transaction_file, newest_transaction, rollback_transaction_file,
            transaction_artifacts,
        },
    },
};
use serde_json::{Value, json};
use std::{
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
use uuid::Uuid;

#[derive(Clone, Debug)]
struct HandoffRequest {
    active_lease_id: String,
    wait_for_pid: u32,
    wait_timeout: Duration,
}

#[derive(Clone, Debug)]
pub(crate) struct HandoffContext {
    pub(crate) predecessor: ActiveAppLease,
    pub(crate) transfer: HandoffTransfer,
    pub(crate) rust_process: ProcessIdentity,
}

fn handoff_request(args: &Args) -> Result<Option<HandoffRequest>> {
    let active_lease_id = arg_value(args, "--active-lease-id");
    let wait_for_pid = arg_value(args, "--wait-for-pid");
    if active_lease_id.is_none() && wait_for_pid.is_none() {
        return Ok(None);
    }
    let active_lease_id =
        active_lease_id.ok_or("--active-lease-id is required with --wait-for-pid")?;
    let wait_for_pid = wait_for_pid
        .ok_or("--wait-for-pid is required with --active-lease-id")?
        .parse::<u32>()
        .map_err(|_| "--wait-for-pid must be a positive process id")?;
    if wait_for_pid == 0 {
        return Err("--wait-for-pid must be greater than 0".into());
    }
    let wait_timeout_ms = arg_value(args, "--wait-timeout-ms")
        .map(|value| {
            value
                .parse::<u64>()
                .map_err(|_| "--wait-timeout-ms must be a positive integer")
        })
        .transpose()?
        .unwrap_or(60_000);
    if wait_timeout_ms == 0 {
        return Err("--wait-timeout-ms must be greater than 0".into());
    }
    Ok(Some(HandoffRequest {
        active_lease_id,
        wait_for_pid,
        wait_timeout: Duration::from_millis(wait_timeout_ms),
    }))
}

fn emit_handoff_armed(args: &Args, context: &HandoffContext) {
    if !args.progress_json {
        return;
    }
    let event = json!({
        "schemaVersion": 1,
        "event": "handoff-armed",
        "handoffId": context.transfer.handoff_id,
        "activeLeaseId": context.predecessor.lease_id,
        "waitingForPid": context.predecessor.pid,
        "rustPid": context.rust_process.pid,
    });
    if let Ok(payload) = serde_json::to_string(&event) {
        eprintln!("{payload}");
    }
}

fn wait_for_process_exit(identity: &ProcessIdentity, timeout: Duration) -> Result<bool> {
    let started = Instant::now();
    while process_identity_is_live(identity)? {
        if started.elapsed() >= timeout {
            return Ok(false);
        }
        thread::sleep(Duration::from_millis(25));
    }
    Ok(true)
}

fn reload_handoff_context(
    install_root: &Path,
    expected: &HandoffContext,
) -> Result<HandoffContext> {
    let lease = read_active_lease(install_root)?.ok_or("armed active app lease is missing")?;
    let handoff = lease
        .handoff
        .as_ref()
        .ok_or("armed active app lease is missing handoff metadata")?;
    let transfer = read_handoff_transfer(install_root, &expected.transfer.handoff_id)?
        .ok_or("armed handoff transfer is missing")?;
    if lease.state != ActiveAppLeaseState::HandoffArmed
        || lease.lease_id != expected.predecessor.lease_id
        || handoff.id != expected.transfer.handoff_id
        || handoff.rust_pid != expected.rust_process.pid
        || handoff.rust_process_start_id != expected.rust_process.process_start_id
        || transfer.state != HandoffTransferState::Armed
        || transfer.predecessor_lease_id != lease.lease_id
        || transfer.inbox_id != lease.inbox_id
        || transfer.inbox_generation != lease.inbox_generation
    {
        return Err("armed handoff state changed unexpectedly".into());
    }
    Ok(HandoffContext {
        predecessor: lease,
        transfer,
        rust_process: expected.rust_process.clone(),
    })
}

pub(crate) fn launch_with_active_lease(
    install_root: Option<&Path>,
    app_executable: &Path,
    args: &[OsString],
) -> Result<(u32, Option<ActiveAppLease>)> {
    let Some(install_root) = install_root else {
        return Ok((launch_app(app_executable, args)?, None));
    };

    let launcher = current_process_identity()?;
    let mut reservation = new_launch_reservation(install_root, &launcher, app_executable)?;
    let env = [(
        OsString::from("PULSESYNC_LAUNCH_RESERVATION_ID"),
        OsString::from(&reservation.id),
    )];
    let pid = match launch_app_with_env(app_executable, args, &env) {
        Ok(pid) => pid,
        Err(error) => {
            let _ = remove_launch_reservation(install_root);
            return Err(error);
        }
    };
    let child = inspect_process_with_retry(pid, app_executable, Duration::from_secs(5))?;
    let lease = finish_launch_reservation(install_root, &mut reservation, &child)?;
    bind_inbox_to_lease(install_root, &lease)?;
    Ok((pid, Some(lease)))
}

pub(crate) fn launch_handoff_successor(
    install_root: &Path,
    context: &mut HandoffContext,
    app_executable: &Path,
    args: &[OsString],
) -> Result<(u32, ActiveAppLease)> {
    let _session_lock = SessionLock::acquire(install_root, Duration::from_secs(10))?;
    *context = reload_handoff_context(install_root, context)?;
    let launcher = current_process_identity()?;
    let mut reservation = new_launch_reservation(install_root, &launcher, app_executable)?;
    context.transfer =
        mark_handoff_successor_spawning(install_root, &context.transfer, &reservation.id)?;
    let env = [
        (
            OsString::from("PULSESYNC_HANDOFF_ID"),
            OsString::from(&context.transfer.handoff_id),
        ),
        (
            OsString::from("PULSESYNC_LAUNCH_RESERVATION_ID"),
            OsString::from(&reservation.id),
        ),
    ];
    let pid = match launch_app_with_env(app_executable, args, &env) {
        Ok(pid) => pid,
        Err(error) => {
            context.transfer = mark_handoff_launch_failed(install_root, &context.transfer)?;
            let _ = remove_launch_reservation(install_root);
            return Err(error);
        }
    };
    let child = match inspect_process_with_retry(pid, app_executable, Duration::from_secs(5)) {
        Ok(child) => child,
        Err(error) => {
            context.transfer = mark_handoff_launch_failed(install_root, &context.transfer)?;
            let _ = remove_launch_reservation(install_root);
            return Err(error);
        }
    };
    record_spawned_launch_reservation(install_root, &mut reservation, &child)?;
    let (lease, transfer) = publish_handoff_successor(
        install_root,
        &context.predecessor,
        &context.transfer,
        &child,
    )?;
    bind_inbox_to_lease(install_root, &lease)?;
    remove_launch_reservation(install_root)?;
    context.transfer = transfer;
    Ok((pid, lease))
}

fn launch_for_start(
    install_root: Option<&Path>,
    app_executable: &Path,
    args: &[OsString],
    handoff: Option<&mut HandoffContext>,
) -> Result<(u32, Option<ActiveAppLease>)> {
    match (install_root, handoff) {
        (Some(install_root), Some(handoff)) => {
            let (pid, lease) =
                launch_handoff_successor(install_root, handoff, app_executable, args)?;
            Ok((pid, Some(lease)))
        }
        _ => launch_with_active_lease(install_root, app_executable, args),
    }
}

fn fail_handoff_if_armed(
    install_root: Option<&Path>,
    handoff: &mut Option<HandoffContext>,
) -> Result<Option<HandoffTransfer>> {
    let (Some(install_root), Some(context)) = (install_root, handoff.as_mut()) else {
        return Ok(None);
    };
    let _session_lock = SessionLock::acquire(install_root, Duration::from_secs(10))?;
    *context = reload_handoff_context(install_root, context)?;
    context.transfer = mark_handoff_launch_failed(install_root, &context.transfer)?;
    Ok(Some(context.transfer.clone()))
}

fn active_lease_result(install_root: &Path, args: &Args, lease: ActiveAppLease) -> Result<Value> {
    bind_inbox_to_lease(install_root, &lease)?;
    let request = enqueue_request(
        install_root,
        &lease,
        LaunchRequestInput {
            schema_version: 1,
            kind: if args.passthrough.is_empty() {
                LaunchRequestKind::Activate
            } else {
                LaunchRequestKind::Arguments
            },
            argv: args.passthrough.clone(),
            working_directory: env::current_dir()
                .ok()
                .map(|path| path.to_string_lossy().to_string()),
            additional_data: None,
        },
    )?;
    Ok(json!({
        "schemaVersion": 1,
        "state": "enqueued",
        "launched": false,
        "lease": lease,
        "request": launch_request_result_value(&request),
        "reason": "A verified PulseSync app process is active; queued the launch request"
    }))
}

fn self_update_bound_lease(
    install_root: &Path,
    reservation: &SelfUpdateHandoffReservation,
) -> Result<Option<ActiveAppLease>> {
    let Some(lease) = read_active_lease(install_root)? else {
        return Ok(None);
    };
    if lease.state != ActiveAppLeaseState::HandoffArmed
        || !reservation_preserves_lease(reservation, &lease)
    {
        return Ok(None);
    }
    let handoff_id = reservation
        .app_handoff_id
        .as_deref()
        .ok_or("self-update reservation is missing app handoff id")?;
    let Some(transfer) = read_handoff_transfer(install_root, handoff_id)? else {
        return Err("self-update app handoff transfer is missing".into());
    };
    if transfer.state != HandoffTransferState::Armed
        || transfer.predecessor_lease_id != lease.lease_id
        || transfer.inbox_id != lease.inbox_id
        || transfer.inbox_generation != lease.inbox_generation
    {
        return Err("self-update app handoff transfer binding mismatch".into());
    }
    Ok(Some(lease))
}

fn self_update_busy_result(reservation: &SelfUpdateHandoffReservation) -> Value {
    json!({
        "schemaVersion": 1,
        "state": "busy",
        "launched": false,
        "selfUpdate": {
            "schemaVersion": 1,
            "state": "busy",
            "id": reservation.id,
            "parentPid": reservation.parent_pid,
            "childPid": reservation.child_pid,
        },
        "block": {
            "code": "self-update-busy",
            "retryable": true,
            "safeToContinue": false,
        }
    })
}

enum StartRecovery {
    None,
    Context(HandoffContext),
    LiveSuccessor(ActiveAppLease),
    Blocked(Value),
}

fn recover_start_state(install_root: &Path) -> Result<StartRecovery> {
    let Some(predecessor) = read_active_lease(install_root)? else {
        return Ok(StartRecovery::None);
    };
    if predecessor.schema_version != 1 {
        return Err("unsupported active app lease schemaVersion".into());
    }
    if process_identity_is_live(&predecessor.process_identity())? {
        return Ok(StartRecovery::LiveSuccessor(predecessor));
    }

    let rust_process = current_process_identity()?;
    let (predecessor, transfer) = match predecessor.state {
        ActiveAppLeaseState::Active => {
            arm_crash_recovery(install_root, &predecessor, &rust_process)?
        }
        ActiveAppLeaseState::HandoffArmed => {
            let handoff = predecessor
                .handoff
                .as_ref()
                .ok_or("armed active app lease is missing handoff metadata")?;
            let mut transfer = read_handoff_transfer(install_root, &handoff.id)?
                .ok_or("armed handoff transfer is missing")?;
            if transfer.predecessor_lease_id != predecessor.lease_id
                || transfer.inbox_id != predecessor.inbox_id
                || transfer.inbox_generation != predecessor.inbox_generation
            {
                return Err("armed handoff transfer binding mismatch".into());
            }

            match transfer.state {
                HandoffTransferState::Armed | HandoffTransferState::LaunchFailed => {
                    take_over_failed_handoff(install_root, &predecessor, &transfer, &rust_process)?
                }
                HandoffTransferState::SuccessorSpawning => {
                    let expected_reservation_id = transfer
                        .successor_reservation_id
                        .as_deref()
                        .ok_or("spawning handoff is missing successor reservation id")?;
                    match read_launch_reservation(install_root)? {
                        Some(reservation) if reservation.id == expected_reservation_id => {
                            match inspect_launch_reservation_recovery(&reservation)? {
                                LaunchReservationRecovery::LiveChild(child) => {
                                    let (lease, _) = publish_handoff_successor(
                                        install_root,
                                        &predecessor,
                                        &transfer,
                                        &child,
                                    )?;
                                    bind_inbox_to_lease(install_root, &lease)?;
                                    remove_launch_reservation(install_root)?;
                                    return Ok(StartRecovery::LiveSuccessor(lease));
                                }
                                LaunchReservationRecovery::AwaitingChildClaim => {
                                    return Ok(StartRecovery::Blocked(json!({
                                        "schemaVersion": 1,
                                        "state": "blocked",
                                        "launched": false,
                                        "block": {
                                            "code": "successor-claim-pending",
                                            "retryable": true,
                                            "safeToContinue": false,
                                        }
                                    })));
                                }
                                LaunchReservationRecovery::DeadChild
                                | LaunchReservationRecovery::AbandonedBeforeChild => {
                                    transfer = mark_handoff_launch_failed(install_root, &transfer)?;
                                    remove_launch_reservation(install_root)?;
                                }
                            }
                        }
                        Some(_) => {
                            return Err("handoff successor reservation binding mismatch".into());
                        }
                        None => {
                            transfer = mark_handoff_launch_failed(install_root, &transfer)?;
                        }
                    }
                    take_over_failed_handoff(install_root, &predecessor, &transfer, &rust_process)?
                }
                HandoffTransferState::Canceled => {
                    let mut canceled_predecessor = predecessor.clone();
                    canceled_predecessor.state = ActiveAppLeaseState::Active;
                    canceled_predecessor.handoff = None;
                    arm_crash_recovery(install_root, &canceled_predecessor, &rust_process)?
                }
                HandoffTransferState::SuccessorLaunched | HandoffTransferState::Consumed => {
                    return Err("handoff successor lease is missing".into());
                }
            }
        }
    };

    Ok(StartRecovery::Context(HandoffContext {
        predecessor,
        transfer,
        rust_process,
    }))
}

fn infer_install_root() -> Result<PathBuf> {
    let executable = env::current_exe()?;
    let executable_dir = executable
        .parent()
        .ok_or("bootstrapper executable has no parent directory")?;

    if executable_dir.file_name().and_then(|value| value.to_str()) == Some("bootstrapper") {
        return Ok(executable_dir
            .parent()
            .ok_or("bootstrapper directory has no install root parent")?
            .to_path_buf());
    }

    Ok(executable_dir.to_path_buf())
}

fn read_transaction_file(transaction_file: &Path) -> Result<Value> {
    Ok(serde_json::from_slice(&fs::read(transaction_file)?)?)
}

fn prepared_bootstrapper_path(transaction_file: &Path) -> Result<Option<PathBuf>> {
    let transaction = read_transaction_file(transaction_file)?;
    for artifact in transaction_artifacts(&transaction)? {
        if artifact.key == "bootstrapper" {
            return Ok(Some(artifact.prepared_path));
        }
    }
    Ok(None)
}

fn launch_self_update_handoff(
    prepared_bootstrapper: &Path,
    transaction_file: &Path,
    install_root: &Path,
    app_executable_name: Option<&str>,
    app_executable: &Path,
    passthrough_args: &[OsString],
    context: Option<&mut HandoffContext>,
) -> Result<Value> {
    let _session_lock = SessionLock::acquire(install_root, Duration::from_secs(10))?;
    let (app_handoff_id, active_lease_id, inbox_id, inbox_generation, transfer_state) =
        if let Some(context) = context {
            *context = reload_handoff_context(install_root, context)?;
            (
                Some(context.transfer.handoff_id.clone()),
                Some(context.predecessor.lease_id.clone()),
                Some(context.predecessor.inbox_id.clone()),
                Some(context.predecessor.inbox_generation),
                Some("armed".to_string()),
            )
        } else {
            (None, None, None, None, None)
        };
    if let Some(existing) = read_self_update_reservation(install_root)? {
        if reservation_child_is_live(&existing)? {
            let result = write_self_update_result(install_root, "busy", &existing)?;
            return Ok(json!({
                "schemaVersion": 1,
                "state": "busy",
                "launched": false,
                "selfUpdate": result,
            }));
        }
        write_self_update_result(install_root, "stale-cleaned", &existing)?;
        remove_self_update_reservation(install_root)?;
    }
    let transaction_dir = transaction_file
        .parent()
        .ok_or("self-update transaction file has no parent")?;
    assert_inside(
        transaction_dir,
        prepared_bootstrapper,
        "prepared bootstrapper",
    )?;
    if !prepared_bootstrapper.is_file() {
        return Err("prepared bootstrapper is missing".into());
    }
    let reservation_id = Uuid::new_v4().to_string();
    let parent = current_process_identity()?;
    let mut command = Command::new(prepared_bootstrapper);
    command
        .arg("complete-self-update")
        .arg("--json")
        .arg("--transaction-file")
        .arg(transaction_file)
        .arg("--app-executable")
        .arg(app_executable)
        .arg("--install-root")
        .arg(install_root)
        .env("PULSESYNC_SELF_UPDATE_HANDOFF_ID", &reservation_id);
    if let Some(app_executable_name) = app_executable_name {
        command
            .arg("--app-executable-name")
            .arg(app_executable_name);
    }
    command
        .arg("--")
        .args(passthrough_args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let child = command.spawn()?;
    let child_identity =
        inspect_process_with_retry(child.id(), prepared_bootstrapper, Duration::from_secs(5))?;
    let reservation = new_self_update_reservation(
        install_root,
        reservation_id,
        &parent,
        &child_identity,
        app_handoff_id.clone(),
        active_lease_id,
        inbox_id,
        inbox_generation,
        transfer_state,
    )?;
    write_self_update_reservation(install_root, &reservation)?;
    let result = write_self_update_result(install_root, "reserved", &reservation)?;
    Ok(json!({
        "schemaVersion": 1,
        "state": "reserved",
        "launched": false,
        "handoffPid": child_identity.pid,
        "handoffId": app_handoff_id,
        "selfUpdate": result,
    }))
}

fn resolve_current_app_executable(
    install_root: Option<&PathBuf>,
    app_executable_name: Option<String>,
    fallback: &Path,
) -> Result<PathBuf> {
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

pub fn start(args: &Args) -> Result<Value> {
    if arg_value(args, "--transaction-root").is_some() {
        return Err(
            "--transaction-root is not supported; it is derived from --install-root".into(),
        );
    }
    let handoff_request = handoff_request(args)?;
    let explicit_install_root = arg_value(args, "--install-root").map(PathBuf::from);
    let inferred_install_root = explicit_install_root
        .clone()
        .or_else(|| infer_install_root().ok());
    let install_root = explicit_install_root
        .or(inferred_install_root)
        .map(|path| canonical_install_root(&path))
        .transpose()?;
    let app_executable_name = arg_value(args, "--app-executable-name");
    let layout = install_root
        .as_ref()
        .map(|install_root| resolve_layout(install_root.clone(), app_executable_name.clone()))
        .transpose()?;
    let transaction_root = layout
        .as_ref()
        .map(|value| value.transaction_root.clone())
        .ok_or("--install-root is required")?;
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

    let _update_lock = install_root
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
        match (verified_live_lease(install_root)?, handoff_request.as_ref()) {
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
    let app_executable = arg_value(args, "--app-executable")
        .map(PathBuf::from)
        .or_else(|| layout.as_ref().map(|value| value.app_executable.clone()))
        .ok_or("--install-root or --app-executable is required")?;

    let passthrough_args = args
        .passthrough
        .iter()
        .map(OsString::from)
        .collect::<Vec<_>>();
    let selected = newest_transaction(&transaction_root)?;
    if let Some(selected) = selected {
        match selected.state.as_str() {
            "prepared" => {
                if let Some(prepared_bootstrapper) = prepared_bootstrapper_path(&selected.path)? {
                    drop(session_lock.take());
                    let install_root = install_root
                        .as_deref()
                        .ok_or("self-update requires --install-root")?;
                    let mut reserved = launch_self_update_handoff(
                        &prepared_bootstrapper,
                        &selected.path,
                        install_root,
                        app_executable_name.as_deref(),
                        &app_executable,
                        &passthrough_args,
                        handoff_context.as_mut(),
                    )?;
                    reserved["appExecutable"] = json!(app_executable);
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
            "failed" => {
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
            "applied" | "rolled-back" => {
                let launch_executable = resolve_current_app_executable(
                    install_root.as_ref(),
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
