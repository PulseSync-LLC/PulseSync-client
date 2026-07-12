pub(crate) mod checks;
mod model;
mod paths;

pub use model::{InstallPlan, InstallPlanArtifact, InstallPlanCheck};

use crate::{
    core::{
        error::Result,
        fs_ops::{file_size, sha256_file},
        layout::{is_inside, normalize_retain_app_versions},
    },
    domain::{
        artifacts::{ArtifactKey, StagedArtifact},
        install_plan::{
            checks::{block, check_install_dir, pass},
            paths::{action, backup_path, default_backup_dir, staging_dir, target_path},
        },
        manifest::{BootstrapperUpdateDecision, UpdatePlanAction},
    },
};
use std::path::{Path, PathBuf};

fn artifact_plan_entry(
    staged: &StagedArtifact,
    required: bool,
    install_dir: &Path,
    target_version: &str,
    staging_dir: &Path,
    backup_dir: &Path,
) -> Result<(Option<InstallPlanArtifact>, Vec<InstallPlanCheck>)> {
    let key = staged.key.clone();
    let source_path = staged.path.clone();
    let artifact_file_name = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("staged artifact file name is invalid")?;
    let target_path = target_path(install_dir, target_version, &key, artifact_file_name)?;
    let backup_path = backup_path(backup_dir, &key, artifact_file_name);
    let mut preflight = Vec::new();

    preflight.push(if is_inside(staging_dir, &source_path) {
        pass(
            &format!("staged-{}-path", key.as_str()),
            format!(
                "{} staged path stays inside staging directory",
                key.as_str()
            ),
            Some(source_path.clone()),
        )
    } else {
        block(
            &format!("staged-{}-path", key.as_str()),
            format!("{} staged path escapes staging directory", key.as_str()),
            Some(source_path.clone()),
        )
    });

    preflight.push(if is_inside(install_dir, &target_path) {
        pass(
            &format!("target-{}-path", key.as_str()),
            format!(
                "{} target path stays inside install directory",
                key.as_str()
            ),
            Some(target_path.clone()),
        )
    } else {
        block(
            &format!("target-{}-path", key.as_str()),
            format!("{} target path escapes install directory", key.as_str()),
            Some(target_path.clone()),
        )
    });

    preflight.push(if is_inside(backup_dir, &backup_path) {
        pass(
            &format!("backup-{}-path", key.as_str()),
            format!("{} backup path stays inside backup directory", key.as_str()),
            Some(backup_path.clone()),
        )
    } else {
        block(
            &format!("backup-{}-path", key.as_str()),
            format!("{} backup path escapes backup directory", key.as_str()),
            Some(backup_path.clone()),
        )
    });

    let verification = (|| -> Result<(String, u64)> {
        let size = file_size(&source_path)?;
        if size != staged.size {
            return Err(
                format!("staged size mismatch: expected {}, got {size}", staged.size).into(),
            );
        }
        let sha256 = sha256_file(&source_path)?;
        if !sha256.eq_ignore_ascii_case(&staged.sha256) {
            return Err(format!(
                "staged sha256 mismatch: expected {}, got {sha256}",
                staged.sha256
            )
            .into());
        }
        Ok((sha256, size))
    })();
    match verification {
        Ok((sha256, size)) => {
            preflight.push(pass(
                &format!("staged-{}-artifact", key.as_str()),
                format!(
                    "{} staged artifact exists and matches manifest hash",
                    key.as_str()
                ),
                Some(source_path.clone()),
            ));
            Ok((
                Some(InstallPlanArtifact {
                    action: action(&key).to_string(),
                    backup_path,
                    key: key.clone(),
                    required,
                    file_operations: staged.file_operations.clone(),
                    sha256,
                    size,
                    source_path,
                    target_path,
                }),
                preflight,
            ))
        }
        Err(error) => {
            preflight.push(block(
                &format!("staged-{}-artifact", key.as_str()),
                format!(
                    "{} staged artifact is missing or invalid: {error}",
                    key.as_str()
                ),
                Some(source_path),
            ));
            Ok((None, preflight))
        }
    }
}

pub fn create_install_plan(
    decision: &BootstrapperUpdateDecision,
    install_dir: &Path,
    staging_root: &Path,
    backup_dir: Option<PathBuf>,
    staged_artifacts: Vec<StagedArtifact>,
    retain_app_versions: usize,
) -> Result<InstallPlan> {
    let install_dir = install_dir
        .canonicalize()
        .unwrap_or_else(|_| install_dir.to_path_buf());
    let staging_root = staging_root
        .canonicalize()
        .unwrap_or_else(|_| staging_root.to_path_buf());
    let staging_dir = staging_dir(decision, &staging_root)?;
    let backup_dir = backup_dir.unwrap_or(default_backup_dir(decision, &staging_root)?);
    let mut preflight = Vec::new();
    let mut artifacts = Vec::new();

    preflight.push(if decision.update_available {
        pass("update-available", "Update is available", None)
    } else {
        block(
            "update-available",
            format!("Update is not available: {}", decision.reason),
            None,
        )
    });

    preflight.push(if decision.artifacts.is_some() {
        pass(
            "manifest-dist-artifacts",
            "Manifest includes artifacts for this dist",
            None,
        )
    } else {
        block(
            "manifest-dist-artifacts",
            format!("Manifest does not include artifacts for {}", decision.dist),
            None,
        )
    });

    preflight.push(check_install_dir(&install_dir));

    if decision.artifacts.is_some() {
        for staged in staged_artifacts {
            let key = &staged.key;
            let artifact_version = match key {
                ArtifactKey::Host => decision.host_version.as_str(),
                ArtifactKey::Bootstrapper => decision
                    .bootstrapper_version
                    .as_deref()
                    .unwrap_or(&decision.target_version),
                ArtifactKey::Module(name) => decision
                    .component_versions
                    .get(name)
                    .map(String::as_str)
                    .unwrap_or(&decision.target_version),
            };
            let required = decision
                .plan
                .iter()
                .find(|item| item.key == key.as_str())
                .map(|item| item.required)
                .unwrap_or(true);
            let (artifact, checks) = artifact_plan_entry(
                &staged,
                required,
                &install_dir,
                artifact_version,
                &staging_dir,
                &backup_dir,
            )?;
            preflight.extend(checks);
            if let Some(artifact) = artifact {
                artifacts.push(artifact);
            }
        }
    }
    let omitted_components = decision
        .plan
        .iter()
        .filter(|item| {
            matches!(item.action, UpdatePlanAction::Remove)
                || (matches!(item.action, UpdatePlanAction::Blocked) && !item.required)
        })
        .filter_map(|item| item.key.strip_prefix("module:").map(str::to_string))
        .collect::<Vec<_>>();

    Ok(InstallPlan {
        executable: preflight.iter().all(|entry| entry.status == "pass")
            && (!artifacts.is_empty() || !omitted_components.is_empty()),
        artifacts,
        backup_dir,
        channel: decision.channel.clone(),
        current_version: decision.current_version.clone(),
        dist: decision.dist.clone(),
        install_dir,
        preflight,
        retain_app_versions: normalize_retain_app_versions(retain_app_versions),
        staging_dir,
        target_version: decision.target_version.clone(),
        bundle_version: decision.bundle_version.clone(),
        update_available: decision.update_available,
        host_version: decision.host_version.clone(),
        bootstrapper_version: decision.bootstrapper_version.clone(),
        component_versions: decision.component_versions.clone(),
        metadata_version: decision.metadata_version,
        host_electron_abi: decision.host_electron_abi.clone(),
        host_content_sha256: decision
            .artifacts
            .as_ref()
            .and_then(|artifacts| artifacts.host_files.as_ref())
            .map(|files| files.content_sha256.clone()),
        component_electron_abis: decision.component_electron_abis.clone(),
        component_content_sha256s: decision
            .artifacts
            .as_ref()
            .map(|artifacts| {
                artifacts
                    .module_files
                    .iter()
                    .map(|(name, files)| (name.clone(), files.content_sha256.clone()))
                    .collect()
            })
            .unwrap_or_default(),
        omitted_components,
    })
}
