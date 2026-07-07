use crate::{
    cli::args::{Args, arg_value, required_arg},
    core::error::Result,
    domain::{
        artifacts::{ArtifactKey, default_artifact_keys, stage_artifacts},
        manifest::{BootstrapperUpdateDecision, decide_update, load_manifest},
    },
};
use serde_json::{Value, to_value};
use std::path::PathBuf;

fn artifact_keys(args: &Args, decision: &BootstrapperUpdateDecision) -> Result<Vec<ArtifactKey>> {
    if let Some(key) = arg_value(args, "--artifact") {
        return Ok(vec![ArtifactKey::from_str(&key)?]);
    }
    Ok(default_artifact_keys(decision.artifacts.as_ref()))
}

pub fn download_artifacts(args: &Args) -> Result<Value> {
    let manifest = load_manifest(&required_arg(args, "--manifest-url")?)?;
    let dist = required_arg(args, "--dist")?;
    let installed_version = required_arg(args, "--installed-version")?;
    let staging_dir = PathBuf::from(required_arg(args, "--staging-dir")?);
    let decision = decide_update(&manifest, &installed_version, &dist);
    let artifact_keys = artifact_keys(args, &decision)?;
    Ok(to_value(stage_artifacts(
        &decision,
        &staging_dir,
        artifact_keys,
    )?)?)
}
