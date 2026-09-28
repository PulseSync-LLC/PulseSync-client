use super::{
    model::{
        ActiveAppHandoff, ActiveAppLease, ActiveAppLeaseState, HandoffTransfer,
        HandoffTransferState, ProcessIdentity,
    },
    process::{handoff_owner_is_live, process_identity_is_live, write_active_lease},
    storage::{handoff_transfer_path, now_ms, read_json_if_exists, write_json_atomic},
};
use crate::core::{error::Result, host_contract::assert_runtime_executable};
use std::path::Path;
use uuid::Uuid;

pub fn read_handoff_transfer(
    install_root: &Path,
    handoff_id: &str,
) -> Result<Option<HandoffTransfer>> {
    read_json_if_exists(&handoff_transfer_path(install_root, handoff_id)?)
}

pub fn write_handoff_transfer(install_root: &Path, transfer: &HandoffTransfer) -> Result<()> {
    if transfer.schema_version != 1
        || Uuid::parse_str(&transfer.handoff_id).is_err()
        || Uuid::parse_str(&transfer.predecessor_lease_id).is_err()
        || Uuid::parse_str(&transfer.inbox_id).is_err()
    {
        return Err("invalid handoff transfer".into());
    }
    write_json_atomic(
        &handoff_transfer_path(install_root, &transfer.handoff_id)?,
        transfer,
    )
}

pub fn arm_handoff(
    install_root: &Path,
    lease: &ActiveAppLease,
    rust_process: &ProcessIdentity,
) -> Result<(ActiveAppLease, HandoffTransfer)> {
    if lease.state != ActiveAppLeaseState::Active || lease.handoff.is_some() {
        return Err("active app lease is not available for handoff".into());
    }
    let handoff_id = Uuid::new_v4().to_string();
    let armed_at = now_ms().to_string();
    let transfer = HandoffTransfer {
        schema_version: 1,
        handoff_id: handoff_id.clone(),
        state: HandoffTransferState::Armed,
        predecessor_lease_id: lease.lease_id.clone(),
        predecessor_pid: lease.pid,
        predecessor_process_start_id: lease.process_start_id.clone(),
        successor_lease_id: None,
        successor_reservation_id: None,
        successor_pid: None,
        successor_process_start_id: None,
        inbox_id: lease.inbox_id.clone(),
        inbox_generation: lease.inbox_generation,
    };
    let mut armed_lease = lease.clone();
    armed_lease.state = ActiveAppLeaseState::HandoffArmed;
    armed_lease.handoff = Some(ActiveAppHandoff {
        id: handoff_id,
        rust_pid: rust_process.pid,
        rust_process_start_id: rust_process.process_start_id.clone(),
        armed_at,
    });
    write_handoff_transfer(install_root, &transfer)?;
    write_active_lease(install_root, &armed_lease)?;
    Ok((armed_lease, transfer))
}

pub fn arm_crash_recovery(
    install_root: &Path,
    predecessor: &ActiveAppLease,
    rust_process: &ProcessIdentity,
) -> Result<(ActiveAppLease, HandoffTransfer)> {
    if predecessor.state != ActiveAppLeaseState::Active
        || predecessor.handoff.is_some()
        || process_identity_is_live(&predecessor.process_identity())?
    {
        return Err("active app lease is not eligible for crash recovery".into());
    }
    arm_dead_predecessor(install_root, predecessor, rust_process)
}

fn arm_dead_predecessor(
    install_root: &Path,
    predecessor: &ActiveAppLease,
    rust_process: &ProcessIdentity,
) -> Result<(ActiveAppLease, HandoffTransfer)> {
    let handoff_id = Uuid::new_v4().to_string();
    let transfer = HandoffTransfer {
        schema_version: 1,
        handoff_id: handoff_id.clone(),
        state: HandoffTransferState::Armed,
        predecessor_lease_id: predecessor.lease_id.clone(),
        predecessor_pid: predecessor.pid,
        predecessor_process_start_id: predecessor.process_start_id.clone(),
        successor_lease_id: None,
        successor_reservation_id: None,
        successor_pid: None,
        successor_process_start_id: None,
        inbox_id: predecessor.inbox_id.clone(),
        inbox_generation: predecessor.inbox_generation,
    };
    let mut armed = predecessor.clone();
    armed.state = ActiveAppLeaseState::HandoffArmed;
    armed.handoff = Some(ActiveAppHandoff {
        id: handoff_id,
        rust_pid: rust_process.pid,
        rust_process_start_id: rust_process.process_start_id.clone(),
        armed_at: now_ms().to_string(),
    });
    write_handoff_transfer(install_root, &transfer)?;
    write_active_lease(install_root, &armed)?;
    Ok((armed, transfer))
}

pub fn cancel_handoff(
    install_root: &Path,
    lease: &ActiveAppLease,
    transfer: &HandoffTransfer,
    rust_process: &ProcessIdentity,
) -> Result<(ActiveAppLease, HandoffTransfer)> {
    let Some(handoff) = lease.handoff.as_ref() else {
        return Err("armed lease is missing handoff metadata".into());
    };
    if lease.state != ActiveAppLeaseState::HandoffArmed
        || handoff.id != transfer.handoff_id
        || handoff.rust_pid != rust_process.pid
        || handoff.rust_process_start_id != rust_process.process_start_id
        || transfer.state != HandoffTransferState::Armed
        || !process_identity_is_live(&lease.process_identity())?
    {
        return Err("handoff cancellation identity mismatch".into());
    }
    let mut restored = lease.clone();
    restored.state = ActiveAppLeaseState::Active;
    restored.handoff = None;
    let mut canceled = transfer.clone();
    canceled.state = HandoffTransferState::Canceled;
    write_handoff_transfer(install_root, &canceled)?;
    write_active_lease(install_root, &restored)?;
    Ok((restored, canceled))
}

pub fn recover_abandoned_handoff(
    install_root: &Path,
    lease: &ActiveAppLease,
) -> Result<Option<ActiveAppLease>> {
    if lease.state != ActiveAppLeaseState::HandoffArmed {
        return Ok(None);
    }
    let Some(handoff) = lease.handoff.as_ref() else {
        return Err("armed lease is missing handoff metadata".into());
    };
    if handoff_owner_is_live(lease)? {
        return Ok(None);
    }
    let Some(mut transfer) = read_handoff_transfer(install_root, &handoff.id)? else {
        return Err("armed handoff transfer is missing".into());
    };
    if !matches!(
        transfer.state,
        HandoffTransferState::Armed | HandoffTransferState::Canceled
    ) || transfer.predecessor_lease_id != lease.lease_id
        || transfer.inbox_id != lease.inbox_id
        || transfer.inbox_generation != lease.inbox_generation
    {
        return Err("armed handoff transfer binding mismatch".into());
    }
    let mut restored = lease.clone();
    restored.state = ActiveAppLeaseState::Active;
    restored.handoff = None;
    if transfer.state != HandoffTransferState::Canceled {
        transfer.state = HandoffTransferState::Canceled;
        write_handoff_transfer(install_root, &transfer)?;
    }
    write_active_lease(install_root, &restored)?;
    Ok(Some(restored))
}

pub fn take_over_failed_handoff(
    install_root: &Path,
    predecessor: &ActiveAppLease,
    transfer: &HandoffTransfer,
    rust_process: &ProcessIdentity,
) -> Result<(ActiveAppLease, HandoffTransfer)> {
    if predecessor.state != ActiveAppLeaseState::HandoffArmed
        || process_identity_is_live(&predecessor.process_identity())?
        || handoff_owner_is_live(predecessor)?
        || !matches!(
            transfer.state,
            HandoffTransferState::Armed | HandoffTransferState::LaunchFailed
        )
        || transfer.predecessor_lease_id != predecessor.lease_id
        || transfer.inbox_id != predecessor.inbox_id
        || transfer.inbox_generation != predecessor.inbox_generation
    {
        return Err("failed handoff cannot be taken over".into());
    }
    let mut recovered_lease = predecessor.clone();
    recovered_lease.handoff = Some(ActiveAppHandoff {
        id: transfer.handoff_id.clone(),
        rust_pid: rust_process.pid,
        rust_process_start_id: rust_process.process_start_id.clone(),
        armed_at: now_ms().to_string(),
    });
    let mut recovered_transfer = transfer.clone();
    recovered_transfer.state = HandoffTransferState::Armed;
    recovered_transfer.successor_lease_id = None;
    recovered_transfer.successor_reservation_id = None;
    recovered_transfer.successor_pid = None;
    recovered_transfer.successor_process_start_id = None;
    write_handoff_transfer(install_root, &recovered_transfer)?;
    write_active_lease(install_root, &recovered_lease)?;
    Ok((recovered_lease, recovered_transfer))
}

pub fn mark_handoff_successor_spawning(
    install_root: &Path,
    transfer: &HandoffTransfer,
    reservation_id: &str,
) -> Result<HandoffTransfer> {
    if !matches!(
        transfer.state,
        HandoffTransferState::Armed | HandoffTransferState::LaunchFailed
    ) || Uuid::parse_str(reservation_id).is_err()
    {
        return Err("handoff is not ready for successor spawn".into());
    }
    let mut spawning = transfer.clone();
    spawning.state = HandoffTransferState::SuccessorSpawning;
    spawning.successor_lease_id = Some(Uuid::new_v4().to_string());
    spawning.successor_reservation_id = Some(reservation_id.to_string());
    spawning.successor_pid = None;
    spawning.successor_process_start_id = None;
    write_handoff_transfer(install_root, &spawning)?;
    Ok(spawning)
}

pub fn mark_handoff_launch_failed(
    install_root: &Path,
    transfer: &HandoffTransfer,
) -> Result<HandoffTransfer> {
    if !matches!(
        transfer.state,
        HandoffTransferState::Armed | HandoffTransferState::SuccessorSpawning
    ) {
        return Err("handoff is not spawning a successor".into());
    }
    let mut failed = transfer.clone();
    failed.state = HandoffTransferState::LaunchFailed;
    write_handoff_transfer(install_root, &failed)?;
    Ok(failed)
}

pub fn publish_handoff_successor(
    install_root: &Path,
    predecessor: &ActiveAppLease,
    transfer: &HandoffTransfer,
    child: &ProcessIdentity,
) -> Result<(ActiveAppLease, HandoffTransfer)> {
    if !matches!(
        transfer.state,
        HandoffTransferState::SuccessorSpawning | HandoffTransferState::SuccessorLaunched
    ) || transfer.predecessor_lease_id != predecessor.lease_id
        || transfer.inbox_id != predecessor.inbox_id
        || transfer.inbox_generation != predecessor.inbox_generation
    {
        return Err("handoff successor binding mismatch".into());
    }
    assert_runtime_executable(
        install_root,
        &child.executable,
        "handoff successor executable",
    )?;
    let successor_lease_id = transfer
        .successor_lease_id
        .clone()
        .ok_or("handoff successor lease id is missing")?;
    if transfer.state == HandoffTransferState::SuccessorLaunched
        && (transfer.successor_pid != Some(child.pid)
            || transfer.successor_process_start_id.as_deref() != Some(&child.process_start_id))
    {
        return Err("published handoff successor identity mismatch".into());
    }
    let successor = ActiveAppLease {
        schema_version: 1,
        lease_id: successor_lease_id.clone(),
        state: ActiveAppLeaseState::Active,
        pid: child.pid,
        process_start_id: child.process_start_id.clone(),
        executable: child.executable.clone(),
        launch_proof_id: transfer.handoff_id.clone(),
        launch_proof_kind: "handoff".to_string(),
        inbox_id: predecessor.inbox_id.clone(),
        inbox_generation: predecessor.inbox_generation,
        handoff: None,
        inherited_handoff_id: Some(transfer.handoff_id.clone()),
        inherited_from_lease_id: Some(predecessor.lease_id.clone()),
    };
    let mut launched = transfer.clone();
    launched.state = HandoffTransferState::SuccessorLaunched;
    launched.successor_lease_id = Some(successor_lease_id);
    launched.successor_pid = Some(child.pid);
    launched.successor_process_start_id = Some(child.process_start_id.clone());
    write_active_lease(install_root, &successor)?;
    write_handoff_transfer(install_root, &launched)?;
    Ok((successor, launched))
}

pub fn repair_handoff_successor_publication(
    install_root: &Path,
    lease: &ActiveAppLease,
) -> Result<()> {
    let Some(handoff_id) = lease.inherited_handoff_id.as_deref() else {
        return Ok(());
    };
    let Some(predecessor_lease_id) = lease.inherited_from_lease_id.as_deref() else {
        return Err("handoff successor is missing predecessor binding".into());
    };
    let Some(mut transfer) = read_handoff_transfer(install_root, handoff_id)? else {
        return Err("handoff successor transfer is missing".into());
    };
    if transfer.handoff_id != lease.launch_proof_id
        || lease.launch_proof_kind != "handoff"
        || transfer.predecessor_lease_id != predecessor_lease_id
        || transfer.successor_lease_id.as_deref() != Some(&lease.lease_id)
        || transfer.inbox_id != lease.inbox_id
        || transfer.inbox_generation != lease.inbox_generation
    {
        return Err("handoff successor publication binding mismatch".into());
    }
    match transfer.state {
        HandoffTransferState::SuccessorSpawning => {
            transfer.state = HandoffTransferState::SuccessorLaunched;
            transfer.successor_pid = Some(lease.pid);
            transfer.successor_process_start_id = Some(lease.process_start_id.clone());
            write_handoff_transfer(install_root, &transfer)
        }
        HandoffTransferState::SuccessorLaunched | HandoffTransferState::Consumed => {
            if transfer.successor_pid != Some(lease.pid)
                || transfer.successor_process_start_id.as_deref() != Some(&lease.process_start_id)
            {
                return Err("handoff successor publication identity mismatch".into());
            }
            Ok(())
        }
        _ => Err("handoff successor transfer is not publishable".into()),
    }
}

pub fn transfer_allows_reclaim(
    install_root: &Path,
    lease: &ActiveAppLease,
    claimed_by_lease_id: &str,
) -> Result<bool> {
    if lease.inherited_from_lease_id.as_deref() != Some(claimed_by_lease_id) {
        return Ok(false);
    }
    repair_handoff_successor_publication(install_root, lease)?;
    let Some(handoff_id) = lease.inherited_handoff_id.as_deref() else {
        return Ok(false);
    };
    let Some(transfer) = read_handoff_transfer(install_root, handoff_id)? else {
        return Ok(false);
    };
    Ok(matches!(
        transfer.state,
        HandoffTransferState::SuccessorLaunched | HandoffTransferState::Consumed
    ) && transfer.predecessor_lease_id == claimed_by_lease_id
        && transfer.successor_lease_id.as_deref() == Some(&lease.lease_id)
        && transfer.inbox_id == lease.inbox_id
        && transfer.inbox_generation == lease.inbox_generation)
}

pub fn mark_handoff_consumed(install_root: &Path, lease: &ActiveAppLease) -> Result<()> {
    let Some(handoff_id) = lease.inherited_handoff_id.as_deref() else {
        return Ok(());
    };
    repair_handoff_successor_publication(install_root, lease)?;
    let Some(mut transfer) = read_handoff_transfer(install_root, handoff_id)? else {
        return Err("successor handoff transfer is missing".into());
    };
    if transfer.successor_lease_id.as_deref() != Some(&lease.lease_id) {
        return Err("successor handoff transfer lease mismatch".into());
    }
    if !matches!(
        transfer.state,
        HandoffTransferState::SuccessorLaunched | HandoffTransferState::Consumed
    ) {
        return Err("handoff transfer cannot be consumed from its current state".into());
    }
    transfer.state = HandoffTransferState::Consumed;
    write_handoff_transfer(install_root, &transfer)
}
