pub(crate) mod checks;
mod model;
mod paths;

pub use model::{InstallPlan, InstallPlanArtifact, InstallPlanCheck};

use crate::{
    core::{
        error::Result,
        layout::{is_inside, normalize_retain_app_versions},
    },
    domain::{
        artifacts::{ArtifactKey, artifact_file_name, default_artifact_keys, verify_artifact_file},
        install_plan::{
            checks::{block, check_install_dir, pass},
            paths::{
                action, backup_path, default_backup_dir, install_keys, staging_dir, target_path,
            },
        },
        manifest::{BootstrapperArtifact, BootstrapperUpdateDecision, artifact_for_key},
    },
};
use std::path::{Path, PathBuf};

fn artifact_plan_entry(
    artifact: &BootstrapperArtifact,
    key: ArtifactKey,
    install_dir: &Path,
    target_version: &str,
    staging_dir: &Path,
    backup_dir: &Path,
) -> Result<(Option<InstallPlanArtifact>, Vec<InstallPlanCheck>)> {
    let artifact_file_name = artifact_file_name(artifact, &key)?;
    let source_path = staging_dir.join(&artifact_file_name);
    let target_path = target_path(install_dir, target_version, &key, &artifact_file_name)?;
    let backup_path = backup_path(backup_dir, &key, &artifact_file_name);
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

    match verify_artifact_file(&source_path, artifact, &key) {
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
    artifact_keys: Vec<ArtifactKey>,
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

    if let Some(dist_artifacts) = &decision.artifacts {
        for key in install_keys(artifact_keys) {
            if let Some(artifact) = artifact_for_key(dist_artifacts, &key) {
                let (artifact, checks) = artifact_plan_entry(
                    artifact,
                    key,
                    &install_dir,
                    &decision.target_version,
                    &staging_dir,
                    &backup_dir,
                )?;
                preflight.extend(checks);
                if let Some(artifact) = artifact {
                    artifacts.push(artifact);
                }
            } else {
                preflight.push(block(
                    &format!("manifest-{}", key.as_str()),
                    format!("Manifest does not include {} artifact", key.as_str()),
                    None,
                ));
            }
        }
    }

    Ok(InstallPlan {
        executable: preflight.iter().all(|entry| entry.status == "pass") && !artifacts.is_empty(),
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
        update_available: decision.update_available,
    })
}

pub fn default_install_artifact_keys(
    artifacts: Option<&crate::domain::manifest::BootstrapperDistArtifacts>,
) -> Vec<ArtifactKey> {
    install_keys(default_artifact_keys(artifacts))
}
