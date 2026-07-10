use crate::{
    cli::args::{Args, arg_value, required_arg, usize_arg},
    core::error::Result,
    domain::{
        install_workflow::events::{
            InstallProgressReporter, NoopInstallProgressReporter, StderrJsonInstallProgressReporter,
        },
        update_workflow::{
            PrepareUpdateOptions, RequestedManifestSource, UpdateWorkflowError,
            default_github_owner, default_github_repo, prepare_update, serialize_prepare_result,
        },
    },
};
use serde_json::Value;
use std::{path::PathBuf, str::FromStr};

fn input_error(error: impl std::fmt::Display) -> UpdateWorkflowError {
    UpdateWorkflowError::new(
        "prepare-update",
        "invalid-argument",
        "validate-input",
        error.to_string(),
        false,
        false,
    )
}

fn required_input(args: &Args, name: &str) -> Result<String> {
    required_arg(args, name).map_err(|error| input_error(error).into())
}

pub fn prepare_update_command(args: &Args) -> Result<Value> {
    let requested_source =
        RequestedManifestSource::from_str(&required_input(args, "--requested-source")?)
            .map_err(|error| input_error(format!("--requested-source: {error}")))?;
    let retain_app_versions = usize_arg(args, "--retain-app-versions")
        .map_err(input_error)?
        .ok_or_else(|| input_error("--retain-app-versions is required"))?;
    let options = PrepareUpdateOptions {
        install_root: PathBuf::from(required_input(args, "--install-root")?),
        app_executable_name: arg_value(args, "--app-executable-name"),
        installed_version: required_input(args, "--installed-version")?,
        dist: required_input(args, "--dist")?,
        channel: required_input(args, "--channel")?,
        requested_source,
        manifest_url: arg_value(args, "--manifest-url"),
        server_health_url: arg_value(args, "--server-health-url"),
        github_owner: arg_value(args, "--github-owner").unwrap_or_else(default_github_owner),
        github_repo: arg_value(args, "--github-repo").unwrap_or_else(default_github_repo),
        staging_dir: arg_value(args, "--staging-dir").map(PathBuf::from),
        retain_app_versions,
        active_lease_id: required_input(args, "--active-lease-id")?,
    };
    let stderr_reporter = StderrJsonInstallProgressReporter;
    let noop_reporter = NoopInstallProgressReporter;
    let reporter: &dyn InstallProgressReporter = if args.progress_json {
        &stderr_reporter
    } else {
        &noop_reporter
    };
    let result = prepare_update(options, reporter)?;
    let (stage, message) = match &result {
        crate::domain::update_workflow::PrepareUpdateResult::UpToDate { .. } => {
            ("up-to-date", "The installed client is up to date")
        }
        crate::domain::update_workflow::PrepareUpdateResult::Prepared { .. } => {
            ("prepared", "The update transaction is prepared")
        }
        crate::domain::update_workflow::PrepareUpdateResult::Blocked { .. } => {
            ("blocked", "Update preparation is blocked")
        }
    };
    reporter
        .emit(crate::domain::install_workflow::events::InstallWorkflowEvent::stage(stage, message));
    serialize_prepare_result(result)
}
