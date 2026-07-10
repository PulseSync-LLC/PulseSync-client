use crate::core::{error::Result, layout::assert_inside};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const ACTIVE_APP_FILE: &str = "runtime/active-app.json";
const LAUNCH_RESERVATION_FILE: &str = "runtime/launch-reservation.json";
const HANDOFF_ROOT: &str = "runtime/handoffs";
const SPAWNING_RESERVATION_GRACE_MS: u128 = 30_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessIdentity {
    pub pid: u32,
    pub process_start_id: String,
    pub executable: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ActiveAppLeaseState {
    Active,
    HandoffArmed,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActiveAppHandoff {
    pub id: String,
    pub rust_pid: u32,
    pub rust_process_start_id: String,
    pub armed_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ActiveAppLease {
    pub schema_version: u64,
    pub lease_id: String,
    pub state: ActiveAppLeaseState,
    pub pid: u32,
    pub process_start_id: String,
    pub executable: PathBuf,
    pub launch_proof_id: String,
    pub launch_proof_kind: String,
    pub inbox_id: String,
    pub inbox_generation: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handoff: Option<ActiveAppHandoff>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inherited_handoff_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inherited_from_lease_id: Option<String>,
}

impl ActiveAppLease {
    pub fn process_identity(&self) -> ProcessIdentity {
        ProcessIdentity {
            pid: self.pid,
            process_start_id: self.process_start_id.clone(),
            executable: self.executable.clone(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LaunchReservationState {
    Spawning,
    Spawned,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum HandoffTransferState {
    Armed,
    SuccessorSpawning,
    SuccessorLaunched,
    LaunchFailed,
    Consumed,
    Canceled,
}

#[derive(Clone, Debug)]
pub enum LaunchReservationRecovery {
    LiveChild(ProcessIdentity),
    DeadChild,
    AwaitingChildClaim,
    AbandonedBeforeChild,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HandoffTransfer {
    pub schema_version: u64,
    pub handoff_id: String,
    pub state: HandoffTransferState,
    pub predecessor_lease_id: String,
    pub predecessor_pid: u32,
    pub predecessor_process_start_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub successor_lease_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub successor_reservation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub successor_pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub successor_process_start_id: Option<String>,
    pub inbox_id: String,
    pub inbox_generation: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppLaunchReservation {
    pub schema_version: u64,
    pub id: String,
    pub state: LaunchReservationState,
    pub launcher_pid: u32,
    pub launcher_process_start_id: String,
    pub launcher_executable: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child_pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub child_process_start_id: Option<String>,
    pub executable: PathBuf,
    pub created_at: String,
}

pub fn active_app_path(install_root: &Path) -> PathBuf {
    install_root.join(ACTIVE_APP_FILE)
}

pub fn launch_reservation_path(install_root: &Path) -> PathBuf {
    install_root.join(LAUNCH_RESERVATION_FILE)
}

pub fn handoff_transfer_path(install_root: &Path, handoff_id: &str) -> Result<PathBuf> {
    let handoff_id = Uuid::parse_str(handoff_id)
        .map_err(|_| "handoff id must be a UUID")?
        .to_string();
    let root = install_root.join(HANDOFF_ROOT);
    let path = root.join(format!("{handoff_id}.json"));
    assert_inside(&root, &path, "handoff transfer")?;
    Ok(path)
}

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
    assert_inside(
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

pub fn new_launch_reservation(
    install_root: &Path,
    launcher: &ProcessIdentity,
    executable: &Path,
) -> Result<AppLaunchReservation> {
    assert_inside(install_root, executable, "active app executable")?;
    if let Some(existing) = read_launch_reservation(install_root)? {
        if existing.schema_version != 1 || existing.id.trim().is_empty() {
            return Err("invalid existing launch reservation".into());
        }
        let existing_launcher = ProcessIdentity {
            pid: existing.launcher_pid,
            process_start_id: existing.launcher_process_start_id.clone(),
            executable: existing.launcher_executable.clone(),
        };
        if process_identity_is_live(&existing_launcher)? {
            return Err(format!("launch reservation is busy: {}", existing.id).into());
        }
        if let (Some(child_pid), Some(child_start_id)) = (
            existing.child_pid,
            existing.child_process_start_id.as_deref(),
        ) {
            let child = ProcessIdentity {
                pid: child_pid,
                process_start_id: child_start_id.to_string(),
                executable: existing.executable.clone(),
            };
            if process_identity_is_live(&child)? {
                return Err(
                    format!("launch reservation child is still live: {}", existing.id).into(),
                );
            }
        }
        let created_at = existing.created_at.parse::<u128>().unwrap_or(now_ms());
        if existing.state == LaunchReservationState::Spawning
            && now_ms().saturating_sub(created_at) < SPAWNING_RESERVATION_GRACE_MS
        {
            return Err(format!(
                "launch reservation is awaiting child claim: {}",
                existing.id
            )
            .into());
        }
        remove_launch_reservation(install_root)?;
    }
    let reservation = AppLaunchReservation {
        schema_version: 1,
        id: Uuid::new_v4().to_string(),
        state: LaunchReservationState::Spawning,
        launcher_pid: launcher.pid,
        launcher_process_start_id: launcher.process_start_id.clone(),
        launcher_executable: launcher.executable.clone(),
        child_pid: None,
        child_process_start_id: None,
        executable: canonical_or_owned(executable),
        created_at: now_ms().to_string(),
    };
    write_launch_reservation(install_root, &reservation)?;
    Ok(reservation)
}

pub fn finish_launch_reservation(
    install_root: &Path,
    reservation: &mut AppLaunchReservation,
    child: &ProcessIdentity,
) -> Result<ActiveAppLease> {
    record_spawned_launch_reservation(install_root, reservation, child)?;

    let lease = ActiveAppLease {
        schema_version: 1,
        lease_id: Uuid::new_v4().to_string(),
        state: ActiveAppLeaseState::Active,
        pid: child.pid,
        process_start_id: child.process_start_id.clone(),
        executable: child.executable.clone(),
        launch_proof_id: reservation.id.clone(),
        launch_proof_kind: "reservation".to_string(),
        inbox_id: Uuid::new_v4().to_string(),
        inbox_generation: 1,
        handoff: None,
        inherited_handoff_id: None,
        inherited_from_lease_id: None,
    };
    write_active_lease(install_root, &lease)?;
    remove_launch_reservation(install_root)?;
    Ok(lease)
}

pub fn record_spawned_launch_reservation(
    install_root: &Path,
    reservation: &mut AppLaunchReservation,
    child: &ProcessIdentity,
) -> Result<()> {
    if !same_path(&reservation.executable, &child.executable) {
        return Err(format!(
            "launched child executable mismatch: expected {}, got {}",
            reservation.executable.display(),
            child.executable.display()
        )
        .into());
    }
    reservation.state = LaunchReservationState::Spawned;
    reservation.child_pid = Some(child.pid);
    reservation.child_process_start_id = Some(child.process_start_id.clone());
    write_launch_reservation(install_root, reservation)?;
    Ok(())
}

pub fn adopt_launch_reservation(
    install_root: &Path,
    reservation: &AppLaunchReservation,
    child: &ProcessIdentity,
) -> Result<ActiveAppLease> {
    if reservation.schema_version != 1 || reservation.id.trim().is_empty() {
        return Err("invalid launch reservation".into());
    }
    if !launch_reservation_allows_child(reservation, child)? {
        return Err("launch reservation does not belong to this process".into());
    }
    let lease = ActiveAppLease {
        schema_version: 1,
        lease_id: Uuid::new_v4().to_string(),
        state: ActiveAppLeaseState::Active,
        pid: child.pid,
        process_start_id: child.process_start_id.clone(),
        executable: child.executable.clone(),
        launch_proof_id: reservation.id.clone(),
        launch_proof_kind: "reservation".to_string(),
        inbox_id: Uuid::new_v4().to_string(),
        inbox_generation: 1,
        handoff: None,
        inherited_handoff_id: None,
        inherited_from_lease_id: None,
    };
    write_active_lease(install_root, &lease)?;
    remove_launch_reservation(install_root)?;
    Ok(lease)
}

pub fn launch_reservation_allows_child(
    reservation: &AppLaunchReservation,
    child: &ProcessIdentity,
) -> Result<bool> {
    let child_matches = reservation.child_pid == Some(child.pid)
        && reservation.child_process_start_id.as_deref() == Some(&child.process_start_id);
    let launcher = ProcessIdentity {
        pid: reservation.launcher_pid,
        process_start_id: reservation.launcher_process_start_id.clone(),
        executable: reservation.launcher_executable.clone(),
    };
    let may_adopt_spawning = reservation.state == LaunchReservationState::Spawning
        && reservation.child_pid.is_none()
        && reservation.child_process_start_id.is_none()
        && !process_identity_is_live(&launcher)?;
    Ok((child_matches || may_adopt_spawning)
        && same_path(&reservation.executable, &child.executable))
}

pub fn inspect_launch_reservation_recovery(
    reservation: &AppLaunchReservation,
) -> Result<LaunchReservationRecovery> {
    match (
        reservation.child_pid,
        reservation.child_process_start_id.as_deref(),
    ) {
        (Some(pid), Some(process_start_id)) => {
            let child = ProcessIdentity {
                pid,
                process_start_id: process_start_id.to_string(),
                executable: reservation.executable.clone(),
            };
            if process_identity_is_live(&child)? {
                Ok(LaunchReservationRecovery::LiveChild(child))
            } else {
                Ok(LaunchReservationRecovery::DeadChild)
            }
        }
        (None, None) => {
            let launcher = ProcessIdentity {
                pid: reservation.launcher_pid,
                process_start_id: reservation.launcher_process_start_id.clone(),
                executable: reservation.launcher_executable.clone(),
            };
            let created_at = reservation.created_at.parse::<u128>().unwrap_or(now_ms());
            if process_identity_is_live(&launcher)?
                || now_ms().saturating_sub(created_at) < SPAWNING_RESERVATION_GRACE_MS
            {
                Ok(LaunchReservationRecovery::AwaitingChildClaim)
            } else {
                Ok(LaunchReservationRecovery::AbandonedBeforeChild)
            }
        }
        _ => Err("launch reservation has incomplete child identity".into()),
    }
}

pub fn create_recovery_lease(
    install_root: &Path,
    child: &ProcessIdentity,
) -> Result<ActiveAppLease> {
    assert_inside(install_root, &child.executable, "active app executable")?;
    let lease = ActiveAppLease {
        schema_version: 1,
        lease_id: Uuid::new_v4().to_string(),
        state: ActiveAppLeaseState::Active,
        pid: child.pid,
        process_start_id: child.process_start_id.clone(),
        executable: child.executable.clone(),
        launch_proof_id: Uuid::new_v4().to_string(),
        launch_proof_kind: "recovery".to_string(),
        inbox_id: Uuid::new_v4().to_string(),
        inbox_generation: 1,
        handoff: None,
        inherited_handoff_id: None,
        inherited_from_lease_id: None,
    };
    write_active_lease(install_root, &lease)?;
    Ok(lease)
}

pub fn lease_matches_process(lease: &ActiveAppLease, process: &ProcessIdentity) -> bool {
    lease.pid == process.pid
        && lease.process_start_id == process.process_start_id
        && same_path(&lease.executable, &process.executable)
}

pub fn read_active_lease(install_root: &Path) -> Result<Option<ActiveAppLease>> {
    read_json_if_exists(&active_app_path(install_root))
}

pub fn write_active_lease(install_root: &Path, lease: &ActiveAppLease) -> Result<()> {
    if lease.schema_version != 1 || lease.lease_id.trim().is_empty() {
        return Err("invalid active app lease".into());
    }
    assert_inside(install_root, &lease.executable, "active app executable")?;
    write_json_atomic(&active_app_path(install_root), lease)
}

pub fn read_launch_reservation(install_root: &Path) -> Result<Option<AppLaunchReservation>> {
    read_json_if_exists(&launch_reservation_path(install_root))
}

pub fn write_launch_reservation(
    install_root: &Path,
    reservation: &AppLaunchReservation,
) -> Result<()> {
    assert_inside(
        install_root,
        &reservation.executable,
        "launch reservation executable",
    )?;
    write_json_atomic(&launch_reservation_path(install_root), reservation)
}

pub fn remove_launch_reservation(install_root: &Path) -> Result<()> {
    remove_if_exists(&launch_reservation_path(install_root))
}

pub fn verified_live_lease(install_root: &Path) -> Result<Option<ActiveAppLease>> {
    let Some(lease) = read_active_lease(install_root)? else {
        return Ok(None);
    };
    if lease.schema_version != 1 {
        return Err(format!(
            "unsupported active app lease schemaVersion {}",
            lease.schema_version
        )
        .into());
    }
    if process_identity_is_live(&lease.process_identity())? {
        repair_handoff_successor_publication(install_root, &lease)?;
        return Ok(Some(lease));
    }
    if lease.state == ActiveAppLeaseState::HandoffArmed && handoff_owner_is_live(&lease)? {
        return Ok(Some(lease));
    }
    Ok(None)
}

pub fn handoff_owner_is_live(lease: &ActiveAppLease) -> Result<bool> {
    let Some(handoff) = lease.handoff.as_ref() else {
        return Ok(false);
    };
    process_start_is_live(handoff.rust_pid, &handoff.rust_process_start_id)
}

pub fn inspect_process_with_retry(
    pid: u32,
    expected_executable: &Path,
    timeout: Duration,
) -> Result<ProcessIdentity> {
    let started = Instant::now();
    loop {
        if let Some(identity) = inspect_process(pid, expected_executable)? {
            return Ok(identity);
        }
        if started.elapsed() >= timeout {
            return Err(format!("process {pid} did not become inspectable").into());
        }
        thread::sleep(Duration::from_millis(25));
    }
}

pub fn process_identity_is_live(identity: &ProcessIdentity) -> Result<bool> {
    let Some(current) = inspect_process(identity.pid, &identity.executable)? else {
        return Ok(false);
    };
    Ok(current.process_start_id == identity.process_start_id
        && same_path(&current.executable, &identity.executable))
}

pub fn process_start_is_live(pid: u32, process_start_id: &str) -> Result<bool> {
    process_start_is_live_platform(pid, process_start_id)
}

#[cfg(windows)]
fn process_start_is_live_platform(pid: u32, process_start_id: &str) -> Result<bool> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, FILETIME, STILL_ACTIVE},
        System::Threading::{
            GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        },
    };

    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        let error = std::io::Error::last_os_error();
        return match error.raw_os_error() {
            Some(87) | Some(1168) => Ok(false),
            _ => Err(error.into()),
        };
    }
    let result = (|| -> Result<bool> {
        let mut exit_code = 0_u32;
        if unsafe { GetExitCodeProcess(handle, &mut exit_code) } == 0
            || exit_code != STILL_ACTIVE as u32
        {
            return Ok(false);
        }
        let mut creation = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        if unsafe { GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        let start_id = ((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64;
        Ok(start_id.to_string() == process_start_id)
    })();
    unsafe {
        CloseHandle(handle);
    }
    result
}

#[cfg(all(unix, not(target_os = "macos")))]
fn process_start_is_live_platform(pid: u32, process_start_id: &str) -> Result<bool> {
    if unsafe { libc::kill(pid as i32, 0) } != 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            return Ok(false);
        }
        if error.raw_os_error() != Some(libc::EPERM) {
            return Err(error.into());
        }
    }
    let stat = fs::read_to_string(format!("/proc/{pid}/stat"))?;
    let start_id = stat
        .rsplit_once(')')
        .map(|(_, rest)| rest.trim())
        .and_then(|rest| rest.split_whitespace().nth(19))
        .ok_or("process stat is missing start time")?;
    Ok(start_id == process_start_id)
}

#[cfg(target_os = "macos")]
fn process_start_is_live_platform(pid: u32, process_start_id: &str) -> Result<bool> {
    use std::mem::MaybeUninit;

    if unsafe { libc::kill(pid as i32, 0) } != 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            return Ok(false);
        }
        if error.raw_os_error() != Some(libc::EPERM) {
            return Err(error.into());
        }
    }
    let mut info = MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let info_size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
    let read = unsafe {
        libc::proc_pidinfo(
            pid as i32,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            info_size,
        )
    };
    if read != info_size {
        return Err(std::io::Error::last_os_error().into());
    }
    let info = unsafe { info.assume_init() };
    Ok(format!("{}.{}", info.pbi_start_tvsec, info.pbi_start_tvusec) == process_start_id)
}

pub fn current_process_identity() -> Result<ProcessIdentity> {
    let executable = std::env::current_exe()?;
    inspect_process_with_retry(std::process::id(), &executable, Duration::from_secs(1))
}

#[cfg(windows)]
fn inspect_process(pid: u32, expected_executable: &Path) -> Result<Option<ProcessIdentity>> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, FILETIME, STILL_ACTIVE},
        System::Threading::{
            GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
            QueryFullProcessImageNameW,
        },
    };

    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        let error = std::io::Error::last_os_error();
        return match error.raw_os_error() {
            Some(87) | Some(1168) => Ok(None),
            _ => Err(error.into()),
        };
    }

    let result = (|| -> Result<Option<ProcessIdentity>> {
        let mut exit_code = 0_u32;
        if unsafe { GetExitCodeProcess(handle, &mut exit_code) } == 0
            || exit_code != STILL_ACTIVE as u32
        {
            return Ok(None);
        }

        let mut creation = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        if unsafe { GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }

        let mut buffer = vec![0_u16; 32_768];
        let mut length = buffer.len() as u32;
        if unsafe { QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut length) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        buffer.truncate(length as usize);
        let executable = PathBuf::from(String::from_utf16(&buffer)?);
        if !same_path(&executable, expected_executable) {
            return Ok(None);
        }
        let start_id = ((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64;
        Ok(Some(ProcessIdentity {
            pid,
            process_start_id: start_id.to_string(),
            executable: canonical_or_owned(&executable),
        }))
    })();
    unsafe {
        CloseHandle(handle);
    }
    result
}

#[cfg(all(unix, not(target_os = "macos")))]
fn inspect_process(pid: u32, expected_executable: &Path) -> Result<Option<ProcessIdentity>> {
    if unsafe { libc::kill(pid as i32, 0) } != 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            return Ok(None);
        }
    }

    let proc_root = PathBuf::from(format!("/proc/{pid}"));
    let executable = fs::read_link(proc_root.join("exe"))
        .unwrap_or_else(|_| canonical_or_owned(expected_executable));
    if !same_path(&executable, expected_executable) {
        return Ok(None);
    }
    let start_id = fs::read_to_string(proc_root.join("stat"))
        .ok()
        .and_then(|stat| {
            stat.rsplit_once(')')
                .map(|(_, rest)| rest.trim().to_string())
        })
        .and_then(|rest| rest.split_whitespace().nth(19).map(str::to_string))
        .unwrap_or_else(|| format!("pid-{pid}"));
    Ok(Some(ProcessIdentity {
        pid,
        process_start_id: start_id,
        executable: canonical_or_owned(&executable),
    }))
}

#[cfg(target_os = "macos")]
fn inspect_process(pid: u32, expected_executable: &Path) -> Result<Option<ProcessIdentity>> {
    use std::{ffi::CStr, mem::MaybeUninit};

    if unsafe { libc::kill(pid as i32, 0) } != 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            return Ok(None);
        }
        return Err(error.into());
    }

    let mut path_buffer = vec![0_u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    let path_length = unsafe {
        libc::proc_pidpath(
            pid as i32,
            path_buffer.as_mut_ptr().cast(),
            path_buffer.len() as u32,
        )
    };
    if path_length <= 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let executable = PathBuf::from(
        CStr::from_bytes_until_nul(&path_buffer)
            .map_err(|_| "macOS process path is not null-terminated")?
            .to_string_lossy()
            .to_string(),
    );
    if !same_path(&executable, expected_executable) {
        return Ok(None);
    }

    let mut info = MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let info_size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
    let read = unsafe {
        libc::proc_pidinfo(
            pid as i32,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            info_size,
        )
    };
    if read != info_size {
        return Err(std::io::Error::last_os_error().into());
    }
    let info = unsafe { info.assume_init() };
    Ok(Some(ProcessIdentity {
        pid,
        process_start_id: format!("{}.{}", info.pbi_start_tvsec, info.pbi_start_tvusec),
        executable: canonical_or_owned(&executable),
    }))
}

fn read_json_if_exists<T>(path: &Path) -> Result<Option<T>>
where
    T: for<'de> Deserialize<'de>,
{
    if !path.is_file() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_slice(&fs::read(path)?)?))
}

pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension(format!("tmp-{}-{}", std::process::id(), Uuid::new_v4()));
    let write_result = (|| -> Result<()> {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)?;
        file.write_all(format!("{}\n", serde_json::to_string_pretty(value)?).as_bytes())?;
        file.sync_all()?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    if let Err(error) = replace_file(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    sync_parent_directory(path)?;
    Ok(())
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let target = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    if unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> Result<()> {
    fs::rename(source, target)?;
    Ok(())
}

fn remove_if_exists(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

fn canonical_or_owned(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn same_path(left: &Path, right: &Path) -> bool {
    let left = canonical_or_owned(left).to_string_lossy().to_string();
    let right = canonical_or_owned(right).to_string_lossy().to_string();
    if cfg!(windows) {
        left.replace('/', "\\")
            .eq_ignore_ascii_case(&right.replace('/', "\\"))
    } else {
        left == right
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
