use crate::core::{
    active_app::{ActiveAppLease, ProcessIdentity, process_identity_is_live, write_json_atomic},
    error::Result,
    layout::assert_inside,
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const RESERVATION_FILE: &str = "updates/self-update-handoff.json";
const RESULT_FILE: &str = "updates/self-update-handoff-result.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SelfUpdateHandoffReservation {
    pub schema_version: u64,
    pub id: String,
    pub parent_pid: u32,
    pub parent_process_start_id: String,
    pub child_pid: u32,
    pub child_process_start_id: String,
    pub prepared_executable: PathBuf,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_handoff_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_lease_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inbox_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inbox_generation: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transfer_state: Option<String>,
    pub created_at: String,
}

impl SelfUpdateHandoffReservation {
    pub fn child_identity(&self) -> ProcessIdentity {
        ProcessIdentity {
            pid: self.child_pid,
            process_start_id: self.child_process_start_id.clone(),
            executable: self.prepared_executable.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfUpdateReservationResult {
    pub schema_version: u64,
    pub state: String,
    pub id: String,
    pub parent_pid: u32,
    pub child_pid: u32,
}

pub enum SelfUpdateMutationGate {
    Clear,
    Busy(SelfUpdateReservationResult),
}

pub fn self_update_reservation_path(install_root: &Path) -> PathBuf {
    install_root.join(RESERVATION_FILE)
}

pub fn read_self_update_reservation(
    install_root: &Path,
) -> Result<Option<SelfUpdateHandoffReservation>> {
    let path = self_update_reservation_path(install_root);
    if !path.is_file() {
        return Ok(None);
    }
    let reservation: SelfUpdateHandoffReservation = serde_json::from_slice(&fs::read(&path)?)?;
    validate_self_update_reservation(install_root, &reservation)?;
    Ok(Some(reservation))
}

pub fn write_self_update_reservation(
    install_root: &Path,
    reservation: &SelfUpdateHandoffReservation,
) -> Result<()> {
    validate_self_update_reservation(install_root, reservation)?;
    write_json_atomic(&self_update_reservation_path(install_root), reservation)
}

pub fn remove_self_update_reservation(install_root: &Path) -> Result<()> {
    match fs::remove_file(self_update_reservation_path(install_root)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

pub fn write_self_update_result(
    install_root: &Path,
    state: &str,
    reservation: &SelfUpdateHandoffReservation,
) -> Result<SelfUpdateReservationResult> {
    let result = SelfUpdateReservationResult {
        schema_version: 1,
        state: state.to_string(),
        id: reservation.id.clone(),
        parent_pid: reservation.parent_pid,
        child_pid: reservation.child_pid,
    };
    write_json_atomic(&install_root.join(RESULT_FILE), &result)?;
    Ok(result)
}

pub fn reservation_child_is_live(reservation: &SelfUpdateHandoffReservation) -> Result<bool> {
    process_identity_is_live(&reservation.child_identity())
}

pub fn reservation_preserves_lease(
    reservation: &SelfUpdateHandoffReservation,
    lease: &ActiveAppLease,
) -> bool {
    reservation.active_lease_id.as_deref() == Some(lease.lease_id.as_str())
        && reservation.inbox_id.as_deref() == Some(lease.inbox_id.as_str())
        && reservation.inbox_generation == Some(lease.inbox_generation)
        && reservation.transfer_state.as_deref() == Some("armed")
        && lease.handoff.as_ref().map(|handoff| handoff.id.as_str())
            == reservation.app_handoff_id.as_deref()
}

pub fn reconcile_self_update_mutation(install_root: &Path) -> Result<SelfUpdateMutationGate> {
    let Some(reservation) = read_self_update_reservation(install_root)? else {
        return Ok(SelfUpdateMutationGate::Clear);
    };
    if reservation_child_is_live(&reservation)? {
        let result = write_self_update_result(install_root, "busy", &reservation)?;
        return Ok(SelfUpdateMutationGate::Busy(result));
    }
    write_self_update_result(install_root, "stale-cleaned", &reservation)?;
    remove_self_update_reservation(install_root)?;
    Ok(SelfUpdateMutationGate::Clear)
}

pub fn new_self_update_reservation(
    install_root: &Path,
    id: String,
    parent: &ProcessIdentity,
    child: &ProcessIdentity,
    app_handoff_id: Option<String>,
    active_lease_id: Option<String>,
    inbox_id: Option<String>,
    inbox_generation: Option<u64>,
    transfer_state: Option<String>,
) -> Result<SelfUpdateHandoffReservation> {
    let reservation = SelfUpdateHandoffReservation {
        schema_version: 1,
        id,
        parent_pid: parent.pid,
        parent_process_start_id: parent.process_start_id.clone(),
        child_pid: child.pid,
        child_process_start_id: child.process_start_id.clone(),
        prepared_executable: child.executable.clone(),
        app_handoff_id,
        active_lease_id,
        inbox_id,
        inbox_generation,
        transfer_state,
        created_at: now_ms().to_string(),
    };
    validate_self_update_reservation(install_root, &reservation)?;
    Ok(reservation)
}

fn validate_self_update_reservation(
    install_root: &Path,
    reservation: &SelfUpdateHandoffReservation,
) -> Result<()> {
    if reservation.schema_version != 1
        || Uuid::parse_str(&reservation.id).is_err()
        || reservation.parent_pid == 0
        || reservation.child_pid == 0
        || reservation.parent_process_start_id.trim().is_empty()
        || reservation.child_process_start_id.trim().is_empty()
    {
        return Err("invalid self-update handoff reservation".into());
    }
    match (
        reservation.app_handoff_id.as_deref(),
        reservation.active_lease_id.as_deref(),
        reservation.inbox_id.as_deref(),
        reservation.inbox_generation,
        reservation.transfer_state.as_deref(),
    ) {
        (None, None, None, None, None) => {}
        (
            Some(handoff_id),
            Some(active_lease_id),
            Some(inbox_id),
            Some(generation),
            Some("armed"),
        ) if Uuid::parse_str(handoff_id).is_ok()
            && Uuid::parse_str(active_lease_id).is_ok()
            && Uuid::parse_str(inbox_id).is_ok()
            && generation > 0 => {}
        _ => return Err("invalid self-update app handoff binding".into()),
    }
    assert_inside(
        &install_root.join("updates").join("transactions"),
        &reservation.prepared_executable,
        "prepared self-update executable",
    )?;
    Ok(())
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
