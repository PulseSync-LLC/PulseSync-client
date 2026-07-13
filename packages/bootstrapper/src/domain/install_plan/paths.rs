use crate::{
    core::{error::Result, path_segment::sanitize_path_segment},
    domain::{
        artifacts::ArtifactKey,
        manifest::{ArtifactLayout, BootstrapperUpdateDecision},
    },
};
use std::path::{Path, PathBuf};

pub(crate) fn staging_dir(
    decision: &BootstrapperUpdateDecision,
    staging_root: &Path,
) -> Result<PathBuf> {
    Ok(staging_root
        .join(sanitize_path_segment(&decision.channel)?)
        .join(sanitize_path_segment(&decision.bundle_version)?)
        .join(sanitize_path_segment(&decision.dist)?))
}

pub(crate) fn default_backup_dir(
    decision: &BootstrapperUpdateDecision,
    staging_root: &Path,
) -> Result<PathBuf> {
    Ok(staging_root
        .join("backups")
        .join(sanitize_path_segment(&decision.channel)?)
        .join(sanitize_path_segment(&decision.bundle_version)?)
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
    layout: ArtifactLayout,
    host_version: &str,
    key: &ArtifactKey,
    component_revisions: &std::collections::BTreeMap<String, u64>,
    component_disk_names: &std::collections::BTreeMap<String, String>,
    _artifact_file_name: &str,
) -> Result<PathBuf> {
    match key {
        ArtifactKey::Host => {
            Ok(install_dir.join(format!("app-{}", sanitize_path_segment(host_version)?)))
        }
        ArtifactKey::Module(module_name) => {
            let revision = component_revisions
                .get(module_name)
                .ok_or_else(|| format!("component revision is missing: {module_name}"))?;
            let disk_name = component_disk_names
                .get(module_name)
                .ok_or_else(|| format!("component disk name is missing: {module_name}"))?;
            let disk_name = sanitize_path_segment(disk_name)?;
            let modules_root = if layout == ArtifactLayout::MacosHybrid {
                install_dir.join("components")
            } else {
                install_dir
                    .join(format!("app-{}", sanitize_path_segment(host_version)?))
                    .join("modules")
            };
            Ok(modules_root
                .join(format!("{}-{}", disk_name, revision))
                .join(disk_name))
        }
        ArtifactKey::Bootstrapper => Ok(install_dir
            .join("bootstrapper")
            .join(bootstrapper_executable_name())),
    }
}

pub(crate) fn backup_path(
    backup_dir: &Path,
    key: &ArtifactKey,
    _artifact_file_name: &str,
) -> PathBuf {
    match key {
        ArtifactKey::Host => backup_dir.join("host"),
        ArtifactKey::Module(module_name) => backup_dir.join("modules").join(module_name),
        ArtifactKey::Bootstrapper => backup_dir
            .join("bootstrapper")
            .join(bootstrapper_executable_name()),
    }
}

pub(crate) fn action(key: &ArtifactKey) -> &'static str {
    match key {
        ArtifactKey::Host | ArtifactKey::Module(_) => "replace-directory-archive",
        ArtifactKey::Bootstrapper => "replace-file",
    }
}
