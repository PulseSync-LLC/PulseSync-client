use crate::{
    core::{
        error::Result,
        fs_ops::{ensure_executable, sha256_file},
        layout::is_inside,
        path_segment::sanitize_path_segment,
    },
    domain::{
        artifacts::ArtifactKey,
        install_plan::{
            InstallPlan, InstallPlanArtifact, InstallPlanCheck,
            checks::{block, pass},
        },
        transactions::store::write_transaction,
    },
};
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Serialize)]
struct PreparedArtifact {
    pub action: String,
    #[serde(rename = "backupPath")]
    pub backup_path: PathBuf,
    pub key: ArtifactKey,
    #[serde(rename = "preparedKind")]
    pub prepared_kind: String,
    #[serde(rename = "preparedPath")]
    pub prepared_path: PathBuf,
    pub sha256: String,
    pub size: u64,
    #[serde(rename = "sourcePath")]
    pub source_path: PathBuf,
    #[serde(rename = "targetPath")]
    pub target_path: PathBuf,
}

fn load_plan(plan_file: &Path) -> Result<InstallPlan> {
    Ok(serde_json::from_slice(&fs::read(plan_file)?)?)
}

fn create_transaction_id() -> Result<String> {
    let millis = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
    Ok(format!("{millis:x}-{:x}", std::process::id()))
}

fn resolve_staging_root(plan: &InstallPlan) -> PathBuf {
    plan.staging_dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| plan.staging_dir.clone())
}

fn resolve_default_transaction_dir(plan: &InstallPlan, transaction_id: &str) -> Result<PathBuf> {
    Ok(resolve_staging_root(plan)
        .join("transactions")
        .join(sanitize_path_segment(&plan.channel)?)
        .join(sanitize_path_segment(&plan.target_version)?)
        .join(sanitize_path_segment(&plan.dist)?)
        .join(transaction_id))
}

fn verify_source_artifact(artifact: &InstallPlanArtifact) -> InstallPlanCheck {
    match fs::metadata(&artifact.source_path) {
        Ok(metadata) if !metadata.is_file() => block(
            &format!("source-{}", artifact.key.as_str()),
            format!("{} source path is not a file", artifact.key.as_str()),
            Some(artifact.source_path.clone()),
        ),
        Ok(metadata) if metadata.len() != artifact.size => block(
            &format!("source-{}", artifact.key.as_str()),
            format!(
                "{} source size mismatch: expected {}, got {}",
                artifact.key.as_str(),
                artifact.size,
                metadata.len()
            ),
            Some(artifact.source_path.clone()),
        ),
        Ok(_) => match sha256_file(&artifact.source_path) {
            Ok(sha256) if sha256.to_lowercase() == artifact.sha256.to_lowercase() => pass(
                &format!("source-{}", artifact.key.as_str()),
                format!(
                    "{} source artifact exists and matches plan",
                    artifact.key.as_str()
                ),
                Some(artifact.source_path.clone()),
            ),
            Ok(sha256) => block(
                &format!("source-{}", artifact.key.as_str()),
                format!(
                    "{} source sha256 mismatch: expected {}, got {sha256}",
                    artifact.key.as_str(),
                    artifact.sha256
                ),
                Some(artifact.source_path.clone()),
            ),
            Err(error) => block(
                &format!("source-{}", artifact.key.as_str()),
                format!(
                    "{} source artifact is missing or invalid: {error}",
                    artifact.key.as_str()
                ),
                Some(artifact.source_path.clone()),
            ),
        },
        Err(error) => block(
            &format!("source-{}", artifact.key.as_str()),
            format!(
                "{} source artifact is missing or invalid: {error}",
                artifact.key.as_str()
            ),
            Some(artifact.source_path.clone()),
        ),
    }
}

fn copy_prepared_artifact(
    artifact: &InstallPlanArtifact,
    prepared_dir: &Path,
) -> Result<PreparedArtifact> {
    let prepared_kind = if matches!(artifact.key, ArtifactKey::App | ArtifactKey::Module(_)) {
        "archive"
    } else {
        "file"
    };
    let prepared_path = prepared_dir.join(match &artifact.key {
        ArtifactKey::App => "app.zip".to_string(),
        ArtifactKey::Module(module_name) => {
            format!("module-{}.zip", sanitize_path_segment(module_name)?)
        }
        ArtifactKey::Bootstrapper => artifact
            .source_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("bootstrapper.artifact")
            .to_string(),
    });
    fs::copy(&artifact.source_path, &prepared_path)?;
    if matches!(artifact.key, ArtifactKey::Bootstrapper) {
        ensure_executable(&prepared_path)?;
    }

    Ok(PreparedArtifact {
        action: artifact.action.clone(),
        backup_path: artifact.backup_path.clone(),
        key: artifact.key.clone(),
        prepared_kind: prepared_kind.to_string(),
        prepared_path,
        sha256: artifact.sha256.clone(),
        size: artifact.size,
        source_path: artifact.source_path.clone(),
        target_path: artifact.target_path.clone(),
    })
}

fn blocked_result(
    plan_file: &Path,
    checks: Vec<InstallPlanCheck>,
    partial: Option<&InstallPlan>,
) -> Value {
    json!({
        "schemaVersion": 1,
        "transactionId": "",
        "state": "blocked",
        "prepared": false,
        "channel": partial.map(|plan| plan.channel.clone()).unwrap_or_default(),
        "dist": partial.map(|plan| plan.dist.clone()).unwrap_or_default(),
        "currentVersion": partial.map(|plan| plan.current_version.clone()).unwrap_or_default(),
        "targetVersion": partial.map(|plan| plan.target_version.clone()).unwrap_or_default(),
        "installDir": partial.map(|plan| plan.install_dir.clone()).unwrap_or_default(),
        "retainAppVersions": partial.map(|plan| plan.retain_app_versions).unwrap_or_default(),
        "stagingDir": partial.map(|plan| plan.staging_dir.clone()).unwrap_or_default(),
        "backupDir": partial.map(|plan| plan.backup_dir.clone()).unwrap_or_default(),
        "transactionDir": "",
        "planFile": plan_file,
        "artifacts": [],
        "checks": checks
    })
}

pub fn prepare_transaction_file(
    plan_file: &Path,
    transaction_dir: Option<PathBuf>,
) -> Result<Value> {
    let plan_file = plan_file
        .canonicalize()
        .unwrap_or_else(|_| plan_file.to_path_buf());
    let plan = match load_plan(&plan_file) {
        Ok(plan) => plan,
        Err(error) => {
            return Ok(blocked_result(
                &plan_file,
                vec![block(
                    "plan-load",
                    format!("Install plan cannot be loaded: {error}"),
                    Some(plan_file.clone()),
                )],
                None,
            ));
        }
    };

    let transaction_id = create_transaction_id()?;
    let staging_root = resolve_staging_root(&plan);
    let transaction_dir =
        transaction_dir.unwrap_or(resolve_default_transaction_dir(&plan, &transaction_id)?);
    let prepared_dir = transaction_dir.join("prepared");
    let transaction_path = transaction_dir.join("transaction.json");
    let mut checks = Vec::new();

    checks.push(if plan.executable {
        pass("plan-executable", "Install plan is executable", None)
    } else {
        block("plan-executable", "Install plan is not executable", None)
    });

    checks.push(if plan.update_available {
        pass(
            "plan-update-available",
            "Install plan targets an available update",
            None,
        )
    } else {
        block(
            "plan-update-available",
            "Install plan does not target an available update",
            None,
        )
    });

    checks.push(if is_inside(&staging_root, &transaction_dir) {
        pass(
            "transaction-dir-contained",
            "Transaction directory stays inside staging root",
            Some(transaction_dir.clone()),
        )
    } else {
        block(
            "transaction-dir-contained",
            "Transaction directory must stay inside staging root",
            Some(transaction_dir.clone()),
        )
    });

    checks.push(if is_inside(&staging_root, &plan.backup_dir) {
        pass(
            "backup-dir-contained",
            "Backup directory is under staging root",
            Some(plan.backup_dir.clone()),
        )
    } else {
        block(
            "backup-dir-contained",
            "Backup directory must be under staging root",
            Some(plan.backup_dir.clone()),
        )
    });

    checks.push(if plan.artifacts.iter().any(|artifact| {
        matches!(
            artifact.key,
            ArtifactKey::App | ArtifactKey::Module(_) | ArtifactKey::Bootstrapper
        )
    }) {
        pass(
            "plan-artifacts",
            "Install plan includes at least one installable artifact",
            None,
        )
    } else {
        block(
            "plan-artifacts",
            "Install plan is missing installable artifacts",
            None,
        )
    });

    for artifact in &plan.artifacts {
        checks.push(verify_source_artifact(artifact));
    }

    if checks.iter().any(|check| check.status == "block") {
        return Ok(blocked_result(&plan_file, checks, Some(&plan)));
    }

    fs::create_dir_all(&prepared_dir)?;
    fs::create_dir_all(&plan.backup_dir)?;

    let mut artifacts = Vec::new();
    for artifact in &plan.artifacts {
        artifacts.push(copy_prepared_artifact(artifact, &prepared_dir)?);
    }

    let result = json!({
        "schemaVersion": 1,
        "transactionId": transaction_id,
        "state": "prepared",
        "prepared": true,
        "channel": plan.channel,
        "dist": plan.dist,
        "currentVersion": plan.current_version,
        "targetVersion": plan.target_version,
        "installDir": plan.install_dir,
        "retainAppVersions": plan.retain_app_versions,
        "stagingDir": plan.staging_dir,
        "backupDir": plan.backup_dir,
        "transactionDir": transaction_dir,
        "planFile": plan_file,
        "artifacts": artifacts,
        "checks": checks
    });

    write_transaction(&transaction_path, &result)?;
    Ok(result)
}
