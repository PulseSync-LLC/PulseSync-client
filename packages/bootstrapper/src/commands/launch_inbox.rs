use crate::{
    cli::args::{Args, required_arg, usize_arg},
    core::{
        active_app::verified_live_lease, error::Result, layout::canonical_install_root,
        session_lock::SessionLock,
    },
    domain::launch_inbox::{
        LaunchRequestInput, ack_request, bind_inbox_to_lease, claim_requests, enqueue_request,
        launch_request_result_value,
    },
};
use serde_json::{Value, json};
use std::{io::Read, path::PathBuf, time::Duration};

const MAX_STDIN_BYTES: u64 = 65_536;

fn active_lease(
    args: &Args,
) -> Result<(
    PathBuf,
    crate::core::active_app::ActiveAppLease,
    SessionLock,
)> {
    let install_root =
        canonical_install_root(&PathBuf::from(required_arg(args, "--install-root")?))?;
    let expected_lease_id = required_arg(args, "--active-lease-id")?;
    let _session_lock = SessionLock::acquire(&install_root, Duration::from_secs(10))?;
    let lease = verified_live_lease(&install_root)?.ok_or("no live active app lease")?;
    if lease.lease_id != expected_lease_id {
        return Err("active app lease id does not match".into());
    }
    bind_inbox_to_lease(&install_root, &lease)?;
    Ok((install_root, lease, _session_lock))
}

pub fn enqueue_launch_request(args: &Args) -> Result<Value> {
    let (install_root, lease, _session_lock) = active_lease(args)?;
    let mut bytes = Vec::new();
    std::io::stdin()
        .take(MAX_STDIN_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_STDIN_BYTES {
        return Err("launch request stdin exceeds 64 KiB".into());
    }
    let input: LaunchRequestInput = serde_json::from_slice(&bytes)?;
    let request = enqueue_request(&install_root, &lease, input)?;
    Ok(json!({
        "schemaVersion": 1,
        "state": "enqueued",
        "request": launch_request_result_value(&request),
    }))
}

pub fn claim_launch_requests(args: &Args) -> Result<Value> {
    let (install_root, lease, _session_lock) = active_lease(args)?;
    let limit = usize_arg(args, "--limit")?.unwrap_or(64);
    let requests = claim_requests(&install_root, &lease, limit)?;
    let requests = requests
        .iter()
        .map(launch_request_result_value)
        .collect::<Vec<_>>();
    Ok(json!({
        "schemaVersion": 1,
        "state": "claimed",
        "requests": requests,
    }))
}

pub fn ack_launch_request(args: &Args) -> Result<Value> {
    let (install_root, lease, _session_lock) = active_lease(args)?;
    let request_id = required_arg(args, "--request-id")?;
    let state = ack_request(&install_root, &lease, &request_id)?;
    Ok(json!({
        "schemaVersion": 1,
        "state": state,
        "requestId": request_id,
    }))
}
