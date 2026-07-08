use crate::{
    cli::args::{Args, arg_value, required_arg, usize_arg},
    core::{
        error::Result,
        layout::{DEFAULT_RETAIN_APP_VERSIONS, normalize_retain_app_versions},
    },
    domain::{
        artifacts::ArtifactKey,
        install_plan::{create_install_plan, default_install_artifact_keys},
        manifest::{BootstrapperUpdateDecision, decide_update, load_manifest},
    },
};
use serde_json::{Value, to_value};
use std::path::PathBuf;

fn artifact_keys(args: &Args, decision: &BootstrapperUpdateDecision) -> Result<Vec<ArtifactKey>> {
    if let Some(key) = arg_value(args, "--artifact") {
        return Ok(vec![ArtifactKey::from_str(&key)?]);
    }
    Ok(default_install_artifact_keys(decision.artifacts.as_ref()))
}

pub fn plan_install(args: &Args) -> Result<Value> {
    let manifest = load_manifest(&required_arg(args, "--manifest-url")?)?;
    let dist = required_arg(args, "--dist")?;
    let installed_version = required_arg(args, "--installed-version")?;
    let install_dir = PathBuf::from(required_arg(args, "--install-dir")?);
    let staging_dir = PathBuf::from(required_arg(args, "--staging-dir")?);
    let backup_dir = arg_value(args, "--backup-dir").map(PathBuf::from);
    let decision = decide_update(&manifest, &installed_version, &dist);
    let artifact_keys = artifact_keys(args, &decision)?;

    Ok(to_value(create_install_plan(
        &decision,
        &install_dir,
        &staging_dir,
        backup_dir,
        artifact_keys,
        normalize_retain_app_versions(
            usize_arg(args, "--retain-app-versions")?.unwrap_or(DEFAULT_RETAIN_APP_VERSIONS),
        ),
    )?)?)
}
