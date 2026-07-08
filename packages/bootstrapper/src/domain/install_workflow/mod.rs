pub mod events;

use crate::{
    core::{
        error::Result,
        layout::{Layout, resolve_layout},
    },
    domain::{
        artifacts::{ArtifactKey, stage_artifacts},
        install_plan::{InstallPlan, create_install_plan},
        install_workflow::events::{InstallProgressReporter, InstallWorkflowEvent},
        manifest::{decide_update, load_manifest},
        transactions::{apply_transaction_file, prepare_transaction_file},
    },
};
use serde_json::{Value, json};
use std::{fs, path::PathBuf};

#[derive(Clone, Debug)]
pub struct InstallWorkflowOptions {
    pub dist: String,
    pub install_root: PathBuf,
    pub installed_version: String,
    pub layout: Layout,
    pub manifest_url: String,
    pub staging_root: PathBuf,
}

fn write_install_plan(plan: &InstallPlan) -> Result<PathBuf> {
    let plan_file = plan.staging_dir.join("install-plan.json");
    fs::create_dir_all(&plan.staging_dir)?;
    fs::write(
        &plan_file,
        format!("{}\n", serde_json::to_string_pretty(plan)?),
    )?;
    Ok(plan_file)
}

fn transaction_file_from_prepare_result(value: &Value) -> Result<PathBuf> {
    let transaction_dir = value
        .get("transactionDir")
        .and_then(Value::as_str)
        .ok_or("prepared transaction is missing transactionDir")?;
    Ok(PathBuf::from(transaction_dir).join("transaction.json"))
}

fn blocked_result(
    options: &InstallWorkflowOptions,
    reason: impl Into<String>,
    details: Value,
) -> Value {
    json!({
        "state": "blocked",
        "installed": false,
        "appExecutable": options.layout.app_executable,
        "installRoot": options.install_root,
        "manifestUrl": options.manifest_url,
        "dist": options.dist,
        "installedVersion": options.installed_version,
        "reason": reason.into(),
        "details": details
    })
}

fn first_run_artifact_keys(
    decision_artifacts: Option<&crate::domain::manifest::BootstrapperDistArtifacts>,
) -> Vec<ArtifactKey> {
    decision_artifacts
        .map(|artifacts| {
            let mut keys = vec![ArtifactKey::App];
            keys.extend(artifacts.modules.keys().cloned().map(ArtifactKey::Module));
            keys
        })
        .unwrap_or_else(|| vec![ArtifactKey::App])
}

pub fn run_install_workflow(
    options: &InstallWorkflowOptions,
    reporter: &dyn InstallProgressReporter,
) -> Result<Value> {
    if options.layout.app_executable.is_file() {
        reporter.emit(InstallWorkflowEvent::stage(
            "installed",
            "Application executable already exists",
        ));
        return Ok(json!({
            "state": "installed",
            "installed": true,
            "reused": true,
            "appExecutable": options.layout.app_executable,
            "installRoot": options.install_root,
            "manifestUrl": options.manifest_url,
            "dist": options.dist,
            "installedVersion": options.installed_version
        }));
    }

    reporter.emit(InstallWorkflowEvent::stage(
        "checking",
        "Loading desktop update manifest",
    ));
    let manifest = load_manifest(&options.manifest_url)?;
    let decision = decide_update(&manifest, &options.installed_version, &options.dist);
    if !decision.update_available {
        reporter.emit(InstallWorkflowEvent::stage(
            "blocked",
            format!(
                "No installable app payload is available: {}",
                decision.reason
            ),
        ));
        return Ok(blocked_result(
            options,
            format!(
                "No installable app payload is available: {}",
                decision.reason
            ),
            json!({ "decision": decision }),
        ));
    }

    let artifact_keys = first_run_artifact_keys(decision.artifacts.as_ref());
    reporter.emit(InstallWorkflowEvent::stage(
        "downloading",
        format!("Downloading {} install artifacts", artifact_keys.len()),
    ));
    let staging_result = stage_artifacts(&decision, &options.staging_root, artifact_keys.clone())?;
    let artifact_count = staging_result.artifacts.len();
    for (index, artifact) in staging_result.artifacts.iter().enumerate() {
        reporter.emit(InstallWorkflowEvent::artifact(
            "downloading",
            if artifact.reused {
                "Artifact already staged"
            } else {
                "Artifact downloaded"
            },
            artifact.key.as_str(),
            index + 1,
            artifact_count,
            Some(artifact.path.clone()),
        ));
    }

    reporter.emit(InstallWorkflowEvent::stage(
        "planning",
        "Creating install plan",
    ));
    fs::create_dir_all(&options.install_root)?;
    let plan = create_install_plan(
        &decision,
        &options.install_root,
        &options.staging_root,
        None,
        artifact_keys,
    )?;
    if !plan.executable {
        reporter.emit(InstallWorkflowEvent::stage(
            "blocked",
            "Install plan is not executable",
        ));
        return Ok(blocked_result(
            options,
            "Install plan is not executable",
            json!({
                "staging": staging_result,
                "plan": plan
            }),
        ));
    }

    let plan_file = write_install_plan(&plan)?;
    reporter.emit(InstallWorkflowEvent::stage(
        "preparing",
        "Preparing install transaction",
    ));
    let prepared = prepare_transaction_file(&plan_file, None)?;
    if prepared.get("state").and_then(Value::as_str) != Some("prepared") {
        reporter.emit(InstallWorkflowEvent::stage(
            "blocked",
            "Install transaction did not prepare cleanly",
        ));
        return Ok(blocked_result(
            options,
            "Install transaction did not prepare cleanly",
            json!({
                "staging": staging_result,
                "planFile": plan_file,
                "prepareResult": prepared
            }),
        ));
    }

    let transaction_file = transaction_file_from_prepare_result(&prepared)?;
    reporter.emit(InstallWorkflowEvent::stage(
        "applying",
        "Applying install transaction",
    ));
    let applied = apply_transaction_file(&transaction_file)?;
    if applied.get("state").and_then(Value::as_str) != Some("applied") {
        reporter.emit(InstallWorkflowEvent::stage(
            "blocked",
            "Install transaction did not apply cleanly",
        ));
        return Ok(blocked_result(
            options,
            "Install transaction did not apply cleanly",
            json!({
                "staging": staging_result,
                "planFile": plan_file,
                "prepareResult": prepared,
                "applyResult": applied
            }),
        ));
    }

    let installed_layout = resolve_layout(
        options.install_root.clone(),
        Some(options.layout.app_executable_name.clone()),
    )?;

    if !installed_layout.app_executable.is_file() {
        reporter.emit(InstallWorkflowEvent::stage(
            "blocked",
            "Install transaction applied but app executable is still missing",
        ));
        return Ok(blocked_result(
            options,
            "Install transaction applied but app executable is still missing",
            json!({
                "staging": staging_result,
                "planFile": plan_file,
                "prepareResult": prepared,
                "applyResult": applied
            }),
        ));
    }

    reporter.emit(InstallWorkflowEvent::stage(
        "installed",
        "Application installed",
    ));
    Ok(json!({
        "state": "installed",
        "installed": true,
        "reused": false,
        "appExecutable": installed_layout.app_executable,
        "installRoot": options.install_root,
        "manifestUrl": options.manifest_url,
        "dist": options.dist,
        "installedVersion": options.installed_version,
        "staging": staging_result,
        "planFile": plan_file,
        "prepareResult": prepared,
        "applyResult": applied
    }))
}

pub fn default_staging_root(layout: &Layout) -> PathBuf {
    layout.updates_dir.join("staging")
}
