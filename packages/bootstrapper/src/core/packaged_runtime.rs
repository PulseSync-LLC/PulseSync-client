use crate::core::{
    error::Result,
    fs_ops::{copy_directory, sha256_directory, sha256_file},
    host_contract::{read_runtime_host_contract, runtime_host_contract_matches},
    install_state::{
        ActivationState, InstallStateV3, RuntimeActivationV3, RuntimeComponentV3, RuntimeHostV3,
        RuntimeLocation, RuntimeSnapshotV3, install_state_path, read_install_state_metadata,
        read_install_state_with_host, write_install_state,
    },
    layout::{assert_inside, canonical_install_root},
    session_lock::SessionLock,
};
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
};

const PACKAGED_RUNTIME_PATH: &str = "Contents/Resources/pulsesync-runtime.json";

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct PackagedComponentV3 {
    version: String,
    path: PathBuf,
    sha256: String,
    required: bool,
    #[serde(default)]
    revision: Option<u64>,
    #[serde(rename = "diskName")]
    disk_name: Option<String>,
    #[serde(rename = "electronAbi")]
    _electron_abi: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
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
    #[serde(rename = "metadataVersion")]
    metadata_version: Option<u64>,
    #[serde(rename = "hostElectronAbi")]
    host_electron_abi: Option<String>,
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

fn packaged_component_path(host_bundle: &Path, component: &PackagedComponentV3) -> Result<PathBuf> {
    resolve_component(
        &host_bundle.join("Contents"),
        &component.path,
        "packaged component",
    )
}

fn managed_component_path(
    state_root: &Path,
    component: &PackagedComponentV3,
    name: &str,
) -> Result<PathBuf> {
    let revision = component.revision.unwrap_or(1);
    let disk_name = component
        .disk_name
        .clone()
        .unwrap_or_else(|| name.to_ascii_lowercase());
    if revision == 0
        || disk_name.is_empty()
        || !disk_name
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '_' || value == '-')
    {
        return Err(format!("packaged component identity is invalid: {name}").into());
    }
    Ok(state_root
        .join("components")
        .join(format!("{disk_name}-{revision}"))
        .join(disk_name))
}

fn relative_to(root: &Path, path: &Path, label: &str) -> Result<PathBuf> {
    path.strip_prefix(root)
        .map(Path::to_path_buf)
        .map_err(|_| format!("{label} escapes state root").into())
}

fn seed_component(
    state_root: &Path,
    host_bundle: &Path,
    name: &str,
    component: &PackagedComponentV3,
) -> Result<RuntimeComponentV3> {
    let source = packaged_component_path(host_bundle, component)?;
    let actual = if source.is_dir() {
        sha256_directory(&source)?
    } else {
        sha256_file(&source)?
    };
    if !actual.eq_ignore_ascii_case(&component.sha256) {
        return Err(format!("packaged component hash mismatch: {name}").into());
    }
    if name == "desktopCore" {
        if !source.is_dir() {
            return Err("packaged desktopCore must be a directory".into());
        }
        let target = managed_component_path(state_root, component, name)?;
        if target.exists() {
            if sha256_directory(&target)? != component.sha256.to_ascii_lowercase() {
                return Err("existing packaged desktopCore seed hash mismatch".into());
            }
        } else {
            let parent = target
                .parent()
                .ok_or("managed component path has no parent")?;
            fs::create_dir_all(parent)?;
            let temporary = parent.join(format!(".seed-{}-{}", name, std::process::id()));
            if temporary.exists() {
                fs::remove_dir_all(&temporary)?;
            }
            copy_directory(&source, &temporary)?;
            if sha256_directory(&temporary)? != component.sha256.to_ascii_lowercase() {
                fs::remove_dir_all(&temporary)?;
                return Err("copied packaged desktopCore seed hash mismatch".into());
            }
            fs::rename(&temporary, &target)?;
        }
        return Ok(RuntimeComponentV3 {
            version: component.version.clone(),
            location: RuntimeLocation::StateRoot,
            revision: Some(component.revision.unwrap_or(1)),
            disk_name: component.disk_name.clone(),
            path: relative_to(state_root, &target, "managed desktopCore")?,
            sha256: component.sha256.clone(),
            required: component.required,
            artifact_sha256: None,
            electron_abi: component._electron_abi.clone(),
        });
    }
    Ok(RuntimeComponentV3 {
        version: component.version.clone(),
        location: RuntimeLocation::HostBundle,
        revision: component.revision,
        disk_name: component.disk_name.clone(),
        path: component.path.clone(),
        sha256: component.sha256.clone(),
        required: component.required,
        artifact_sha256: None,
        electron_abi: component._electron_abi.clone(),
    })
}

pub fn ensure_macos_hybrid_state(state_root: &Path, host_bundle: &Path) -> Result<InstallStateV3> {
    let state_root = canonical_install_root(state_root)?;
    let host_bundle = host_bundle
        .canonicalize()
        .map_err(|error| format!("macOS host bundle cannot be resolved: {error}"))?;
    let contract = read_runtime_host_contract(&state_root)?
        .ok_or("macOS hybrid runtime requires a runtime host contract")?;
    if !runtime_host_contract_matches(&contract, &host_bundle, &contract.app_executable) {
        return Err("macOS hybrid host does not match the runtime host contract".into());
    }
    let _session_lock = SessionLock::acquire(&state_root, std::time::Duration::from_secs(10))?;
    let mut existing_state = None;
    if install_state_path(&state_root).is_file() {
        let mut state = read_install_state_metadata(&state_root)?;
        if state.schema_version != 4 {
            return Err("macOS hybrid runtime requires install-state schemaVersion 4".into());
        }
        let descriptor = read_packaged_descriptor(&host_bundle)?;
        if state.latest.host.bundle_version.as_deref() == Some(descriptor.bundle_version.as_str()) {
            return Ok(state);
        }
        if !matches!(state.activation.state, ActivationState::Confirmed) {
            if state.known_good.host.bundle_version.as_deref()
                == Some(descriptor.bundle_version.as_str())
            {
                state.latest = state.known_good.clone();
                state.running = state.known_good.clone();
                state.generation = state
                    .generation
                    .checked_add(1)
                    .ok_or("install-state generation overflow")?;
                state.activation = RuntimeActivationV3 {
                    state: ActivationState::Confirmed,
                    generation: state.generation,
                    launch_owner: None,
                };
                write_install_state(&state_root, &state)?;
                return Ok(state);
            }
            return Err("cannot reconcile a rotated macOS host while activation is pending".into());
        }
        existing_state = Some(state);
    }
    let descriptor = read_packaged_descriptor(&host_bundle)?;
    if descriptor.schema_version != 3 && descriptor.schema_version != 4 {
        return Err("packaged runtime descriptor schemaVersion must be 3 or 4".into());
    }
    let metadata_version = descriptor.metadata_version.unwrap_or(
        descriptor
            .bundle_version
            .parse::<u64>()
            .map_err(|_| "packaged runtime bundleVersion must be an integer")?,
    );
    let mut components = BTreeMap::new();
    for (name, component) in &descriptor.components {
        components.insert(
            name.clone(),
            seed_component(&state_root, &host_bundle, name, component)?,
        );
    }
    let core = components
        .get("desktopCore")
        .ok_or("packaged runtime is missing desktopCore")?;
    if core.version != descriptor.desktop_version || !core.required {
        return Err("packaged desktopCore metadata is invalid".into());
    }
    let host_sha256 = sha256_directory(&host_bundle)?;
    let mut snapshot = RuntimeSnapshotV3 {
        bundle_version: metadata_version.to_string(),
        metadata_version,
        host: RuntimeHostV3 {
            version: descriptor.host_version.clone(),
            location: RuntimeLocation::HostBundle,
            bundle_version: Some(descriptor.bundle_version.clone()),
            path: PathBuf::from("."),
            sha256: host_sha256,
            artifact_sha256: None,
            electron_abi: descriptor.host_electron_abi.clone(),
        },
        components,
    };
    let state = if let Some(mut existing) = existing_state {
        if metadata_version <= existing.latest.metadata_version {
            return Err("rotated macOS host metadataVersion must advance".into());
        }
        snapshot.metadata_version = metadata_version;
        snapshot.bundle_version = snapshot.metadata_version.to_string();
        existing.latest = snapshot;
        existing.running = existing.known_good.clone();
        existing.generation = existing
            .generation
            .checked_add(1)
            .ok_or("install-state generation overflow")?;
        existing.activation = RuntimeActivationV3 {
            state: ActivationState::Pending,
            generation: existing.generation,
            launch_owner: None,
        };
        existing
    } else {
        InstallStateV3 {
            schema_version: 4,
            generation: 1,
            activation: RuntimeActivationV3 {
                state: ActivationState::Confirmed,
                generation: 1,
                launch_owner: None,
            },
            latest: snapshot.clone(),
            running: snapshot.clone(),
            last_successful: snapshot.clone(),
            known_good: snapshot,
            pinned: None,
        }
    };
    write_install_state(&state_root, &state)?;
    read_install_state_with_host(&state_root, Some(&host_bundle))
}

pub fn packaged_bundle_version(host_bundle: &Path) -> Result<String> {
    let descriptor = read_packaged_descriptor(host_bundle)?;
    if !matches!(descriptor.schema_version, 3 | 4) || descriptor.bundle_version.trim().is_empty() {
        return Err("packaged runtime descriptor is invalid".into());
    }
    Ok(descriptor.bundle_version)
}

pub fn packaged_desktop_version(host_bundle: &Path) -> Result<String> {
    let descriptor = read_packaged_descriptor(host_bundle)?;
    if !matches!(descriptor.schema_version, 3 | 4) || descriptor.desktop_version.trim().is_empty() {
        return Err("packaged runtime descriptor is invalid".into());
    }
    Ok(descriptor.desktop_version)
}
