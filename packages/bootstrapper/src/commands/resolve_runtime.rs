use crate::{
    cli::args::{Args, required_arg, required_state_root},
    core::{
        active_app::verified_live_lease,
        error::Result,
        install_state::{acknowledge_runtime, resolve_active_runtime},
    },
};
use serde_json::{Value, json};
use std::path::PathBuf;

fn require_active_lease(state_root: &PathBuf, lease_id: &str) -> Result<()> {
    let lease = verified_live_lease(state_root)?.ok_or("active app lease is missing")?;
    if lease.lease_id != lease_id {
        return Err("active app lease mismatch".into());
    }
    Ok(())
}

pub fn resolve_runtime(args: &Args) -> Result<Value> {
    let state_root = PathBuf::from(required_state_root(args)?);
    let lease_id = required_arg(args, "--active-lease-id")?;
    require_active_lease(&state_root, &lease_id)?;
    Ok(serde_json::to_value(resolve_active_runtime(
        &state_root,
        &lease_id,
    )?)?)
}

pub fn acknowledge_runtime_command(args: &Args) -> Result<Value> {
    let state_root = PathBuf::from(required_state_root(args)?);
    let lease_id = required_arg(args, "--active-lease-id")?;
    let generation = required_arg(args, "--generation")?
        .parse::<u64>()
        .map_err(|_| "--generation must be a positive integer")?;
    require_active_lease(&state_root, &lease_id)?;
    let state = acknowledge_runtime(&state_root, &lease_id, generation)?;
    Ok(json!({
        "schemaVersion": 2,
        "state": "confirmed",
        "generation": state.generation,
    }))
}
