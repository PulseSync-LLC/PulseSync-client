use crate::{
    cli::args::{Args, arg_value, required_arg, required_state_root},
    core::{
        active_app::{
            ActiveAppLeaseState, HandoffTransferState, adopt_launch_reservation,
            create_recovery_lease, inspect_process_with_retry, launch_reservation_allows_child,
            lease_matches_process, publish_handoff_successor, read_active_lease,
            read_handoff_transfer, read_launch_reservation, recover_abandoned_handoff,
            remove_launch_reservation, verified_live_lease,
        },
        error::Result,
        host_contract::{read_runtime_host_contract, write_runtime_host_contract},
        layout::{assert_inside, canonical_install_root, resolve_macos_layout},
        session_lock::SessionLock,
    },
    domain::{launch_inbox::bind_inbox_to_lease, macos_bundle, transactions::transaction_records},
};
use serde_json::{Value, json};
use std::{env, path::PathBuf, time::Duration};

fn blocked(code: &str, retryable: bool, safe_to_continue: bool) -> Value {
    json!({
        "schemaVersion": 1,
        "state": "blocked",
        "block": {
            "code": code,
            "retryable": retryable,
            "safeToContinue": safe_to_continue,
        }
    })
}

pub fn claim_active_app(args: &Args) -> Result<Value> {
    let install_root = canonical_install_root(&PathBuf::from(required_state_root(args)?))?;
    let pid = required_arg(args, "--pid")?
        .parse::<u32>()
        .map_err(|_| "--pid must be a positive process id")?;
    if pid == 0 {
        return Err("--pid must be greater than 0".into());
    }
    let app_executable = PathBuf::from(required_arg(args, "--app-executable")?);
    let macos_host = arg_value(args, "--host-bundle").map(PathBuf::from);
    let macos_layout = if let Some(host_bundle) = macos_host.as_ref() {
        Some(resolve_macos_layout(
            install_root.clone(),
            host_bundle.clone(),
            app_executable.clone(),
        )?)
    } else {
        assert_inside(&install_root, &app_executable, "active app executable")?;
        None
    };
    let _session_lock = SessionLock::acquire(&install_root, Duration::from_secs(10))?;
    let process = inspect_process_with_retry(pid, &app_executable, Duration::from_secs(2))?;
    if let Some(layout) = macos_layout.as_ref() {
        let requested_host = layout.host_bundle.as_ref().expect("macOS host bundle");
        let requested_executable = &layout.app_executable;
        if let Some(existing) = read_runtime_host_contract(&install_root)? {
            let rotates_host = existing.host_bundle.canonicalize()?
                != requested_host.canonicalize()?
                || existing.app_executable.canonicalize()?
                    != requested_executable.canonicalize()?;
            if rotates_host {
                if verified_live_lease(&install_root)?.is_some() {
                    return Ok(blocked("runtime-host-rotation-live-lease", true, false));
                }
                if transaction_records(&layout.transaction_root)?
                    .iter()
                    .any(|transaction| {
                        macos_bundle::is_macos_transaction(&transaction.value)
                            && !matches!(
                                transaction.candidate.state.as_str(),
                                "complete" | "rolled-back" | "failed"
                            )
                    })
                {
                    return Ok(blocked("runtime-host-rotation-active-update", true, false));
                }
            }
        }
        write_runtime_host_contract(&install_root, requested_host, requested_executable)?;
    }

    let launch_reservation_id = arg_value(args, "--launch-reservation-id")
        .or_else(|| env::var("PULSESYNC_LAUNCH_RESERVATION_ID").ok());
    let handoff_id =
        arg_value(args, "--handoff-id").or_else(|| env::var("PULSESYNC_HANDOFF_ID").ok());
    let expected_lease_id = arg_value(args, "--expected-lease-id");
    let recorded_lease = read_active_lease(&install_root)?;

    if let Some(mut lease) = verified_live_lease(&install_root)? {
        if !lease_matches_process(&lease, &process) {
            return Ok(blocked("different-live-lease", true, false));
        }
        if let Some(expected) = expected_lease_id {
            if lease.lease_id != expected {
                return Ok(blocked("process-identity-mismatch", false, false));
            }
            if lease.state == ActiveAppLeaseState::HandoffArmed {
                let Some(restored) = recover_abandoned_handoff(&install_root, &lease)? else {
                    return Ok(blocked("handoff-mismatch", true, false));
                };
                lease = restored;
            }
        } else {
            let proof_matches = launch_reservation_id
                .as_deref()
                .is_some_and(|value| value == lease.launch_proof_id)
                || handoff_id
                    .as_deref()
                    .is_some_and(|value| value == lease.launch_proof_id);
            if !proof_matches {
                return Ok(blocked("missing-launch-reservation", false, false));
            }
        }
        bind_inbox_to_lease(&install_root, &lease)?;
        if let Some(handoff_id) = handoff_id.as_deref() {
            let _ = macos_bundle::acknowledge_app_startup(&install_root, handoff_id)?;
        }
        return Ok(json!({
            "schemaVersion": 1,
            "state": "claimed",
            "lease": lease,
            "adoptedLaunchReservation": false,
        }));
    }

    if expected_lease_id.is_some() {
        return Ok(blocked("process-identity-mismatch", false, false));
    }

    if let Some(handoff_id) = handoff_id {
        let Some(transfer) = read_handoff_transfer(&install_root, &handoff_id)? else {
            return Ok(blocked("handoff-mismatch", true, false));
        };
        if !matches!(
            transfer.state,
            HandoffTransferState::SuccessorSpawning | HandoffTransferState::SuccessorLaunched
        ) {
            return Ok(blocked("handoff-mismatch", true, false));
        }
        let Some(reservation_id) = launch_reservation_id.as_deref() else {
            return Ok(blocked("missing-launch-reservation", false, false));
        };
        if transfer.successor_reservation_id.as_deref() != Some(reservation_id) {
            return Ok(blocked("handoff-mismatch", false, false));
        }
        let Some(reservation) = read_launch_reservation(&install_root)? else {
            return Ok(blocked("missing-launch-reservation", true, false));
        };
        if reservation.id != reservation_id
            || !launch_reservation_allows_child(&reservation, &process)?
        {
            return Ok(blocked("process-identity-mismatch", false, false));
        }
        let Some(predecessor) = recorded_lease else {
            return Ok(blocked("handoff-mismatch", true, false));
        };
        if predecessor.lease_id != transfer.predecessor_lease_id
            || predecessor.inbox_id != transfer.inbox_id
            || predecessor.inbox_generation != transfer.inbox_generation
            || predecessor.handoff.as_ref().map(|value| value.id.as_str())
                != Some(handoff_id.as_str())
        {
            return Ok(blocked("handoff-mismatch", false, false));
        }
        let (lease, _) =
            publish_handoff_successor(&install_root, &predecessor, &transfer, &process)?;
        bind_inbox_to_lease(&install_root, &lease)?;
        remove_launch_reservation(&install_root)?;
        let _ = macos_bundle::acknowledge_app_startup(&install_root, &handoff_id)?;
        return Ok(json!({
            "schemaVersion": 1,
            "state": "claimed",
            "lease": lease,
            "adoptedLaunchReservation": true,
        }));
    }

    if let Some(reservation_id) = launch_reservation_id {
        let Some(reservation) = read_launch_reservation(&install_root)? else {
            return Ok(blocked("missing-launch-reservation", true, false));
        };
        if reservation.id != reservation_id {
            return Ok(blocked("live-launch-reservation", true, false));
        }
        let lease = adopt_launch_reservation(&install_root, &reservation, &process)?;
        bind_inbox_to_lease(&install_root, &lease)?;
        return Ok(json!({
            "schemaVersion": 1,
            "state": "claimed",
            "lease": lease,
            "adoptedLaunchReservation": true,
        }));
    }

    if args.allow_unreserved_recovery && (cfg!(debug_assertions) || macos_host.is_some()) {
        let lease = create_recovery_lease(&install_root, &process)?;
        bind_inbox_to_lease(&install_root, &lease)?;
        return Ok(json!({
            "schemaVersion": 1,
            "state": "claimed",
            "lease": lease,
            "adoptedLaunchReservation": false,
        }));
    }

    Ok(blocked("missing-launch-reservation", false, false))
}
