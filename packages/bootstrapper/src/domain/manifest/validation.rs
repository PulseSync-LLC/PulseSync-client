use crate::{
    core::error::Result,
    domain::manifest::{BootstrapperArtifact, BootstrapperUpdateManifest, VersionedArtifact},
};
use node_semver::{Range, Version};

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

fn validate_versioned_artifact(artifact: &VersionedArtifact, label: &str) -> Result<()> {
    if artifact.version.trim().is_empty() {
        return Err(format!("manifest {label}.version is required").into());
    }
    validate_artifact(&artifact.artifact, &format!("{label}.artifact"))
}

pub fn validate_manifest(manifest: &BootstrapperUpdateManifest) -> Result<()> {
    if manifest.schema_version != 2 {
        return Err("manifest schemaVersion must be 2".into());
    }
    if manifest.metadata_version == 0 {
        return Err("manifest metadataVersion must be greater than 0".into());
    }
    if manifest.channel.trim().is_empty() {
        return Err("manifest channel is required".into());
    }
    if manifest.release_version.trim().is_empty() {
        return Err("manifest releaseVersion is required".into());
    }
    if manifest.targets.is_empty() {
        return Err("manifest targets must include at least one dist".into());
    }

    for (dist, target) in &manifest.targets {
        if dist.starts_with("darwin-") {
            return Err("macOS modular publishing is not supported yet".into());
        }
        validate_versioned_artifact(&target.host, &format!("targets.{dist}.host"))?;
        let host_version = Version::parse(&target.host.version)
            .map_err(|_| format!("targets.{dist}.host.version is invalid"))?;
        let host_abi = target
            .host
            .electron_abi
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| format!("targets.{dist}.host.electronAbi is required"))?;
        validate_versioned_artifact(
            &target.bootstrapper,
            &format!("targets.{dist}.bootstrapper"),
        )?;
        if !target.components.contains_key("desktopCore") {
            return Err(
                format!("manifest targets.{dist}.components.desktopCore is required").into(),
            );
        }
        if target
            .components
            .get("desktopCore")
            .map(|component| component.version.as_str())
            != Some(manifest.release_version.as_str())
        {
            return Err(format!(
                "targets.{dist}.components.desktopCore.version must equal releaseVersion"
            )
            .into());
        }
        for (module_name, component) in &target.components {
            if !module_name
                .chars()
                .all(|value| value.is_ascii_alphanumeric() || value == '-' || value == '_')
            {
                return Err(format!("manifest module name is invalid: {module_name}").into());
            }
            validate_versioned_artifact(
                component,
                &format!("targets.{dist}.components.{module_name}"),
            )?;
            let requires_host = component.requires_host.as_deref().ok_or_else(|| {
                format!("targets.{dist}.components.{module_name}.requiresHost is required")
            })?;
            let range = Range::parse(requires_host).map_err(|_| {
                format!("targets.{dist}.components.{module_name}.requiresHost is invalid")
            })?;
            if !range.satisfies(&host_version) {
                return Err(format!(
                    "targets.{dist}.components.{module_name} is incompatible with host {}",
                    target.host.version
                )
                .into());
            }
            if module_name == "pulsesyncNative"
                && component.electron_abi.as_deref() != Some(host_abi)
            {
                return Err(format!(
                    "targets.{dist}.components.pulsesyncNative.electronAbi must match host"
                )
                .into());
            }
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(dist_artifacts: serde_json::Value) -> BootstrapperUpdateManifest {
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "channel": "dev",
            "clientVersion": "2.0.0",
            "artifacts": { "darwin-arm64": dist_artifacts }
        }))
        .unwrap()
    }

    fn artifact() -> serde_json::Value {
        serde_json::json!({
            "url": "/tmp/host.zip",
            "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "size": 10
        })
    }

    #[test]
    fn macos_bundle_accepts_only_full_host_artifact() {
        let manifest = manifest(serde_json::json!({
            "layout": "macos-bundle",
            "app": artifact(),
            "modules": {}
        }));
        assert!(validate_manifest(&manifest).is_ok());
    }

    #[test]
    fn macos_bundle_rejects_independent_components() {
        let manifest = manifest(serde_json::json!({
            "layout": "macos-bundle",
            "app": artifact(),
            "bootstrapper": artifact(),
            "modules": { "native": artifact() }
        }));
        assert!(validate_manifest(&manifest).is_err());
    }
}
