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
    pub bootstrapper: Option<BootstrapperArtifact>,
    #[serde(default)]
    pub modules: BTreeMap<String, BootstrapperArtifact>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct VersionedArtifact {
    pub version: String,
    #[serde(rename = "requiresHost")]
    pub requires_host: Option<String>,
    #[serde(rename = "electronAbi")]
    pub electron_abi: Option<String>,
    pub artifact: BootstrapperArtifact,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DesktopTargetV2 {
    pub host: VersionedArtifact,
    pub bootstrapper: VersionedArtifact,
    pub components: BTreeMap<String, VersionedArtifact>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct BootstrapperUpdateManifest {
    pub channel: String,
    #[serde(rename = "releaseVersion")]
    pub release_version: String,
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
    pub targets: BTreeMap<String, DesktopTargetV2>,
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
    #[serde(rename = "updateAvailable")]
    pub update_available: bool,
    #[serde(rename = "hostVersion")]
    pub host_version: String,
    #[serde(rename = "bootstrapperVersion")]
    pub bootstrapper_version: String,
    #[serde(rename = "componentVersions")]
    pub component_versions: BTreeMap<String, String>,
    #[serde(rename = "selectedArtifacts")]
    pub selected_artifacts: Vec<String>,
    #[serde(rename = "metadataVersion")]
    pub metadata_version: u64,
    #[serde(rename = "hostElectronAbi")]
    pub host_electron_abi: Option<String>,
    #[serde(rename = "componentElectronAbis")]
    pub component_electron_abis: BTreeMap<String, String>,
}
