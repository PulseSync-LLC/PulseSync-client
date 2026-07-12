use crate::core::{
    active_app::write_json_atomic,
    error::Result,
    fs_ops::{sha256_directory, sha256_file},
    layout::{assert_inside, canonical_install_root},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
};

const INSTALL_STATE_PATH: &str = "runtime/install-state.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ActivationState {
    Pending,
    Confirmed,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeHostV2 {
    pub version: String,
    pub path: PathBuf,
    #[serde(rename = "artifactSha256", skip_serializing_if = "Option::is_none")]
    pub artifact_sha256: Option<String>,
    #[serde(rename = "electronAbi", skip_serializing_if = "Option::is_none")]
    pub electron_abi: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeComponentV2 {
    pub version: String,
    pub path: PathBuf,
    pub sha256: String,
    #[serde(rename = "artifactSha256", skip_serializing_if = "Option::is_none")]
    pub artifact_sha256: Option<String>,
    #[serde(rename = "electronAbi", skip_serializing_if = "Option::is_none")]
    pub electron_abi: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeSnapshotV2 {
    pub host: RuntimeHostV2,
    pub components: BTreeMap<String, RuntimeComponentV2>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeActivationV2 {
    pub state: ActivationState,
    pub generation: u64,
    #[serde(rename = "launchOwner", skip_serializing_if = "Option::is_none")]
    pub launch_owner: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InstallStateV2 {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u64,
    pub generation: u64,
    #[serde(rename = "metadataVersion")]
    pub metadata_version: u64,
    pub activation: RuntimeActivationV2,
    pub active: RuntimeSnapshotV2,
    pub previous: Option<RuntimeSnapshotV2>,
}

#[derive(Debug, Serialize)]
pub struct ActiveRuntimeV2 {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u64,
    pub generation: u64,
    #[serde(rename = "hostVersion")]
    pub host_version: String,
    #[serde(rename = "hostPath")]
    pub host_path: PathBuf,
    #[serde(rename = "coreVersion")]
    pub core_version: String,
    #[serde(rename = "corePath")]
    pub core_path: PathBuf,
    #[serde(rename = "coreEntry")]
    pub core_entry: PathBuf,
    #[serde(rename = "corePreload")]
    pub core_preload: PathBuf,
    #[serde(rename = "activationState")]
    pub activation_state: ActivationState,
    pub components: BTreeMap<String, ActiveComponentV2>,
}

#[cfg(windows)]
pub(crate) fn node_runtime_path(path: PathBuf) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path
}

#[cfg(not(windows))]
pub(crate) fn node_runtime_path(path: PathBuf) -> PathBuf {
    path
}

#[derive(Debug, Serialize)]
pub struct ActiveComponentV2 {
    pub version: String,
    pub path: PathBuf,
    pub sha256: String,
}

pub fn install_state_path(state_root: &Path) -> PathBuf {
    state_root.join(INSTALL_STATE_PATH)
}

fn valid_relative_path(path: &Path) -> bool {
    !path.as_os_str().is_empty()
        && !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn resolve_relative(state_root: &Path, relative: &Path, label: &str) -> Result<PathBuf> {
    if !valid_relative_path(relative) {
        return Err(format!(
            "{label} must be a normalized relative path: {}",
            relative.display()
        )
        .into());
    }
    let resolved = state_root.join(relative);
    assert_inside(state_root, &resolved, label)?;
    Ok(resolved)
}

fn validate_snapshot(state_root: &Path, snapshot: &RuntimeSnapshotV2) -> Result<()> {
    if snapshot.host.version.trim().is_empty() {
        return Err("runtime host version is required".into());
    }
    let host_path = resolve_relative(state_root, &snapshot.host.path, "runtime host path")?;
    if !host_path.is_dir() {
        return Err(format!(
            "runtime host path is not a directory: {}",
            host_path.display()
        )
        .into());
    }
    let core = snapshot
        .components
        .get("desktopCore")
        .ok_or("desktopCore component is required")?;
    if core.version.trim().is_empty()
        || core.sha256.len() != 64
        || !core.sha256.chars().all(|value| value.is_ascii_hexdigit())
    {
        return Err("desktopCore version or sha256 is invalid".into());
    }
    let core_path = resolve_relative(state_root, &core.path, "desktopCore path")?;
    let entry = core_path.join("index.cjs");
    let preload = core_path.join("mainWindowPreload.cjs");
    if !entry.is_file() || !preload.is_file() {
        return Err(format!("desktopCore is incomplete: {}", core_path.display()).into());
    }
    if sha256_directory(&core_path)? != core.sha256.to_ascii_lowercase() {
        return Err(format!(
            "desktopCore directory hash mismatch: {}",
            core_path.display()
        )
        .into());
    }
    for (name, component) in &snapshot.components {
        if name == "desktopCore" {
            continue;
        }
        let component_path = resolve_relative(
            state_root,
            &component.path,
            &format!("{name} component path"),
        )?;
        let actual = if component_path.is_file() {
            sha256_file(&component_path)?
        } else if component_path.is_dir() {
            sha256_directory(&component_path)?
        } else {
            return Err(format!(
                "component path does not exist: {}",
                component_path.display()
            )
            .into());
        };
        if actual != component.sha256.to_ascii_lowercase() {
            return Err(format!(
                "{name} component hash mismatch: {}",
                component_path.display()
            )
            .into());
        }
    }
    Ok(())
}

pub fn read_install_state_metadata(state_root: &Path) -> Result<InstallStateV2> {
    let state_root = canonical_install_root(state_root)?;
    let state_path = install_state_path(&state_root);
    let state: InstallStateV2 = serde_json::from_slice(&fs::read(&state_path)?)?;
    if state.schema_version != 2 {
        return Err(format!(
            "install-state schemaVersion must be 2: {}",
            state_path.display()
        )
        .into());
    }
    if state.generation == 0 || state.activation.generation != state.generation {
        return Err("install-state generation is invalid".into());
    }
    Ok(state)
}

pub fn read_install_state(state_root: &Path) -> Result<InstallStateV2> {
    let state_root = canonical_install_root(state_root)?;
    let state = read_install_state_metadata(&state_root)?;
    validate_snapshot(&state_root, &state.active)?;
    if let Some(previous) = &state.previous {
        validate_snapshot(&state_root, previous)?;
    }
    Ok(state)
}

pub fn write_install_state(state_root: &Path, state: &InstallStateV2) -> Result<PathBuf> {
    let state_root = canonical_install_root(state_root)?;
    let path = install_state_path(&state_root);
    write_json_atomic(&path, state)?;
    Ok(path)
}

pub fn resolve_active_runtime(state_root: &Path, lease_id: &str) -> Result<ActiveRuntimeV2> {
    let state_root = canonical_install_root(state_root)?;
    let mut state = read_install_state_metadata(&state_root)?;
    if matches!(state.activation.state, ActivationState::Pending) {
        match state.activation.launch_owner.as_deref() {
            None => state.activation.launch_owner = Some(lease_id.to_string()),
            Some(owner) if owner == lease_id => {}
            Some(_) => {
                let previous = state
                    .previous
                    .clone()
                    .ok_or("pending runtime has no rollback snapshot")?;
                state.active = previous;
                state.previous = None;
                state.generation = state
                    .generation
                    .checked_add(1)
                    .ok_or("install-state generation overflow")?;
                state.activation = RuntimeActivationV2 {
                    state: ActivationState::Confirmed,
                    generation: state.generation,
                    launch_owner: None,
                };
            }
        }
        write_install_state(&state_root, &state)?;
        if matches!(state.activation.state, ActivationState::Confirmed) {
            cleanup_inactive_runtime(&state_root, &state)?;
        }
    }
    validate_snapshot(&state_root, &state.active)?;

    let core = state
        .active
        .components
        .get("desktopCore")
        .ok_or("desktopCore component is required")?;
    let host_path = node_runtime_path(resolve_relative(
        &state_root,
        &state.active.host.path,
        "runtime host path",
    )?);
    let core_path = node_runtime_path(resolve_relative(
        &state_root,
        &core.path,
        "desktopCore path",
    )?);
    let components = state
        .active
        .components
        .iter()
        .map(|(name, component)| {
            Ok((
                name.clone(),
                ActiveComponentV2 {
                    version: component.version.clone(),
                    path: node_runtime_path(resolve_relative(
                        &state_root,
                        &component.path,
                        &format!("{name} component path"),
                    )?),
                    sha256: component.sha256.clone(),
                },
            ))
        })
        .collect::<Result<BTreeMap<_, _>>>()?;
    Ok(ActiveRuntimeV2 {
        schema_version: 2,
        generation: state.generation,
        host_version: state.active.host.version,
        host_path,
        core_version: core.version.clone(),
        core_entry: core_path.join("index.cjs"),
        core_preload: core_path.join("mainWindowPreload.cjs"),
        core_path,
        activation_state: state.activation.state,
        components,
    })
}

pub fn acknowledge_runtime(
    state_root: &Path,
    lease_id: &str,
    generation: u64,
) -> Result<InstallStateV2> {
    let state_root = canonical_install_root(state_root)?;
    let mut state = read_install_state(&state_root)?;
    if state.generation != generation {
        return Err(format!(
            "runtime generation mismatch: expected {}, got {generation}",
            state.generation
        )
        .into());
    }
    if matches!(state.activation.state, ActivationState::Pending) {
        if state.activation.launch_owner.as_deref() != Some(lease_id) {
            return Err("runtime activation launch owner mismatch".into());
        }
        state.activation.state = ActivationState::Confirmed;
        state.activation.launch_owner = None;
        write_install_state(&state_root, &state)?;
        cleanup_inactive_runtime(&state_root, &state)?;
    }
    Ok(state)
}

fn cleanup_inactive_runtime(state_root: &Path, state: &InstallStateV2) -> Result<()> {
    let mut keep_hosts = vec![state.active.host.path.clone()];
    if let Some(previous) = &state.previous {
        keep_hosts.push(previous.host.path.clone());
    }
    for entry in fs::read_dir(state_root)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if entry.file_type()?.is_dir()
            && name.starts_with("host-")
            && !keep_hosts.iter().any(|keep| state_root.join(keep) == path)
        {
            assert_inside(state_root, &path, "inactive host")?;
            fs::remove_dir_all(path)?;
        }
    }

    let modules_root = state_root.join("modules");
    if !modules_root.is_dir() {
        return Ok(());
    }
    let mut keep_modules = Vec::new();
    for snapshot in std::iter::once(&state.active).chain(state.previous.iter()) {
        for component in snapshot.components.values() {
            let parts = component.path.components().collect::<Vec<_>>();
            if parts.len() >= 3
                && parts[0].as_os_str() == "modules"
                && let Component::Normal(container) = parts[1]
            {
                keep_modules.push(modules_root.join(container));
            }
        }
    }
    for module in fs::read_dir(&modules_root)? {
        let module = module?;
        let Some(name) = module.file_name().to_str().map(str::to_string) else {
            continue;
        };
        let path = module.path();
        if module.file_type()?.is_dir()
            && name.contains('-')
            && !keep_modules.iter().any(|candidate| candidate == &path)
        {
            assert_inside(&modules_root, &path, "inactive component")?;
            fs::remove_dir_all(path)?;
        }
    }
    Ok(())
}

pub fn recover_unowned_pending_runtime(state_root: &Path) -> Result<bool> {
    let state_root = canonical_install_root(state_root)?;
    let mut state = read_install_state_metadata(&state_root)?;
    if !matches!(state.activation.state, ActivationState::Pending)
        || state.activation.launch_owner.is_some()
    {
        return Ok(false);
    }
    let previous = state
        .previous
        .take()
        .ok_or("pending runtime has no rollback snapshot")?;
    state.active = previous;
    state.generation = state
        .generation
        .checked_add(1)
        .ok_or("install-state generation overflow")?;
    state.activation = RuntimeActivationV2 {
        state: ActivationState::Confirmed,
        generation: state.generation,
        launch_owner: None,
    };
    validate_snapshot(&state_root, &state.active)?;
    write_install_state(&state_root, &state)?;
    cleanup_inactive_runtime(&state_root, &state)?;
    Ok(true)
}
