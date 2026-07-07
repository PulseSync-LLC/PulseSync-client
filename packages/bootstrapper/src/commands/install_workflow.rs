use crate::{
    cli::args::{Args, arg_value, required_arg},
    core::{error::Result, layout::resolve_layout},
    domain::install_workflow::{
        InstallWorkflowOptions, default_staging_root,
        events::{NoopInstallProgressReporter, StderrJsonInstallProgressReporter},
        run_install_workflow,
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
    Ok(InstallWorkflowOptions {
        dist: required_arg(args, "--dist")?,
        install_root,
        installed_version: required_arg(args, "--installed-version")?,
        manifest_url: required_arg(args, "--manifest-url")?,
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
