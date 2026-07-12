use crate::core::{
    error::Result,
    fs_ops::{sha256_directory, sha256_file},
    install_state::{ActivationState, ActiveComponentV3, ActiveRuntimeV3, node_runtime_path},
    layout::assert_inside,
};
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
};

const PACKAGED_RUNTIME_PATH: &str = "Contents/Resources/pulsesync-runtime.json";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PackagedComponentV3 {
    version: String,
    path: PathBuf,
    sha256: String,
    required: bool,
    #[serde(rename = "electronAbi")]
    _electron_abi: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PackagedRuntimeV3 {
    #[serde(rename = "schemaVersion")]
    schema_version: u64,
    #[serde(rename = "hostVersion")]
    host_version: String,
    #[serde(rename = "desktopVersion")]
    desktop_version: String,
    #[serde(rename = "bundleVersion")]
    bundle_version: String,
    components: BTreeMap<String, PackagedComponentV3>,
}

fn valid_relative_path(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn resolve_component(contents_root: &Path, relative: &Path, label: &str) -> Result<PathBuf> {
    if !valid_relative_path(relative) {
        return Err(format!("{label} must be a normalized relative path").into());
    }
    let resolved = contents_root.join(relative);
    assert_inside(contents_root, &resolved, label)?;
    Ok(resolved)
}

fn read_packaged_descriptor(host_bundle: &Path) -> Result<PackagedRuntimeV3> {
    let descriptor_path = host_bundle.join(PACKAGED_RUNTIME_PATH);
    Ok(serde_json::from_slice(&fs::read(&descriptor_path)?)?)
}

pub fn packaged_bundle_version(host_bundle: &Path) -> Result<String> {
    let descriptor = read_packaged_descriptor(host_bundle)?;
    if descriptor.schema_version != 3 || descriptor.bundle_version.trim().is_empty() {
        return Err("packaged runtime descriptor is invalid".into());
    }
    Ok(descriptor.bundle_version)
}

pub fn resolve_packaged_runtime(host_bundle: &Path) -> Result<ActiveRuntimeV3> {
    let host_bundle = host_bundle
        .canonicalize()
        .map_err(|error| format!("macOS host bundle cannot be resolved: {error}"))?;
    if host_bundle.extension().and_then(|value| value.to_str()) != Some("app") {
        return Err("macOS packaged runtime requires an .app host bundle".into());
    }
    let contents_root = host_bundle.join("Contents");
    let descriptor = read_packaged_descriptor(&host_bundle)?;
    if descriptor.schema_version != 3
        || descriptor.host_version.trim().is_empty()
        || descriptor.desktop_version.trim().is_empty()
        || descriptor.bundle_version.trim().is_empty()
    {
        return Err("packaged runtime descriptor is invalid".into());
    }
    let core = descriptor
        .components
        .get("desktopCore")
        .ok_or("packaged runtime is missing desktopCore")?;
    if core.version != descriptor.desktop_version {
        return Err("packaged desktopCore version does not match desktopVersion".into());
    }
    let mut components = BTreeMap::new();
    for (name, component) in &descriptor.components {
        if component.version.trim().is_empty()
            || component.sha256.len() != 64
            || !component
                .sha256
                .chars()
                .all(|value| value.is_ascii_hexdigit())
        {
            return Err(format!("packaged component metadata is invalid: {name}").into());
        }
        let path = resolve_component(
            &contents_root,
            &component.path,
            &format!("{name} packaged component"),
        )?;
        let actual = if path.is_file() {
            sha256_file(&path)?
        } else if path.is_dir() {
            sha256_directory(&path)?
        } else {
            return Err(format!("packaged component is missing: {}", path.display()).into());
        };
        if !actual.eq_ignore_ascii_case(&component.sha256) {
            return Err(format!("packaged component hash mismatch: {name}").into());
        }
        components.insert(
            name.clone(),
            ActiveComponentV3 {
                version: component.version.clone(),
                path: node_runtime_path(path),
                sha256: component.sha256.clone(),
                required: component.required,
            },
        );
    }
    let core_path = components
        .get("desktopCore")
        .ok_or("packaged runtime is missing desktopCore")?
        .path
        .clone();
    let core_entry = core_path.join("index.cjs");
    let core_preload = core_path.join("mainWindowPreload.cjs");
    if !core_entry.is_file() || !core_preload.is_file() {
        return Err("packaged desktopCore is incomplete".into());
    }
    let metadata_version = descriptor
        .bundle_version
        .parse::<u64>()
        .map_err(|_| "packaged runtime bundleVersion must be an integer")?;
    Ok(ActiveRuntimeV3 {
        schema_version: 3,
        generation: 1,
        bundle_version: descriptor.bundle_version,
        metadata_version,
        host_version: descriptor.host_version,
        host_path: node_runtime_path(host_bundle),
        core_version: descriptor.desktop_version,
        core_path,
        core_entry,
        core_preload,
        activation_state: ActivationState::Confirmed,
        components,
        optional_failures: Vec::new(),
    })
}
