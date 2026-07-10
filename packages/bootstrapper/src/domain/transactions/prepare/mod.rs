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
};
use uuid::Uuid;

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

fn metadata_is_reparse(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        return metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    false
}

fn ensure_contained_directory(root: &Path, directory: &Path) -> Result<()> {
    let owner = root
        .parent()
        .ok_or("owned directory root has no parent")?
        .canonicalize()?;
    if !root.exists() {
        fs::create_dir(root)?;
    }
    let root_metadata = fs::symlink_metadata(root)?;
    if !root_metadata.is_dir() || metadata_is_reparse(&root_metadata) {
        return Err(format!(
            "owned directory root is a reparse point: {}",
            root.display()
        )
        .into());
    }
    let canonical_root = root.canonicalize()?;
    if !is_inside(&owner, &canonical_root) {
        return Err(format!(
            "owned directory root escapes its parent: {}",
            root.display()
        )
        .into());
    }
    let relative = directory
        .strip_prefix(root)
        .map_err(|_| format!("directory escapes owned root: {}", directory.display()))?;
    let mut current = canonical_root.clone();
    for component in relative.components() {
        let std::path::Component::Normal(component) = component else {
            return Err(format!("directory has unsafe component: {}", directory.display()).into());
        };
        let next = current.join(component);
        if !next.exists() {
            fs::create_dir(&next)?;
        }
        let metadata = fs::symlink_metadata(&next)?;
        if !metadata.is_dir() || metadata_is_reparse(&metadata) {
            return Err(format!("directory contains a reparse point: {}", next.display()).into());
        }
        let canonical = next.canonicalize()?;
        if !is_inside(&canonical_root, &canonical) {
            return Err(format!("directory escapes owned root: {}", next.display()).into());
        }
        current = canonical;
    }
    Ok(())
}

fn remove_owned_transaction(root: &Path, transaction_dir: &Path) {
    let safe = transaction_dir
        .canonicalize()
        .ok()
        .is_some_and(|path| is_inside(root, &path) && !paths_equal(root, &path));
    if safe {
        let _ = fs::remove_dir_all(transaction_dir);
    }
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    left.canonicalize().ok() == right.canonicalize().ok()
}

fn load_plan(plan_file: &Path) -> Result<InstallPlan> {
    Ok(serde_json::from_slice(&fs::read(plan_file)?)?)
}

fn create_transaction_id() -> String {
    Uuid::new_v4().to_string()
}

fn resolve_staging_root(plan: &InstallPlan) -> PathBuf {
    plan.staging_dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .unwrap_or_else(|| plan.staging_dir.clone())
}

fn resolve_default_transaction_root(plan: &InstallPlan) -> PathBuf {
    let staging_root = resolve_staging_root(plan);
    staging_root
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or(staging_root)
        .join("transactions")
}

fn resolve_default_transaction_dir(plan: &InstallPlan, transaction_id: &str) -> Result<PathBuf> {
    Ok(resolve_default_transaction_root(plan)
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

fn prepare_transaction_file_inner(
    plan_file: &Path,
    transaction_dir: Option<PathBuf>,
    transaction_root: Option<&Path>,
    transaction_id: Option<String>,
    apply_deferred_by_lease_id: Option<&str>,
    require_exact_transaction_dir: bool,
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

    let transaction_id = transaction_id.unwrap_or_else(create_transaction_id);
    if Uuid::parse_str(&transaction_id).is_err() {
        return Err(format!("transaction id must be a UUID: {transaction_id}").into());
    }
    let staging_root = resolve_staging_root(&plan);
    let default_transaction_root = resolve_default_transaction_root(&plan);
    let transaction_dir =
        transaction_dir.unwrap_or(resolve_default_transaction_dir(&plan, &transaction_id)?);
    let transaction_root = transaction_root.unwrap_or(&default_transaction_root);
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

    checks.push(if is_inside(transaction_root, &transaction_dir) {
        pass(
            "transaction-dir-contained",
            "Transaction directory stays inside transaction root",
            Some(transaction_dir.clone()),
        )
    } else {
        block(
            "transaction-dir-contained",
            "Transaction directory must stay inside transaction root",
            Some(transaction_dir.clone()),
        )
    });

    if require_exact_transaction_dir {
        checks.push(
            if transaction_dir.file_name().and_then(|value| value.to_str())
                == Some(transaction_id.as_str())
            {
                pass(
                    "transaction-id-path",
                    "Transaction directory name matches transaction id",
                    Some(transaction_dir.clone()),
                )
            } else {
                block(
                    "transaction-id-path",
                    "Transaction directory name must match transaction id",
                    Some(transaction_dir.clone()),
                )
            },
        );
    }

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

    checks.push(
        if plan.artifacts.iter().any(|artifact| {
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
        },
    );

    for artifact in &plan.artifacts {
        checks.push(verify_source_artifact(artifact));
    }

    if checks.iter().any(|check| check.status == "block") {
        return Ok(blocked_result(&plan_file, checks, Some(&plan)));
    }

    if transaction_dir.exists() {
        return Err(format!(
            "transaction directory already exists: {}",
            transaction_dir.display()
        )
        .into());
    }
    let transaction_parent = transaction_dir
        .parent()
        .ok_or("transaction directory has no parent")?;
    ensure_contained_directory(transaction_root, transaction_parent)?;
    ensure_contained_directory(transaction_root, &transaction_dir)?;
    ensure_contained_directory(transaction_root, &prepared_dir)?;
    ensure_contained_directory(&staging_root, &plan.backup_dir)?;

    let prepare_result = (|| -> Result<Value> {
        let mut artifacts = Vec::new();
        for artifact in &plan.artifacts {
            ensure_contained_directory(transaction_root, &prepared_dir)?;
            artifacts.push(copy_prepared_artifact(artifact, &prepared_dir)?);
        }

        let mut result = json!({
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
        if let Some(lease_id) = apply_deferred_by_lease_id {
            result["applyDeferredByLeaseId"] = json!(lease_id);
        }

        ensure_contained_directory(transaction_root, &transaction_dir)?;
        write_transaction(&transaction_path, &result)?;
        Ok(result)
    })();
    if prepare_result.is_err() {
        remove_owned_transaction(transaction_root, &transaction_dir);
    }
    prepare_result
}

pub fn prepare_transaction_file(
    plan_file: &Path,
    transaction_dir: Option<PathBuf>,
) -> Result<Value> {
    prepare_transaction_file_inner(plan_file, transaction_dir, None, None, None, false)
}

pub fn prepare_transaction_file_at(
    plan_file: &Path,
    transaction_root: &Path,
    transaction_dir: PathBuf,
    transaction_id: String,
    apply_deferred_by_lease_id: &str,
) -> Result<Value> {
    prepare_transaction_file_inner(
        plan_file,
        Some(transaction_dir),
        Some(transaction_root),
        Some(transaction_id),
        Some(apply_deferred_by_lease_id),
        true,
    )
}
