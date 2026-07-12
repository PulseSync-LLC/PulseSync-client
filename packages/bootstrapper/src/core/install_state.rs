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
pub struct RuntimeHostV3 {
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
pub struct RuntimeComponentV3 {
    pub version: String,
    pub path: PathBuf,
    pub sha256: String,
    pub required: bool,
    #[serde(rename = "artifactSha256", skip_serializing_if = "Option::is_none")]
    pub artifact_sha256: Option<String>,
    #[serde(rename = "electronAbi", skip_serializing_if = "Option::is_none")]
    pub electron_abi: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeSnapshotV3 {
    #[serde(rename = "bundleVersion")]
    pub bundle_version: String,
    #[serde(rename = "metadataVersion")]
    pub metadata_version: u64,
    pub host: RuntimeHostV3,
    pub components: BTreeMap<String, RuntimeComponentV3>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeActivationV3 {
    pub state: ActivationState,
    pub generation: u64,
    #[serde(rename = "launchOwner", skip_serializing_if = "Option::is_none")]
    pub launch_owner: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InstallStateV3 {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u64,
    pub generation: u64,
    pub activation: RuntimeActivationV3,
    pub latest: RuntimeSnapshotV3,
    pub running: RuntimeSnapshotV3,
    #[serde(rename = "lastSuccessful")]
    pub last_successful: RuntimeSnapshotV3,
    #[serde(rename = "knownGood")]
    pub known_good: RuntimeSnapshotV3,
    pub pinned: Option<RuntimeSnapshotV3>,
}

#[derive(Debug, Serialize)]
pub struct ActiveRuntimeV3 {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u64,
    pub generation: u64,
    #[serde(rename = "bundleVersion")]
    pub bundle_version: String,
    #[serde(rename = "metadataVersion")]
    pub metadata_version: u64,
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
    pub components: BTreeMap<String, ActiveComponentV3>,
    #[serde(rename = "optionalFailures")]
    pub optional_failures: Vec<RuntimeComponentFailureV3>,
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
pub struct ActiveComponentV3 {
    pub version: String,
    pub path: PathBuf,
    pub sha256: String,
    pub required: bool,
}

#[derive(Debug, Serialize)]
pub struct RuntimeComponentFailureV3 {
    pub key: String,
    pub reason: String,
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

fn validate_snapshot(
    state_root: &Path,
    snapshot: &RuntimeSnapshotV3,
    skip_mutable_bootstrapper: bool,
) -> Result<()> {
    validate_snapshot_identity(snapshot)?;
    if snapshot.host.version.trim().is_empty()
        || snapshot.host.sha256.len() != 64
        || !snapshot
            .host
            .sha256
            .chars()
            .all(|value| value.is_ascii_hexdigit())
    {
        return Err("runtime host version or sha256 is invalid".into());
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
    if !core.required {
        return Err("desktopCore component must be required".into());
    }
    for (name, component) in &snapshot.components {
        // The bootstrapper has one stable launcher path and is replaced in
        // place. Older snapshots therefore retain useful version metadata but
        // cannot retain a separately hashable bootstrapper file.
        if skip_mutable_bootstrapper && name == "bootstrapper" {
            continue;
        }
        if let Err(error) = validate_component(state_root, name, component)
            && component.required
        {
            return Err(error);
        }
    }
    Ok(())
}

fn validate_component(
    state_root: &Path,
    name: &str,
    component: &RuntimeComponentV3,
) -> Result<PathBuf> {
    if component.version.trim().is_empty()
        || component.sha256.len() != 64
        || !component
            .sha256
            .chars()
            .all(|value| value.is_ascii_hexdigit())
    {
        return Err(format!("{name} version or sha256 is invalid").into());
    }
    let component_path = resolve_relative(
        state_root,
        &component.path,
        &format!("{name} component path"),
    )?;
    if name == "desktopCore"
        && (!component_path.join("index.cjs").is_file()
            || !component_path.join("mainWindowPreload.cjs").is_file())
    {
        return Err(format!("desktopCore is incomplete: {}", component_path.display()).into());
    }
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
    Ok(component_path)
}

fn validate_snapshot_identity(snapshot: &RuntimeSnapshotV3) -> Result<()> {
    if snapshot.bundle_version.trim().is_empty()
        || snapshot.bundle_version != snapshot.metadata_version.to_string()
    {
        return Err("runtime snapshot bundleVersion must equal metadataVersion".into());
    }
    Ok(())
}

fn same_snapshot(left: &RuntimeSnapshotV3, right: &RuntimeSnapshotV3) -> bool {
    left.bundle_version == right.bundle_version
}

fn validate_lifecycle(state: &InstallStateV3) -> Result<()> {
    for snapshot in [
        Some(&state.latest),
        Some(&state.running),
        Some(&state.last_successful),
        Some(&state.known_good),
        state.pinned.as_ref(),
    ]
    .into_iter()
    .flatten()
    {
        validate_snapshot_identity(snapshot)?;
    }
    if !same_snapshot(&state.last_successful, &state.known_good) {
        return Err("lastSuccessful and knownGood must identify the same snapshot".into());
    }
    match state.activation.state {
        ActivationState::Confirmed => {
            if state.activation.launch_owner.is_some()
                || !same_snapshot(&state.latest, &state.running)
                || !same_snapshot(&state.running, &state.last_successful)
            {
                return Err("confirmed runtime lifecycle is inconsistent".into());
            }
        }
        ActivationState::Pending => {
            if state.latest.metadata_version <= state.known_good.metadata_version {
                return Err("pending latest snapshot must be newer than knownGood".into());
            }
            let expected_running = if state.activation.launch_owner.is_some() {
                &state.latest
            } else {
                &state.known_good
            };
            if !same_snapshot(&state.running, expected_running) {
                return Err("pending running snapshot does not match activation ownership".into());
            }
        }
    }
    Ok(())
}

pub fn read_install_state_metadata(state_root: &Path) -> Result<InstallStateV3> {
    let state_root = canonical_install_root(state_root)?;
    let state_path = install_state_path(&state_root);
    let state: InstallStateV3 = serde_json::from_slice(&fs::read(&state_path)?)?;
    if state.schema_version != 3 {
        return Err(format!(
            "install-state schemaVersion must be 3: {}",
            state_path.display()
        )
        .into());
    }
    if state.generation == 0 || state.activation.generation != state.generation {
        return Err("install-state generation is invalid".into());
    }
    validate_lifecycle(&state)?;
    Ok(state)
}

pub fn read_install_state(state_root: &Path) -> Result<InstallStateV3> {
    let state_root = canonical_install_root(state_root)?;
    let state = read_install_state_metadata(&state_root)?;
    validate_snapshot(&state_root, &state.latest, false)?;
    validate_snapshot(
        &state_root,
        &state.running,
        !same_snapshot(&state.running, &state.latest),
    )?;
    validate_snapshot(
        &state_root,
        &state.last_successful,
        !same_snapshot(&state.last_successful, &state.latest),
    )?;
    validate_snapshot(
        &state_root,
        &state.known_good,
        !same_snapshot(&state.known_good, &state.latest),
    )?;
    if let Some(pinned) = &state.pinned {
        validate_snapshot(
            &state_root,
            pinned,
            !same_snapshot(pinned, &state.latest),
        )?;
    }
    Ok(state)
}

pub fn write_install_state(state_root: &Path, state: &InstallStateV3) -> Result<PathBuf> {
    let state_root = canonical_install_root(state_root)?;
    validate_lifecycle(state)?;
    let path = install_state_path(&state_root);
    write_json_atomic(&path, state)?;
    Ok(path)
}

pub fn resolve_active_runtime(state_root: &Path, lease_id: &str) -> Result<ActiveRuntimeV3> {
    let state_root = canonical_install_root(state_root)?;
    let mut state = read_install_state_metadata(&state_root)?;
    if matches!(state.activation.state, ActivationState::Pending) {
        match state.activation.launch_owner.as_deref() {
            None => {
                state.running = state.latest.clone();
                state.activation.launch_owner = Some(lease_id.to_string());
            }
            Some(owner) if owner == lease_id => {}
            Some(_) => {
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
            }
        }
        write_install_state(&state_root, &state)?;
        if matches!(state.activation.state, ActivationState::Confirmed) {
            cleanup_inactive_runtime(&state_root, &state)?;
        }
    }
    validate_snapshot(&state_root, &state.running, false)?;

    let core = state
        .running
        .components
        .get("desktopCore")
        .ok_or("desktopCore component is required")?;
    let host_path = node_runtime_path(resolve_relative(
        &state_root,
        &state.running.host.path,
        "runtime host path",
    )?);
    let core_path = node_runtime_path(validate_component(&state_root, "desktopCore", core)?);
    let mut components = BTreeMap::new();
    let mut optional_failures = Vec::new();
    for (name, component) in &state.running.components {
        match validate_component(&state_root, name, component) {
            Ok(path) => {
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
            Err(error) if !component.required => {
                optional_failures.push(RuntimeComponentFailureV3 {
                    key: format!("module:{name}"),
                    reason: error.to_string(),
                })
            }
            Err(error) => return Err(error),
        }
    }
    Ok(ActiveRuntimeV3 {
        schema_version: 3,
        generation: state.generation,
        bundle_version: state.running.bundle_version.clone(),
        metadata_version: state.running.metadata_version,
        host_version: state.running.host.version,
        host_path,
        core_version: core.version.clone(),
        core_entry: core_path.join("index.cjs"),
        core_preload: core_path.join("mainWindowPreload.cjs"),
        core_path,
        activation_state: state.activation.state,
        components,
        optional_failures,
    })
}

pub fn acknowledge_runtime(
    state_root: &Path,
    lease_id: &str,
    generation: u64,
) -> Result<InstallStateV3> {
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
        state.last_successful = state.running.clone();
        state.known_good = state.running.clone();
        state.latest = state.running.clone();
        write_install_state(&state_root, &state)?;
        cleanup_inactive_runtime(&state_root, &state)?;
    }
    Ok(state)
}

fn cleanup_inactive_runtime(state_root: &Path, state: &InstallStateV3) -> Result<Vec<PathBuf>> {
    let mut removed = Vec::new();
    let mut snapshots = vec![
        &state.latest,
        &state.running,
        &state.last_successful,
        &state.known_good,
    ];
    if let Some(pinned) = state.pinned.as_ref() {
        snapshots.push(pinned);
    }
    let keep_hosts = snapshots
        .iter()
        .map(|snapshot| snapshot.host.path.clone())
        .collect::<Vec<_>>();
    for entry in fs::read_dir(state_root)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if entry.file_type()?.is_dir()
            && name.starts_with("app-")
            && !keep_hosts.iter().any(|keep| state_root.join(keep) == path)
        {
            assert_inside(state_root, &path, "inactive app")?;
            fs::remove_dir_all(&path)?;
            removed.push(path);
        }
    }

    let mut keep_modules = Vec::new();
    for snapshot in &snapshots {
        for component in snapshot.components.values() {
            let component_path = state_root.join(&component.path);
            if component_path
                .parent()
                .and_then(Path::parent)
                .is_some_and(|parent| parent.file_name().is_some_and(|name| name == "modules"))
                && let Some(container) = component_path.parent()
            {
                keep_modules.push(container.to_path_buf());
            }
        }
    }
    for host in keep_hosts {
        let modules_root = state_root.join(host).join("modules");
        if !modules_root.is_dir() {
            continue;
        }
        for module in fs::read_dir(&modules_root)? {
            let module = module?;
            let path = module.path();
            if module.file_type()?.is_dir()
                && !keep_modules.iter().any(|candidate| candidate == &path)
            {
                assert_inside(&modules_root, &path, "inactive component")?;
                fs::remove_dir_all(&path)?;
                removed.push(path);
            }
        }
    }
    Ok(removed)
}

pub fn collect_runtime_garbage(state_root: &Path) -> Result<Vec<PathBuf>> {
    let state_root = canonical_install_root(state_root)?;
    let state = read_install_state(&state_root)?;
    cleanup_inactive_runtime(&state_root, &state)
}

pub fn pin_runtime_snapshot(
    state_root: &Path,
    bundle_version: Option<&str>,
) -> Result<InstallStateV3> {
    let state_root = canonical_install_root(state_root)?;
    let mut state = read_install_state(&state_root)?;
    state.pinned = if let Some(bundle_version) = bundle_version {
        [
            &state.latest,
            &state.running,
            &state.last_successful,
            &state.known_good,
        ]
        .into_iter()
        .find(|snapshot| snapshot.bundle_version == bundle_version)
        .cloned()
        .ok_or("requested bundleVersion is not retained")?
        .into()
    } else {
        None
    };
    write_install_state(&state_root, &state)?;
    Ok(state)
}

pub fn recover_unowned_pending_runtime(state_root: &Path) -> Result<bool> {
    let state_root = canonical_install_root(state_root)?;
    let state = read_install_state_metadata(&state_root)?;
    if matches!(state.activation.state, ActivationState::Pending)
        && state.activation.launch_owner.is_none()
    {
        validate_snapshot(&state_root, &state.latest, false)?;
    }
    Ok(false)
}
