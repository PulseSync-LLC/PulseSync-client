use crate::{
    cli::args::{Args, arg_value, required_arg, usize_arg},
    core::{
        error::Result,
        layout::{DEFAULT_RETAIN_APP_VERSIONS, normalize_retain_app_versions, resolve_layout},
    },
    domain::{
        install_workflow::{
            InstallWorkflowOptions, default_staging_root,
            events::{NoopInstallProgressReporter, StderrJsonInstallProgressReporter},
            run_install_workflow,
        },
        manifest::GitHubManifestFallback,
    },
};
use serde_json::Value;
use std::path::PathBuf;

pub fn install_workflow_options_from_args(args: &Args) -> Result<InstallWorkflowOptions> {
    let install_root = PathBuf::from(required_arg(args, "--install-root")?);
    let layout = resolve_layout(
        install_root.clone(),
        arg_value(args, "--app-executable-name"),
    )?;
    let dist = required_arg(args, "--dist")?;
    let github_fallback = arg_value(args, "--server-health-url").map(|health_url| {
        let mut fallback = GitHubManifestFallback::new(
            arg_value(args, "--github-channel").unwrap_or_else(|| "beta".to_string()),
            dist.clone(),
            health_url,
        );
        if let Some(owner) = arg_value(args, "--github-owner") {
            fallback.owner = owner;
        }
        if let Some(repo) = arg_value(args, "--github-repo") {
            fallback.repo = repo;
        }
        fallback
    });

    Ok(InstallWorkflowOptions {
        dist,
        install_root,
        installed_version: required_arg(args, "--installed-version")?,
        github_fallback,
        manifest_url: required_arg(args, "--manifest-url")?,
        retain_app_versions: normalize_retain_app_versions(
            usize_arg(args, "--retain-app-versions")?.unwrap_or(DEFAULT_RETAIN_APP_VERSIONS),
        ),
        staging_root: arg_value(args, "--staging-dir")
            .map(PathBuf::from)
            .unwrap_or_else(|| default_staging_root(&layout)),
        layout,
    })
}

pub fn install_workflow(args: &Args) -> Result<Value> {
    let options = install_workflow_options_from_args(args)?;

    if args.progress_json {
        run_install_workflow(&options, &StderrJsonInstallProgressReporter)
    } else {
        run_install_workflow(&options, &NoopInstallProgressReporter)
    }
}
