use super::{
    model::{
        ActiveAppLease, ActiveAppLeaseState, AppLaunchReservation, LaunchReservationRecovery,
        LaunchReservationState, ProcessIdentity,
    },
    process::{
        process_identity_is_live, read_launch_reservation, remove_launch_reservation,
        write_active_lease, write_launch_reservation,
    },
    storage::{canonical_or_owned, now_ms, same_path},
};
use crate::core::{error::Result, host_contract::assert_runtime_executable};
use std::path::Path;
use uuid::Uuid;

const SPAWNING_RESERVATION_GRACE_MS: u128 = 30_000;

pub fn new_launch_reservation(
    install_root: &Path,
    launcher: &ProcessIdentity,
    executable: &Path,
) -> Result<AppLaunchReservation> {
    assert_runtime_executable(install_root, executable, "active app executable")?;
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
    assert_runtime_executable(install_root, &child.executable, "active app executable")?;
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
