use crate::{
    core::{error::Result, path_segment::sanitize_path_segment},
    domain::{artifacts::ArtifactKey, manifest::BootstrapperUpdateDecision},
};
use std::path::{Path, PathBuf};

pub(crate) fn staging_dir(
    decision: &BootstrapperUpdateDecision,
    staging_root: &Path,
) -> Result<PathBuf> {
    Ok(staging_root
        .join(sanitize_path_segment(&decision.channel)?)
        .join(sanitize_path_segment(&decision.target_version)?)
        .join(sanitize_path_segment(&decision.dist)?))
}

pub(crate) fn default_backup_dir(
    decision: &BootstrapperUpdateDecision,
    staging_root: &Path,
) -> Result<PathBuf> {
    Ok(staging_root
        .join("backups")
        .join(sanitize_path_segment(&decision.channel)?)
        .join(sanitize_path_segment(&decision.target_version)?)
        .join(sanitize_path_segment(&decision.dist)?))
}

fn bootstrapper_executable_name() -> &'static str {
    if cfg!(windows) {
        "pulsesync-bootstrapper.exe"
    } else {
        "pulsesync-bootstrapper"
    }
}

pub(crate) fn target_path(
    install_dir: &Path,
    key: &ArtifactKey,
    _artifact_file_name: &str,
) -> PathBuf {
    match key {
        ArtifactKey::App => install_dir.join("app"),
        ArtifactKey::Module(module_name) => install_dir.join("modules").join(module_name),
        ArtifactKey::Bootstrapper => install_dir
            .join("bootstrapper")
            .join(bootstrapper_executable_name()),
    }
}

pub(crate) fn backup_path(
    backup_dir: &Path,
    key: &ArtifactKey,
    _artifact_file_name: &str,
) -> PathBuf {
    match key {
        ArtifactKey::App => backup_dir.join("app"),
        ArtifactKey::Module(module_name) => backup_dir.join("modules").join(module_name),
        ArtifactKey::Bootstrapper => backup_dir
            .join("bootstrapper")
            .join(bootstrapper_executable_name()),
    }
}

pub(crate) fn action(key: &ArtifactKey) -> &'static str {
    match key {
        ArtifactKey::App | ArtifactKey::Module(_) => "replace-directory-archive",
        ArtifactKey::Bootstrapper => "replace-file",
    }
}

pub(crate) fn install_keys(keys: Vec<ArtifactKey>) -> Vec<ArtifactKey> {
    keys.into_iter()
        .filter(|key| {
            matches!(
                key,
                ArtifactKey::App | ArtifactKey::Module(_) | ArtifactKey::Bootstrapper
            )
        })
        .fold(Vec::new(), |mut selected, key| {
            if !selected.contains(&key) {
                selected.push(key);
            }
            selected
        })
}
