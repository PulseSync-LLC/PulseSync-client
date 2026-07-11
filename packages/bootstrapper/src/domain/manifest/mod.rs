mod model;
mod source;
mod validation;
mod version;

pub use model::{
    ArtifactLayout, BootstrapperArtifact, BootstrapperDistArtifacts, BootstrapperUpdateDecision,
    BootstrapperUpdateManifest, VersionedArtifact,
};
pub use source::{
    DEFAULT_GITHUB_OWNER, DEFAULT_GITHUB_REPO, GitHubManifestFallback, github_manifest_url,
    health_check_available, load_manifest, read_source,
};
pub use validation::validate_manifest;
pub use version::{decide_component_update, decide_update};

use crate::domain::artifacts::ArtifactKey;

pub fn artifact_for_key<'a>(
    artifacts: &'a BootstrapperDistArtifacts,
    key: &ArtifactKey,
) -> Option<&'a BootstrapperArtifact> {
    match key {
        ArtifactKey::Host => Some(&artifacts.host),
        ArtifactKey::Bootstrapper => artifacts.bootstrapper.as_ref(),
        ArtifactKey::Module(module_name) => artifacts.modules.get(module_name),
    }
}
