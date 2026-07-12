use crate::domain::artifacts::{ArtifactKey, StagedFileOperation};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct InstallPlanArtifact {
    pub action: String,
    #[serde(rename = "backupPath")]
    pub backup_path: PathBuf,
    pub key: ArtifactKey,
    pub required: bool,
    #[serde(rename = "fileOperations")]
    pub file_operations: Vec<StagedFileOperation>,
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
    #[serde(rename = "bundleVersion")]
    pub bundle_version: String,
    #[serde(rename = "updateAvailable")]
    pub update_available: bool,
    #[serde(rename = "hostVersion")]
    pub host_version: String,
    #[serde(rename = "bootstrapperVersion")]
    pub bootstrapper_version: Option<String>,
    #[serde(rename = "componentVersions")]
    pub component_versions: BTreeMap<String, String>,
    #[serde(rename = "componentRevisions")]
    pub component_revisions: BTreeMap<String, u64>,
    #[serde(rename = "componentDiskNames")]
    pub component_disk_names: BTreeMap<String, String>,
    #[serde(rename = "metadataVersion")]
    pub metadata_version: u64,
    #[serde(rename = "hostElectronAbi")]
    pub host_electron_abi: Option<String>,
    #[serde(rename = "hostContentSha256")]
    pub host_content_sha256: Option<String>,
    #[serde(rename = "hostArtifactSha256")]
    pub host_artifact_sha256: Option<String>,
    #[serde(rename = "bootstrapperArtifactSha256")]
    pub bootstrapper_artifact_sha256: Option<String>,
    #[serde(rename = "componentElectronAbis")]
    pub component_electron_abis: BTreeMap<String, String>,
    #[serde(rename = "componentContentSha256s")]
    pub component_content_sha256s: BTreeMap<String, String>,
    #[serde(rename = "componentArtifactSha256s")]
    pub component_artifact_sha256s: BTreeMap<String, String>,
    #[serde(rename = "omittedComponents")]
    pub omitted_components: Vec<String>,
}
