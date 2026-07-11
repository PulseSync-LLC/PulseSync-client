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
    pub app: BootstrapperArtifact,
    pub bootstrapper: Option<BootstrapperArtifact>,
    #[serde(default)]
    pub modules: BTreeMap<String, BootstrapperArtifact>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct BootstrapperUpdateManifest {
    pub artifacts: BTreeMap<String, BootstrapperDistArtifacts>,
    pub channel: String,
    #[serde(rename = "clientVersion")]
    pub client_version: String,
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
}
