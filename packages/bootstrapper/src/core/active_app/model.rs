use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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
