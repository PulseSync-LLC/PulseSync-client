use crate::{
    core::error::Result,
    domain::manifest::{
        BootstrapperArtifact, BootstrapperUpdateManifest, DeltaProvider, VersionedArtifact,
    },
};
use node_semver::{Range, Version};
use std::collections::BTreeSet;

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

fn validate_component_files(component: &VersionedArtifact, label: &str) -> Result<()> {
    let content_sha256 = component
        .content_sha256
        .as_deref()
        .ok_or_else(|| format!("manifest {label}.contentSha256 is required"))?;
    if content_sha256.len() != 64
        || !content_sha256
            .chars()
            .all(|value| value.is_ascii_hexdigit())
    {
        return Err(format!("manifest {label}.contentSha256 is invalid").into());
    }
    if component.files.is_empty() {
        return Ok(());
    }
    let mut paths = BTreeSet::new();
    for file in &component.files {
        let safe_path = !file.path.is_empty()
            && !file.path.starts_with('/')
            && !file.path.contains('\\')
            && file
                .path
                .split('/')
                .all(|segment| !segment.is_empty() && segment != "." && segment != "..");
        if !safe_path || !paths.insert(file.path.clone()) {
            return Err(format!(
                "manifest {label}.files contains an unsafe or duplicate path: {}",
                file.path
            )
            .into());
        }
        if file.sha256.len() != 64 || !file.sha256.chars().all(|value| value.is_ascii_hexdigit()) {
            return Err(format!("manifest {label}.files.{}.sha256 is invalid", file.path).into());
        }
        validate_artifact(
            &file.artifact,
            &format!("{label}.files.{}.artifact", file.path),
        )?;
        if !file.artifact.sha256.eq_ignore_ascii_case(&file.sha256)
            || file.artifact.size != Some(file.size)
        {
            return Err(format!(
                "manifest {label}.files.{} full artifact metadata is inconsistent",
                file.path
            )
            .into());
        }
        let mut patch_sources = BTreeSet::new();
        for patch in &file.patches {
            if patch.provider == DeltaProvider::Zucchini {
                return Err(format!(
                    "manifest {label}.files.{} requests unavailable zucchini provider",
                    file.path
                )
                .into());
            }
            if patch.from_sha256.len() != 64
                || !patch
                    .from_sha256
                    .chars()
                    .all(|value| value.is_ascii_hexdigit())
                || !patch_sources.insert(patch.from_sha256.to_ascii_lowercase())
                || patch.from_sha256.eq_ignore_ascii_case(&file.sha256)
                || !patch.result_sha256.eq_ignore_ascii_case(&file.sha256)
                || patch.result_size != file.size
            {
                return Err(format!(
                    "manifest {label}.files.{} delta metadata is invalid",
                    file.path
                )
                .into());
            }
            validate_artifact(
                &patch.artifact,
                &format!("{label}.files.{}.patch", file.path),
            )?;
        }
    }
    Ok(())
}

pub fn validate_manifest(manifest: &BootstrapperUpdateManifest) -> Result<()> {
    if !matches!(manifest.schema_version, 3 | 4) {
        return Err("manifest schemaVersion must be 3 or 4".into());
    }
    if manifest.metadata_version == 0 {
        return Err("manifest metadataVersion must be greater than 0".into());
    }
    if manifest.channel.trim().is_empty() {
        return Err("manifest channel is required".into());
    }
    if manifest.desktop_version.trim().is_empty() {
        return Err("manifest desktopVersion is required".into());
    }
    if manifest.schema_version == 3 {
        if manifest.bundle_version != manifest.metadata_version.to_string() {
            return Err("manifest bundleVersion must equal metadataVersion".into());
        }
    } else if !manifest.bundle_version.is_empty() {
        return Err("schema-v4 manifest must omit top-level bundleVersion".into());
    }
    if manifest.targets.is_empty() {
        return Err("manifest targets must include at least one dist".into());
    }

    for (dist, target) in &manifest.targets {
        validate_versioned_artifact(&target.host, &format!("targets.{dist}.host"))?;
        if !target.host.required {
            return Err(format!("targets.{dist}.host must be required").into());
        }
        match target.layout {
            crate::domain::manifest::ArtifactLayout::MacosBundle => {
                if manifest.schema_version != 3 {
                    return Err("macos-bundle layout requires schemaVersion 3".into());
                }
                if !dist.starts_with("darwin-") {
                    return Err("macos-bundle layout is only valid for darwin targets".into());
                }
                if !target.components.is_empty() {
                    return Err(format!(
                        "targets.{dist}.components must be empty for macos-bundle"
                    )
                    .into());
                }
                if target.bootstrapper.is_some() {
                    return Err(format!(
                        "targets.{dist}.bootstrapper must be omitted for macos-bundle"
                    )
                    .into());
                }
                if target.host.bundle_version.is_some()
                    || target.host.content_sha256.is_some()
                    || !target.host.files.is_empty()
                {
                    return Err(format!(
                        "targets.{dist}.host must not define hybrid or component fields"
                    )
                    .into());
                }
                continue;
            }
            crate::domain::manifest::ArtifactLayout::MacosHybrid => {
                if manifest.schema_version != 4 {
                    return Err("macos-hybrid layout requires schemaVersion 4".into());
                }
                if !dist.starts_with("darwin-") {
                    return Err("macos-hybrid layout is only valid for darwin targets".into());
                }
                if target.bootstrapper.is_some() {
                    return Err(format!(
                        "targets.{dist}.bootstrapper must be omitted for macos-hybrid"
                    )
                    .into());
                }
                if target.host.content_sha256.is_some() || !target.host.files.is_empty() {
                    return Err(format!(
                        "targets.{dist}.host must not define component files for macos-hybrid"
                    )
                    .into());
                }
                let host_bundle_version = target
                    .host
                    .bundle_version
                    .as_deref()
                    .filter(|value| value.parse::<u64>().is_ok_and(|value| value > 0))
                    .ok_or_else(|| {
                        format!("targets.{dist}.host.bundleVersion must be a positive integer")
                    })?;
                let _ = host_bundle_version;
                if target.components.len() != 1 || !target.components.contains_key("desktopCore") {
                    return Err(format!(
                        "targets.{dist}.components must contain only desktopCore for macos-hybrid"
                    )
                    .into());
                }
            }
            crate::domain::manifest::ArtifactLayout::VersionedComponents => {
                if manifest.schema_version != 3 {
                    return Err("versioned-components layout requires schemaVersion 3".into());
                }
                validate_component_files(&target.host, &format!("targets.{dist}.host"))?;
                let bootstrapper = target.bootstrapper.as_ref().ok_or_else(|| {
                    format!("targets.{dist}.bootstrapper is required for versioned-components")
                })?;
                validate_versioned_artifact(bootstrapper, &format!("targets.{dist}.bootstrapper"))?;
                if !bootstrapper.required {
                    return Err(format!("targets.{dist}.bootstrapper must be required").into());
                }
                if bootstrapper.content_sha256.is_some() || !bootstrapper.files.is_empty() {
                    return Err(format!(
                        "targets.{dist}.bootstrapper must not define component files"
                    )
                    .into());
                }
                if dist.starts_with("darwin-") {
                    return Err("darwin targets must use a macOS layout".into());
                }
                if target.host.bundle_version.is_some() {
                    return Err(format!(
                        "targets.{dist}.host.bundleVersion is only valid for macos-hybrid"
                    )
                    .into());
                }
            }
        }
        let host_version = Version::parse(&target.host.version)
            .map_err(|_| format!("targets.{dist}.host.version is invalid"))?;
        let host_abi = target
            .host
            .electron_abi
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| format!("targets.{dist}.host.electronAbi is required"))?;
        let mut component_disk_names = BTreeSet::new();
        if !target.components.contains_key("desktopCore") {
            return Err(
                format!("manifest targets.{dist}.components.desktopCore is required").into(),
            );
        }
        if target
            .components
            .get("desktopCore")
            .map(|component| component.version.as_str())
            != Some(manifest.desktop_version.as_str())
        {
            return Err(format!(
                "targets.{dist}.components.desktopCore.version must equal desktopVersion"
            )
            .into());
        }
        if !target
            .components
            .get("desktopCore")
            .is_some_and(|component| component.required)
        {
            return Err(format!("targets.{dist}.components.desktopCore must be required").into());
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
            validate_component_files(
                component,
                &format!("targets.{dist}.components.{module_name}"),
            )?;
            if component.revision.is_none_or(|revision| revision == 0) {
                return Err(format!(
                    "targets.{dist}.components.{module_name}.revision must be greater than 0"
                )
                .into());
            }
            let disk_name = component.disk_name.as_deref().ok_or_else(|| {
                format!("targets.{dist}.components.{module_name}.diskName is required")
            })?;
            if disk_name.is_empty()
                || !disk_name.chars().enumerate().all(|(index, value)| {
                    if index == 0 {
                        value.is_ascii_lowercase()
                    } else {
                        value.is_ascii_lowercase() || value.is_ascii_digit() || value == '_'
                    }
                })
            {
                return Err(
                    format!("targets.{dist}.components.{module_name}.diskName is invalid").into(),
                );
            }
            if !component_disk_names.insert(disk_name.to_string()) {
                return Err(format!(
                    "targets.{dist}.components contains duplicate diskName: {disk_name}"
                )
                .into());
            }
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

    fn manifest(target: serde_json::Value) -> BootstrapperUpdateManifest {
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 3,
            "metadataVersion": 1,
            "bundleVersion": "1",
            "channel": "dev",
            "desktopVersion": "2.0.0",
            "desktopApi": "1.0.0",
            "targets": { "darwin-arm64": target }
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

    fn hybrid_component(version: &str, revision: u64) -> serde_json::Value {
        serde_json::json!({
            "version": version,
            "revision": revision,
            "diskName": "pulsesync_desktop_core",
            "required": true,
            "requiresHost": ">=2.0.0 <3.0.0",
            "contentSha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "files": [{
                "path": "index.cjs",
                "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                "size": 10,
                "executable": false,
                "artifact": {
                    "url": "/tmp/index.cjs",
                    "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                    "size": 10
                }
            }],
            "artifact": artifact()
        })
    }

    fn hybrid_manifest(components: serde_json::Value) -> BootstrapperUpdateManifest {
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 4,
            "metadataVersion": 2,
            "channel": "dev",
            "desktopVersion": "2.0.0",
            "desktopApi": "1.0.0",
            "targets": {
                "darwin-arm64": {
                    "layout": "macos-hybrid",
                    "host": {
                        "version": "2.0.0",
                        "bundleVersion": "1",
                        "electronAbi": "140",
                        "required": true,
                        "artifact": artifact()
                    },
                    "components": components
                }
            }
        }))
        .unwrap()
    }

    #[test]
    fn macos_bundle_accepts_only_full_host_artifact() {
        let manifest = manifest(serde_json::json!({
            "layout": "macos-bundle",
            "host": { "version": "2.0.0", "required": true, "artifact": artifact() },
            "components": {}
        }));
        assert!(validate_manifest(&manifest).is_ok());
    }

    #[test]
    fn macos_bundle_rejects_independent_components() {
        let manifest = manifest(serde_json::json!({
            "layout": "macos-bundle",
            "host": { "version": "2.0.0", "required": true, "artifact": artifact() },
            "components": {
                "desktopCore": {
                    "version": "2.0.0",
                    "required": true,
                    "requiresHost": ">=1.0.0",
                    "artifact": artifact()
                }
            }
        }));
        assert!(validate_manifest(&manifest).is_err());
    }

    #[test]
    fn macos_hybrid_accepts_only_desktop_core() {
        let manifest = hybrid_manifest(serde_json::json!({
            "desktopCore": hybrid_component("2.0.0", 2)
        }));
        assert!(validate_manifest(&manifest).is_ok());
    }

    #[test]
    fn macos_hybrid_rejects_auxiliary_external_component() {
        let manifest = hybrid_manifest(serde_json::json!({
            "desktopCore": hybrid_component("2.0.0", 2),
            "artifactWorker": hybrid_component("2.0.0", 2)
        }));
        assert!(validate_manifest(&manifest).is_err());
    }

    #[test]
    fn schema_v4_rejects_top_level_bundle_version() {
        let mut value = serde_json::to_value(hybrid_manifest(serde_json::json!({
            "desktopCore": hybrid_component("2.0.0", 2)
        })))
        .unwrap();
        value["bundleVersion"] = serde_json::json!("2");
        let manifest: BootstrapperUpdateManifest = serde_json::from_value(value).unwrap();
        assert!(validate_manifest(&manifest).is_err());
    }
}
