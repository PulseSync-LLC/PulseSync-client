use crate::{
    cli::args::{Args, arg_value, required_arg, required_state_root},
    core::{
        active_app::verified_live_lease,
        error::Result,
        install_state::{
            acknowledge_runtime_with_host, resolve_active_runtime,
            resolve_active_runtime_with_host, rollback_active_runtime_with_host,
        },
        packaged_runtime::ensure_macos_hybrid_state,
    },
    domain::update_workflow::cleanup_terminal_update_workspaces,
};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

fn require_active_lease(state_root: &Path, lease_id: &str) -> Result<()> {
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
    let runtime = if let Some(host_bundle) = arg_value(args, "--host-bundle") {
        let host_bundle = PathBuf::from(host_bundle);
        ensure_macos_hybrid_state(&state_root, &host_bundle)?;
        resolve_active_runtime_with_host(&state_root, &lease_id, Some(&host_bundle))?
    } else {
        resolve_active_runtime(&state_root, &lease_id)?
    };
    Ok(serde_json::to_value(runtime)?)
}

pub fn acknowledge_runtime_command(args: &Args) -> Result<Value> {
    let state_root = PathBuf::from(required_state_root(args)?);
    let lease_id = required_arg(args, "--active-lease-id")?;
    let generation = required_arg(args, "--generation")?
        .parse::<u64>()
        .map_err(|_| "--generation must be a positive integer")?;
    require_active_lease(&state_root, &lease_id)?;
    let host_bundle = arg_value(args, "--host-bundle").map(PathBuf::from);
    let state =
        acknowledge_runtime_with_host(&state_root, &lease_id, generation, host_bundle.as_deref())?;
    if host_bundle.is_some() {
        let _ = crate::domain::macos_bundle::acknowledge_runtime_startup(&state_root)?;
    } else if let Err(error) = cleanup_terminal_update_workspaces(&state_root) {
        eprintln!("update cache cleanup deferred after runtime acknowledgement: {error}");
    }
    Ok(json!({
        "schemaVersion": 3,
        "state": "confirmed",
        "generation": state.generation,
    }))
}

pub fn rollback_runtime_command(args: &Args) -> Result<Value> {
    let state_root = PathBuf::from(required_state_root(args)?);
    let lease_id = required_arg(args, "--active-lease-id")?;
    require_active_lease(&state_root, &lease_id)?;
    let host_bundle = arg_value(args, "--host-bundle").map(PathBuf::from);
    Ok(serde_json::to_value(rollback_active_runtime_with_host(
        &state_root,
        &lease_id,
        host_bundle.as_deref(),
    )?)?)
}
