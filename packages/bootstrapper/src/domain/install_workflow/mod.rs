pub mod events;

use crate::{
    core::{
        error::Result,
        layout::{Layout, resolve_layout},
    },
    domain::{
        artifacts::{ArtifactKey, StagingResult, stage_artifacts},
        install_plan::{InstallPlan, create_install_plan},
        install_workflow::events::{InstallProgressReporter, InstallWorkflowEvent},
        manifest::{
            GitHubManifestFallback, BootstrapperDistArtifacts, decide_update, load_manifest,
            resolve_manifest_source,
        },
        transactions::{apply_transaction_file, prepare_transaction_file, rollback_transaction_file},
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
    pub github_fallback: Option<GitHubManifestFallback>,
    pub manifest_url: String,
    pub retain_app_versions: usize,
    pub staging_root: PathBuf,
}

struct InstallStageResult {
    applied: Value,
    plan_file: PathBuf,
    prepared: Value,
    staging: StagingResult,
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
        "retainAppVersions": options.retain_app_versions,
        "reason": reason.into(),
        "details": details
    })
}

fn first_run_module_artifact_keys(artifacts: &BootstrapperDistArtifacts) -> Vec<ArtifactKey> {
    artifacts.modules.keys().cloned().map(ArtifactKey::Module).collect()
}

fn rollback_applied_stage(stage: &InstallStageResult) -> Value {
    match transaction_file_from_prepare_result(&stage.prepared)
        .and_then(|transaction_file| rollback_transaction_file(&transaction_file))
    {
        Ok(value) => value,
        Err(error) => json!({
            "state": "failed",
            "error": error.to_string()
        }),
    }
}

fn run_install_stage(
    options: &InstallWorkflowOptions,
    decision: &crate::domain::manifest::BootstrapperUpdateDecision,
    artifact_keys: Vec<ArtifactKey>,
    reporter: &dyn InstallProgressReporter,
    stage_label: &str,
) -> Result<std::result::Result<InstallStageResult, Value>> {
    reporter.emit(InstallWorkflowEvent::stage(
        "downloading",
        format!("Downloading {stage_label} artifacts"),
    ));
    let staging_result = stage_artifacts(decision, &options.staging_root, artifact_keys.clone(), reporter)?;

    reporter.emit(InstallWorkflowEvent::stage(
        "planning",
        format!("Creating {stage_label} install plan"),
    ));
    fs::create_dir_all(&options.install_root)?;
    let plan = create_install_plan(
        decision,
        &options.install_root,
        &options.staging_root,
        None,
        artifact_keys,
        options.retain_app_versions,
    )?;
    if !plan.executable {
        return Ok(Err(blocked_result(
            options,
            format!("{stage_label} install plan is not executable"),
            json!({
                "stage": stage_label,
                "staging": staging_result,
                "plan": plan
            }),
        )));
    }

    let plan_file = write_install_plan(&plan)?;
    reporter.emit(InstallWorkflowEvent::stage(
        "preparing",
        format!("Preparing {stage_label} install transaction"),
    ));
    let prepared = prepare_transaction_file(&plan_file, None)?;
    if prepared.get("state").and_then(Value::as_str) != Some("prepared") {
        return Ok(Err(blocked_result(
            options,
            format!("{stage_label} install transaction did not prepare cleanly"),
            json!({
                "stage": stage_label,
                "staging": staging_result,
                "planFile": plan_file,
                "prepareResult": prepared
            }),
        )));
    }

    let transaction_file = transaction_file_from_prepare_result(&prepared)?;
    reporter.emit(InstallWorkflowEvent::stage(
        "applying",
        format!("Applying {stage_label} install transaction"),
    ));
    let applied = apply_transaction_file(&transaction_file)?;
    if applied.get("state").and_then(Value::as_str) != Some("applied") {
        return Ok(Err(blocked_result(
            options,
            format!("{stage_label} install transaction did not apply cleanly"),
            json!({
                "stage": stage_label,
                "staging": staging_result,
                "planFile": plan_file,
                "prepareResult": prepared,
                "applyResult": applied
            }),
        )));
    }

    Ok(Ok(InstallStageResult {
        applied,
        plan_file,
        prepared,
        staging: staging_result,
    }))
}

fn ensure_modules_installed(
    layout: &Layout,
    artifacts: Option<&BootstrapperDistArtifacts>,
) -> Result<Vec<PathBuf>> {
    let mut module_paths = Vec::new();
    let Some(artifacts) = artifacts else {
        return Ok(module_paths);
    };

    for module_name in artifacts.modules.keys() {
        let module_path = layout.modules_dir.join(module_name);
        if !module_path.is_dir() {
            return Err(format!(
                "native module was not installed before launch: {}",
                module_path.display()
            )
            .into());
        }
        module_paths.push(module_path);
    }

    Ok(module_paths)
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
            "installedVersion": options.installed_version,
            "retainAppVersions": options.retain_app_versions
        }));
    }

    reporter.emit(InstallWorkflowEvent::stage(
        "checking",
        "Loading desktop update manifest",
    ));
    let manifest_url = resolve_manifest_source(&options.manifest_url, options.github_fallback.as_ref())?;
    let manifest = load_manifest(&manifest_url)?;
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

    let app_stage = match run_install_stage(options, &decision, vec![ArtifactKey::App], reporter, "application")? {
        Ok(stage) => stage,
        Err(blocked) => {
            reporter.emit(InstallWorkflowEvent::stage("blocked", "Application install stage is blocked"));
            return Ok(blocked);
        }
    };

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
                "appStage": {
                    "staging": app_stage.staging,
                    "planFile": app_stage.plan_file,
                    "prepareResult": app_stage.prepared,
                    "applyResult": app_stage.applied
                }
            }),
        ));
    }

    let module_keys = decision
        .artifacts
        .as_ref()
        .map(first_run_module_artifact_keys)
        .unwrap_or_default();
    let modules_stage = if module_keys.is_empty() {
        None
    } else {
        match run_install_stage(options, &decision, module_keys, reporter, "native modules")? {
            Ok(stage) => Some(stage),
            Err(blocked) => {
                let rollback_result = rollback_applied_stage(&app_stage);
                reporter.emit(InstallWorkflowEvent::stage("blocked", "Native modules install stage is blocked"));
                return Ok(blocked_result(
                    options,
                    "Native modules install stage is blocked",
                    json!({
                        "modulesStage": blocked,
                        "appRollback": rollback_result
                    }),
                ));
            }
        }
    };

    let installed_layout = resolve_layout(
        options.install_root.clone(),
        Some(options.layout.app_executable_name.clone()),
    )?;
    let installed_modules = match ensure_modules_installed(&installed_layout, decision.artifacts.as_ref()) {
        Ok(paths) => paths,
        Err(error) => {
            let rollback_result = rollback_applied_stage(&app_stage);
            reporter.emit(InstallWorkflowEvent::stage("blocked", "Native modules are missing after install"));
            return Ok(blocked_result(
                options,
                "Native modules are missing after install",
                json!({
                    "error": error.to_string(),
                    "appRollback": rollback_result
                }),
            ));
        }
    };

    reporter.emit(InstallWorkflowEvent::stage(
        "installed",
        "Application installed",
    ));
    Ok(json!({
        "state": "installed",
        "installed": true,
        "reused": false,
        "appExecutable": installed_layout.app_executable,
        "installedModules": installed_modules,
        "installRoot": options.install_root,
        "manifestUrl": manifest_url,
        "configuredManifestUrl": options.manifest_url,
        "dist": options.dist,
        "installedVersion": options.installed_version,
        "retainAppVersions": options.retain_app_versions,
        "staging": app_stage.staging.clone(),
        "planFile": app_stage.plan_file.clone(),
        "prepareResult": app_stage.prepared.clone(),
        "applyResult": app_stage.applied.clone(),
        "appStage": {
            "staging": app_stage.staging,
            "planFile": app_stage.plan_file,
            "prepareResult": app_stage.prepared,
            "applyResult": app_stage.applied
        },
        "modulesStage": modules_stage.map(|stage| json!({
            "staging": stage.staging,
            "planFile": stage.plan_file,
            "prepareResult": stage.prepared,
            "applyResult": stage.applied
        }))
    }))
}

pub fn default_staging_root(layout: &Layout) -> PathBuf {
    layout.updates_dir.join("staging")
}
