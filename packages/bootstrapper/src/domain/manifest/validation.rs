use crate::{
    core::error::Result,
    domain::manifest::{BootstrapperArtifact, BootstrapperUpdateManifest},
};

fn validate_artifact(artifact: &BootstrapperArtifact, label: &str) -> Result<()> {
    if artifact.url.trim().is_empty() {
        return Err(format!("manifest artifact {label} is missing url").into());
    }
    if artifact.sha256.len() != 64
        || !artifact
            .sha256
            .chars()
            .all(|value| value.is_ascii_hexdigit())
    {
        return Err(format!("manifest artifact {label} has invalid sha256").into());
    }
    if artifact
        .signature_algorithm
        .as_deref()
        .is_some_and(|value| value != "ed25519")
    {
        return Err(format!("manifest artifact {label} has unsupported signatureAlgorithm").into());
    }
    Ok(())
}

pub(super) fn validate_manifest(manifest: &BootstrapperUpdateManifest) -> Result<()> {
    if manifest.schema_version != 1 {
        return Err("manifest schemaVersion must be 1".into());
    }
    if manifest.channel.trim().is_empty() {
        return Err("manifest channel is required".into());
    }
    if manifest.client_version.trim().is_empty() {
        return Err("manifest clientVersion is required".into());
    }
    if manifest.artifacts.is_empty() {
        return Err("manifest artifacts must include at least one dist".into());
    }

    for (dist, artifacts) in &manifest.artifacts {
        validate_artifact(&artifacts.app, &format!("{dist}.app"))?;
        if let Some(artifact) = &artifacts.bootstrapper {
            validate_artifact(artifact, &format!("{dist}.bootstrapper"))?;
        }
        if artifacts.modules.is_empty() {
            return Err(format!(
                "manifest artifacts {dist}.modules must include at least one module"
            )
            .into());
        }
        for (module_name, artifact) in &artifacts.modules {
            if !module_name
                .chars()
                .all(|value| value.is_ascii_alphanumeric() || value == '-' || value == '_')
            {
                return Err(format!("manifest module name is invalid: {module_name}").into());
            }
            validate_artifact(artifact, &format!("{dist}.modules.{module_name}"))?;
        }
    }

    Ok(())
}
