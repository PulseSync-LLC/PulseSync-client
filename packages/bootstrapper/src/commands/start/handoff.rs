use crate::{
    cli::args::{Args, arg_value},
    core::{
        active_app::{
            ActiveAppLease, ActiveAppLeaseState, HandoffTransfer, HandoffTransferState,
            LaunchReservationRecovery, ProcessIdentity, arm_crash_recovery,
            current_process_identity, finish_launch_reservation,
            inspect_launch_reservation_recovery, inspect_process_with_retry,
            mark_handoff_launch_failed, mark_handoff_successor_spawning, new_launch_reservation,
            process_identity_is_live, publish_handoff_successor, read_active_lease,
            read_handoff_transfer, read_launch_reservation, record_spawned_launch_reservation,
            remove_launch_reservation, take_over_failed_handoff,
        },
        error::Result,
        self_update::{SelfUpdateHandoffReservation, reservation_preserves_lease},
        session_lock::SessionLock,
    },
    domain::{
        launch_inbox::{
            LaunchRequestInput, LaunchRequestKind, bind_inbox_to_lease, enqueue_request,
            launch_request_result_value,
        },
        launcher::{launch_app, launch_app_with_env, launch_app_with_env_and_log},
    },
};
use serde_json::{Value, json};
use std::{
    env,
    ffi::OsString,
    path::Path,
    thread,
    time::{Duration, Instant},
};

#[derive(Clone, Debug)]
pub(super) struct HandoffRequest {
    pub(super) active_lease_id: String,
    pub(super) wait_for_pid: u32,
    pub(super) wait_timeout: Duration,
}

#[derive(Clone, Debug)]
pub(crate) struct HandoffContext {
    pub(crate) predecessor: ActiveAppLease,
    pub(crate) transfer: HandoffTransfer,
    pub(crate) rust_process: ProcessIdentity,
}

pub(super) fn handoff_request(args: &Args) -> Result<Option<HandoffRequest>> {
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

pub(super) fn emit_handoff_armed(args: &Args, context: &HandoffContext) {
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

pub(super) fn wait_for_process_exit(identity: &ProcessIdentity, timeout: Duration) -> Result<bool> {
    let started = Instant::now();
    while process_identity_is_live(identity)? {
        if started.elapsed() >= timeout {
            return Ok(false);
        }
        thread::sleep(Duration::from_millis(25));
    }
    Ok(true)
}

pub(super) fn reload_handoff_context(
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
    let successor_log = install_root.join("logs/bootstrap-successor.log");
    let pid = match launch_app_with_env_and_log(app_executable, args, &env, &successor_log) {
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

pub(super) fn launch_for_start(
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

pub(super) fn fail_handoff_if_armed(
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

pub(super) fn active_lease_result(
    install_root: &Path,
    args: &Args,
    lease: ActiveAppLease,
) -> Result<Value> {
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

pub(super) fn self_update_bound_lease(
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

pub(super) fn self_update_busy_result(reservation: &SelfUpdateHandoffReservation) -> Value {
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

pub(super) enum StartRecovery {
    None,
    Context(HandoffContext),
    LiveSuccessor(ActiveAppLease),
    Blocked(Value),
}

pub(super) fn recover_start_state(install_root: &Path) -> Result<StartRecovery> {
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
