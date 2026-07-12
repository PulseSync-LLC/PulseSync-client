use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ArtifactLayout {
    #[default]
    VersionedComponents,
    MacosBundle,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct BootstrapperArtifact {
    pub sha256: String,
    pub signature: Option<String>,
    #[serde(rename = "signatureAlgorithm")]
    pub signature_algorithm: Option<String>,
    pub size: Option<u64>,
    pub url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct BootstrapperDistArtifacts {
    #[serde(default)]
    pub layout: ArtifactLayout,
    pub host: BootstrapperArtifact,
    #[serde(rename = "hostFiles", skip_serializing_if = "Option::is_none")]
    pub host_files: Option<ComponentFileSet>,
    pub bootstrapper: Option<BootstrapperArtifact>,
    #[serde(default)]
    pub modules: BTreeMap<String, BootstrapperArtifact>,
    #[serde(default, rename = "moduleFiles")]
    pub module_files: BTreeMap<String, ComponentFileSet>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ComponentFileArtifact {
    pub path: String,
    pub sha256: String,
    pub size: u64,
    pub executable: bool,
    pub artifact: BootstrapperArtifact,
    #[serde(default)]
    pub patches: Vec<DeltaArtifact>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DeltaProvider {
    Bsdiff,
    Zucchini,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DeltaArtifact {
    pub provider: DeltaProvider,
    #[serde(rename = "fromSha256")]
    pub from_sha256: String,
    #[serde(rename = "resultSha256")]
    pub result_sha256: String,
    #[serde(rename = "resultSize")]
    pub result_size: u64,
    pub artifact: BootstrapperArtifact,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ComponentFileSet {
    #[serde(rename = "contentSha256")]
    pub content_sha256: String,
    pub files: Vec<ComponentFileArtifact>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct VersionedArtifact {
    pub version: String,
    pub revision: Option<u64>,
    #[serde(rename = "diskName")]
    pub disk_name: Option<String>,
    pub required: bool,
    #[serde(rename = "contentSha256")]
    pub content_sha256: Option<String>,
    #[serde(default)]
    pub files: Vec<ComponentFileArtifact>,
    #[serde(rename = "requiresHost")]
    pub requires_host: Option<String>,
    #[serde(rename = "electronAbi")]
    pub electron_abi: Option<String>,
    pub artifact: BootstrapperArtifact,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DesktopTargetV3 {
    #[serde(default)]
    pub layout: ArtifactLayout,
    pub host: VersionedArtifact,
    pub bootstrapper: Option<VersionedArtifact>,
    pub components: BTreeMap<String, VersionedArtifact>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct BootstrapperUpdateManifest {
    pub channel: String,
    #[serde(rename = "desktopVersion")]
    pub desktop_version: String,
    #[serde(rename = "bundleVersion")]
    pub bundle_version: String,
    #[serde(rename = "metadataVersion")]
    pub metadata_version: u64,
    #[serde(rename = "deprecatedVersions")]
    pub deprecated_versions: Option<Vec<String>>,
    #[serde(rename = "desktopApi")]
    pub desktop_api: Option<String>,
    #[serde(rename = "minClientVersion")]
    pub min_client_version: Option<String>,
    #[serde(rename = "rendererManifestUrl")]
    pub renderer_manifest_url: Option<String>,
    #[serde(rename = "schemaVersion")]
    pub schema_version: u64,
    pub targets: BTreeMap<String, DesktopTargetV3>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdatePlanAction {
    Blocked,
    Install,
    Remove,
    Reuse,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum UpdatePlanDelivery {
    Bsdiff,
    None,
    Full,
}

#[derive(Clone, Debug, Serialize)]
pub struct UpdatePlanItem {
    pub key: String,
    pub action: UpdatePlanAction,
    pub required: bool,
    #[serde(rename = "fromVersion", skip_serializing_if = "Option::is_none")]
    pub from_version: Option<String>,
    #[serde(rename = "toVersion")]
    pub to_version: String,
    pub delivery: UpdatePlanDelivery,
    #[serde(rename = "downloadBytes")]
    pub download_bytes: u64,
    #[serde(rename = "restartRequired")]
    pub restart_required: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct BootstrapperUpdateDecision {
    pub artifacts: Option<BootstrapperDistArtifacts>,
    pub channel: String,
    #[serde(rename = "currentVersion")]
    pub current_version: String,
    pub dist: String,
    pub reason: String,
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
    #[serde(rename = "selectedArtifacts")]
    pub selected_artifacts: Vec<String>,
    pub plan: Vec<UpdatePlanItem>,
    #[serde(rename = "metadataVersion")]
    pub metadata_version: u64,
    #[serde(rename = "hostElectronAbi")]
    pub host_electron_abi: Option<String>,
    #[serde(rename = "componentElectronAbis")]
    pub component_electron_abis: BTreeMap<String, String>,
}
