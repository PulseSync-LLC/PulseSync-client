use crate::core::{
    active_app::{
        ActiveAppLease, ProcessIdentity, mark_handoff_consumed, process_identity_is_live,
        transfer_allows_reclaim, write_json_atomic,
    },
    error::Result,
    layout::assert_inside,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;

const INBOX_ROOT: &str = "runtime/launch-inbox";
const INBOX_STATE_FILE: &str = "state.json";
const ACKED_DIR: &str = "acked";
const MAX_ACK_TOMBSTONES: usize = 256;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaunchInboxState {
    pub schema_version: u64,
    pub inbox_id: String,
    pub generation: u64,
    pub next_sequence: u64,
    pub active_lease_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LaunchRequestKind {
    Activate,
    Arguments,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaunchRequestInput {
    pub schema_version: u64,
    pub kind: LaunchRequestKind,
    #[serde(default)]
    pub argv: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub additional_data: Option<BTreeMap<String, Value>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum LaunchRequestState {
    Pending,
    Claimed,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LaunchRequestEnvelope {
    pub schema_version: u64,
    pub id: String,
    pub sequence: u64,
    pub inbox_id: String,
    pub inbox_generation: u64,
    pub enqueued_by_lease_id: String,
    pub state: LaunchRequestState,
    pub kind: LaunchRequestKind,
    pub argv: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub additional_data: Option<BTreeMap<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claimed_by_lease_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claimed_by_pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claimed_by_process_start_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claimed_by_executable: Option<PathBuf>,
}

pub fn launch_request_result_value(request: &LaunchRequestEnvelope) -> Value {
    let mut value = serde_json::json!({
        "schemaVersion": request.schema_version,
        "id": request.id,
        "sequence": request.sequence,
        "inboxId": request.inbox_id,
        "inboxGeneration": request.inbox_generation,
        "enqueuedByLeaseId": request.enqueued_by_lease_id,
        "state": request.state,
        "kind": request.kind,
        "argv": request.argv,
    });
    if let Some(working_directory) = request.working_directory.as_deref() {
        value["workingDirectory"] = serde_json::json!(working_directory);
    }
    if let Some(additional_data) = request.additional_data.as_ref() {
        value["additionalData"] = serde_json::json!(additional_data);
    }
    if let Some(claimed_by_lease_id) = request.claimed_by_lease_id.as_deref() {
        value["claimedByLeaseId"] = serde_json::json!(claimed_by_lease_id);
    }
    if let Some(claimed_by_pid) = request.claimed_by_pid {
        value["claimedByPid"] = serde_json::json!(claimed_by_pid);
    }
    if let Some(claimed_by_process_start_id) = request.claimed_by_process_start_id.as_deref() {
        value["claimedByProcessStartId"] = serde_json::json!(claimed_by_process_start_id);
    }
    value
}

pub fn enqueue_request(
    install_root: &Path,
    lease: &ActiveAppLease,
    input: LaunchRequestInput,
) -> Result<LaunchRequestEnvelope> {
    validate_input(&input)?;
    let inbox_dir = inbox_dir(install_root, &lease.inbox_id)?;
    fs::create_dir_all(&inbox_dir)?;
    let mut state = load_or_create_state(&inbox_dir, lease)?;
    if state.active_lease_id != lease.lease_id {
        return Err(format!(
            "launch inbox belongs to lease {}, not {}",
            state.active_lease_id, lease.lease_id
        )
        .into());
    }
    let sequence = state.next_sequence;
    state.next_sequence = state
        .next_sequence
        .checked_add(1)
        .ok_or("launch inbox sequence overflow")?;
    write_json_atomic(&inbox_dir.join(INBOX_STATE_FILE), &state)?;

    let envelope = LaunchRequestEnvelope {
        schema_version: 1,
        id: Uuid::new_v4().to_string(),
        sequence,
        inbox_id: lease.inbox_id.clone(),
        inbox_generation: lease.inbox_generation,
        enqueued_by_lease_id: lease.lease_id.clone(),
        state: LaunchRequestState::Pending,
        kind: input.kind,
        argv: input.argv,
        working_directory: input.working_directory,
        additional_data: input.additional_data,
        claimed_by_lease_id: None,
        claimed_by_pid: None,
        claimed_by_process_start_id: None,
        claimed_by_executable: None,
    };
    write_json_atomic(&request_path(&inbox_dir, &envelope), &envelope)?;
    Ok(envelope)
}

pub fn claim_requests(
    install_root: &Path,
    lease: &ActiveAppLease,
    limit: usize,
) -> Result<Vec<LaunchRequestEnvelope>> {
    if !(1..=64).contains(&limit) {
        return Err("--limit must be between 1 and 64".into());
    }
    let inbox_dir = inbox_dir(install_root, &lease.inbox_id)?;
    let state = load_or_create_state(&inbox_dir, lease)?;
    if state.active_lease_id != lease.lease_id {
        return Err("launch inbox is not bound to the claiming lease".into());
    }
    let mut records = read_request_records(&inbox_dir)?;
    records.sort_by_key(|(_, request)| request.sequence);
    let mut claimed = Vec::new();

    for (path, mut request) in records {
        if claimed.len() >= limit {
            break;
        }
        if request.inbox_id != lease.inbox_id || request.inbox_generation != lease.inbox_generation
        {
            return Err(format!("launch request {} has wrong inbox binding", request.id).into());
        }
        let claimable = match request.state {
            LaunchRequestState::Pending => true,
            LaunchRequestState::Claimed => {
                if request.claimed_by_lease_id.as_deref() == Some(&lease.lease_id) {
                    true
                } else {
                    let Some(claimed_by_lease_id) = request.claimed_by_lease_id.as_deref() else {
                        return Err(format!(
                            "claimed launch request {} is missing lease ownership",
                            request.id
                        )
                        .into());
                    };
                    !claimed_process_is_live(&request)?
                        && transfer_allows_reclaim(install_root, lease, claimed_by_lease_id)?
                }
            }
        };
        if !claimable {
            continue;
        }
        request.state = LaunchRequestState::Claimed;
        request.claimed_by_lease_id = Some(lease.lease_id.clone());
        request.claimed_by_pid = Some(lease.pid);
        request.claimed_by_process_start_id = Some(lease.process_start_id.clone());
        request.claimed_by_executable = Some(lease.executable.clone());
        write_json_atomic(&path, &request)?;
        claimed.push(request);
    }
    maybe_mark_transfer_consumed(install_root, lease, &inbox_dir)?;
    Ok(claimed)
}

pub fn ack_request(
    install_root: &Path,
    lease: &ActiveAppLease,
    request_id: &str,
) -> Result<&'static str> {
    let request_id = Uuid::parse_str(request_id)
        .map_err(|_| "--request-id must be a UUID")?
        .to_string();
    let inbox_dir = inbox_dir(install_root, &lease.inbox_id)?;
    let acked_dir = inbox_dir.join(ACKED_DIR);
    fs::create_dir_all(&acked_dir)?;
    let acked_path = acked_dir.join(format!("{request_id}.json"));
    if acked_path.is_file() {
        return Ok("already-acked");
    }

    for (path, request) in read_request_records(&inbox_dir)? {
        if request.id != request_id {
            continue;
        }
        if request.state != LaunchRequestState::Claimed
            || request.claimed_by_lease_id.as_deref() != Some(&lease.lease_id)
        {
            return Err("launch request is not claimed by this lease".into());
        }
        fs::rename(path, &acked_path)?;
        prune_ack_tombstones(&acked_dir)?;
        maybe_mark_transfer_consumed(install_root, lease, &inbox_dir)?;
        return Ok("acked");
    }
    Ok("not-found")
}

fn maybe_mark_transfer_consumed(
    install_root: &Path,
    lease: &ActiveAppLease,
    inbox_dir: &Path,
) -> Result<()> {
    let Some(predecessor_lease_id) = lease.inherited_from_lease_id.as_deref() else {
        return Ok(());
    };
    let has_inherited_unacked = read_request_records(inbox_dir)?
        .into_iter()
        .any(|(_, request)| {
            request.enqueued_by_lease_id == predecessor_lease_id
                || request.claimed_by_lease_id.as_deref() == Some(predecessor_lease_id)
        });
    if !has_inherited_unacked {
        mark_handoff_consumed(install_root, lease)?;
    }
    Ok(())
}

pub fn bind_inbox_to_lease(install_root: &Path, lease: &ActiveAppLease) -> Result<()> {
    let inbox_dir = inbox_dir(install_root, &lease.inbox_id)?;
    fs::create_dir_all(&inbox_dir)?;
    let mut state = load_or_create_state(&inbox_dir, lease)?;
    if state.inbox_id != lease.inbox_id || state.generation != lease.inbox_generation {
        return Err("cannot bind lease to a different inbox generation".into());
    }
    state.active_lease_id = lease.lease_id.clone();
    write_json_atomic(&inbox_dir.join(INBOX_STATE_FILE), &state)
}

fn validate_input(input: &LaunchRequestInput) -> Result<()> {
    if input.schema_version != 1 {
        return Err("launch request schemaVersion must be 1".into());
    }
    if input.argv.len() > 128 || input.argv.iter().any(|value| value.len() > 8_192) {
        return Err("launch request argv exceeds the allowed size".into());
    }
    if let Some(additional_data) = &input.additional_data {
        if additional_data.len() > 32
            || additional_data
                .iter()
                .any(|(key, value)| key.len() > 128 || !is_allowed_scalar(value))
        {
            return Err("launch request additionalData is not allowlisted".into());
        }
    }
    Ok(())
}

fn is_allowed_scalar(value: &Value) -> bool {
    matches!(
        value,
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_)
    )
}

fn load_or_create_state(inbox_dir: &Path, lease: &ActiveAppLease) -> Result<LaunchInboxState> {
    let state_path = inbox_dir.join(INBOX_STATE_FILE);
    if state_path.is_file() {
        let state: LaunchInboxState = serde_json::from_slice(&fs::read(&state_path)?)?;
        if state.schema_version != 1
            || state.inbox_id != lease.inbox_id
            || state.generation != lease.inbox_generation
        {
            return Err("launch inbox state does not match active lease".into());
        }
        return Ok(state);
    }
    let state = LaunchInboxState {
        schema_version: 1,
        inbox_id: lease.inbox_id.clone(),
        generation: lease.inbox_generation,
        next_sequence: 1,
        active_lease_id: lease.lease_id.clone(),
    };
    write_json_atomic(&state_path, &state)?;
    Ok(state)
}

fn inbox_dir(install_root: &Path, inbox_id: &str) -> Result<PathBuf> {
    let inbox_id = Uuid::parse_str(inbox_id)
        .map_err(|_| "active lease inboxId must be a UUID")?
        .to_string();
    let root = install_root.join(INBOX_ROOT);
    let path = root.join(inbox_id);
    assert_inside(&root, &path, "launch inbox")?;
    Ok(path)
}

fn request_path(inbox_dir: &Path, request: &LaunchRequestEnvelope) -> PathBuf {
    inbox_dir.join(format!("{:020}-{}.json", request.sequence, request.id))
}

fn read_request_records(inbox_dir: &Path) -> Result<Vec<(PathBuf, LaunchRequestEnvelope)>> {
    if !inbox_dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut records = Vec::new();
    for entry in fs::read_dir(inbox_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file()
            || path.file_name().and_then(|name| name.to_str()) == Some(INBOX_STATE_FILE)
        {
            continue;
        }
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let request: LaunchRequestEnvelope = serde_json::from_slice(&fs::read(&path)?)?;
        records.push((path, request));
    }
    Ok(records)
}

fn claimed_process_is_live(request: &LaunchRequestEnvelope) -> Result<bool> {
    let (Some(pid), Some(process_start_id), Some(executable)) = (
        request.claimed_by_pid,
        request.claimed_by_process_start_id.as_ref(),
        request.claimed_by_executable.as_ref(),
    ) else {
        return Ok(false);
    };
    process_identity_is_live(&ProcessIdentity {
        pid,
        process_start_id: process_start_id.clone(),
        executable: executable.clone(),
    })
}

fn prune_ack_tombstones(acked_dir: &Path) -> Result<()> {
    let mut entries = fs::read_dir(acked_dir)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_file())
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| {
        entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(std::time::UNIX_EPOCH)
    });
    let remove_count = entries.len().saturating_sub(MAX_ACK_TOMBSTONES);
    for entry in entries.into_iter().take(remove_count) {
        fs::remove_file(entry.path())?;
    }
    Ok(())
}
