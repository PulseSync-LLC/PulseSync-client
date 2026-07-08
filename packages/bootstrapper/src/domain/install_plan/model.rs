use crate::domain::artifacts::ArtifactKey;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct InstallPlanArtifact {
    pub action: String,
    #[serde(rename = "backupPath")]
    pub backup_path: PathBuf,
    pub key: ArtifactKey,
    pub sha256: String,
    pub size: u64,
    #[serde(rename = "sourcePath")]
    pub source_path: PathBuf,
    #[serde(rename = "targetPath")]
    pub target_path: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct InstallPlanCheck {
    pub id: String,
    pub message: String,
    pub path: Option<PathBuf>,
    pub status: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct InstallPlan {
    pub artifacts: Vec<InstallPlanArtifact>,
    #[serde(rename = "backupDir")]
    pub backup_dir: PathBuf,
    pub channel: String,
    #[serde(rename = "currentVersion")]
    pub current_version: String,
    pub dist: String,
    pub executable: bool,
    #[serde(rename = "installDir")]
    pub install_dir: PathBuf,
    pub preflight: Vec<InstallPlanCheck>,
    #[serde(rename = "retainAppVersions")]
    pub retain_app_versions: usize,
    #[serde(rename = "stagingDir")]
    pub staging_dir: PathBuf,
    #[serde(rename = "targetVersion")]
    pub target_version: String,
    #[serde(rename = "updateAvailable")]
    pub update_available: bool,
}
