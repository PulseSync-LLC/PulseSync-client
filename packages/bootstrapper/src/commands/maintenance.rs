use crate::{
    cli::args::{Args, arg_value, required_arg, required_state_root},
    core::{
        error::Result,
        install_state::{collect_runtime_garbage, pin_runtime_snapshot},
        layout::canonical_install_root,
    },
    domain::{
        manifest::{
            DEFAULT_GITHUB_OWNER, DEFAULT_GITHUB_REPO, GitHubManifestFallback, github_manifest_url,
            health_check_available,
        },
        repair::repair_install,
    },
};
use serde_json::{Value, json};
use std::path::PathBuf;

pub fn collect_garbage(args: &Args) -> Result<Value> {
    let state_root = canonical_install_root(&PathBuf::from(required_state_root(args)?))?;
    let removed = collect_runtime_garbage(&state_root)?;
    Ok(json!({
        "schemaVersion": 3,
        "state": "collected",
        "removed": removed,
    }))
}

pub fn repair(args: &Args) -> Result<Value> {
    let dist = required_arg(args, "--dist")?;
    let requested_source =
        arg_value(args, "--requested-source").unwrap_or_else(|| "backend".to_string());
    let manifest_url = match requested_source.as_str() {
        "direct" => required_arg(args, "--manifest-url")?,
        "github" => github_manifest_url(&GitHubManifestFallback {
            channel: required_arg(args, "--channel")?,
            dist: dist.clone(),
            owner: arg_value(args, "--github-owner")
                .unwrap_or_else(|| DEFAULT_GITHUB_OWNER.to_string()),
            repo: arg_value(args, "--github-repo")
                .unwrap_or_else(|| DEFAULT_GITHUB_REPO.to_string()),
            hybrid: dist.starts_with("darwin-"),
        })?,
        "backend" => {
            let backend = required_arg(args, "--manifest-url")?;
            let health_available = arg_value(args, "--server-health-url")
                .as_deref()
                .is_some_and(health_check_available);
            if health_available {
                backend
            } else {
                github_manifest_url(&GitHubManifestFallback {
                    channel: required_arg(args, "--channel")?,
                    dist: dist.clone(),
                    owner: arg_value(args, "--github-owner")
                        .unwrap_or_else(|| DEFAULT_GITHUB_OWNER.to_string()),
                    repo: arg_value(args, "--github-repo")
                        .unwrap_or_else(|| DEFAULT_GITHUB_REPO.to_string()),
                    hybrid: dist.starts_with("darwin-"),
                })?
            }
        }
        _ => return Err("--requested-source must be backend, github, or direct".into()),
    };
    repair_install(
        &PathBuf::from(required_state_root(args)?),
        &manifest_url,
        &dist,
    )
}

pub fn pin_runtime(args: &Args) -> Result<Value> {
    let requested = required_arg(args, "--bundle-version")?;
    let state = pin_runtime_snapshot(
        &PathBuf::from(required_state_root(args)?),
        (requested != "none").then_some(requested.as_str()),
    )?;
    Ok(json!({
        "schemaVersion": 3,
        "state": "pinned",
        "bundleVersion": state.pinned.map(|snapshot| snapshot.bundle_version),
    }))
}
