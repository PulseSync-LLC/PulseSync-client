mod model;
mod source;
mod validation;
mod version;

pub use model::{
    BootstrapperArtifact, BootstrapperDistArtifacts, BootstrapperUpdateDecision,
    BootstrapperUpdateManifest,
};
pub use source::{load_manifest, read_source};
pub use version::decide_update;

use crate::domain::artifacts::ArtifactKey;

pub fn artifact_for_key<'a>(
    artifacts: &'a BootstrapperDistArtifacts,
    key: &ArtifactKey,
) -> Option<&'a BootstrapperArtifact> {
    match key {
        ArtifactKey::App => Some(&artifacts.app),
        ArtifactKey::Bootstrapper => artifacts.bootstrapper.as_ref(),
        ArtifactKey::Module(module_name) => artifacts.modules.get(module_name),
    }
}
