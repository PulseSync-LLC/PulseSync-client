use crate::core::{
    error::Result,
    install_state::{install_state_path, read_install_state_metadata},
};
use serde::Serialize;
use std::{
    env, fs,
    path::Component,
    path::{Path, PathBuf},
};

pub const MIN_RETAIN_APP_VERSIONS: usize = 2;

#[derive(Clone, Debug, Serialize)]
pub struct Layout {
    #[serde(rename = "layoutKind")]
    pub layout_kind: LayoutKind,
    #[serde(rename = "installRoot")]
    pub install_root: PathBuf,
    #[serde(rename = "stateRoot")]
    pub state_root: PathBuf,
    #[serde(rename = "hostBundle", skip_serializing_if = "Option::is_none")]
    pub host_bundle: Option<PathBuf>,
    #[serde(rename = "installStateFile")]
    pub install_state_file: PathBuf,
    #[serde(rename = "currentVersion")]
    pub current_version: Option<String>,
    #[serde(rename = "appExecutableName")]
    pub app_executable_name: String,
    #[serde(rename = "appDir")]
    pub app_dir: PathBuf,
    #[serde(rename = "appExecutable")]
    pub app_executable: PathBuf,
    #[serde(rename = "bootstrapperDir")]
    pub bootstrapper_dir: PathBuf,
    #[serde(rename = "modulesDir")]
    pub modules_dir: PathBuf,
    #[serde(rename = "updatesDir")]
    pub updates_dir: PathBuf,
    #[serde(rename = "transactionRoot")]
    pub transaction_root: PathBuf,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum LayoutKind {
    VersionedComponents,
    MacosBundle,
}

fn default_app_executable_name() -> &'static str {
    if cfg!(windows) {
        "PulseSync.exe"
    } else {
        "PulseSync"
    }
}

pub fn normalize_retain_app_versions(value: usize) -> usize {
    value.max(MIN_RETAIN_APP_VERSIONS)
}

fn absolute_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        return path.to_path_buf();
    }

    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(path)
}

pub fn canonical_install_root(path: &Path) -> Result<PathBuf> {
    let absolute = absolute_path(path);
    fs::create_dir_all(&absolute)?;
    Ok(absolute.canonicalize()?)
}

fn normalize_lexical(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            _ => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

fn containment_key(path: &Path) -> String {
    let path = path
        .canonicalize()
        .unwrap_or_else(|_| normalize_lexical(&absolute_path(path)));
    let mut value = path.to_string_lossy().to_string();

    if cfg!(windows) {
        if let Some(stripped) = value.strip_prefix(r"\\?\") {
            value = stripped.to_string();
        }
        value = value.replace('/', r"\").to_lowercase();
        while value.ends_with('\\') && value.len() > 3 {
            value.pop();
        }
    } else {
        while value.ends_with('/') && value.len() > 1 {
            value.pop();
        }
    }

    value
}

pub fn is_inside(parent: &Path, child: &Path) -> bool {
    let parent = containment_key(parent);
    let child = containment_key(child);
    let separator = if cfg!(windows) { r"\" } else { "/" };

    child == parent || child.starts_with(&format!("{parent}{separator}"))
}

pub fn assert_inside(parent: &Path, child: &Path, label: &str) -> Result<()> {
    if !is_inside(parent, child) {
        return Err(format!(
            "{label} must stay inside {}: {}",
            parent.display(),
            child.display()
        )
        .into());
    }
    Ok(())
}

pub fn resolve_layout(
    install_root: PathBuf,
    app_executable_name: Option<String>,
) -> Result<Layout> {
    let install_root = canonical_install_root(&install_root)?;
    let app_executable_name =
        app_executable_name.unwrap_or_else(|| default_app_executable_name().to_string());
    let install_state = read_install_state_metadata(&install_root)?;
    let install_state_file = install_state_path(&install_root);
    let current_version = Some(
        install_state
            .active
            .components
            .get("desktopCore")
            .ok_or("install state is missing desktopCore")?
            .version
            .clone(),
    );
    let app_dir = install_root.join(&install_state.active.host.path);
    let modules_dir = install_root.join("modules");
    let updates_dir = install_root.join("updates");
    let layout = Layout {
        layout_kind: LayoutKind::VersionedComponents,
        app_executable: app_dir.join(&app_executable_name),
        bootstrapper_dir: install_root.join("bootstrapper"),
        transaction_root: updates_dir.join("transactions"),
        state_root: install_root.clone(),
        install_root,
        host_bundle: None,
        install_state_file,
        current_version,
        app_executable_name,
        app_dir,
        modules_dir,
        updates_dir,
    };

    assert_inside(&layout.install_root, &layout.app_dir, "appDir")?;
    assert_inside(
        &layout.install_root,
        &layout.app_executable,
        "appExecutable",
    )?;
    assert_inside(
        &layout.install_root,
        &layout.bootstrapper_dir,
        "bootstrapperDir",
    )?;
    assert_inside(
        &layout.install_root,
        &layout.install_state_file,
        "installStateFile",
    )?;
    assert_inside(&layout.install_root, &layout.modules_dir, "modulesDir")?;
    assert_inside(&layout.install_root, &layout.updates_dir, "updatesDir")?;
    assert_inside(
        &layout.install_root,
        &layout.transaction_root,
        "transactionRoot",
    )?;
    Ok(layout)
}

pub fn resolve_macos_layout(
    state_root: PathBuf,
    host_bundle: PathBuf,
    app_executable: PathBuf,
) -> Result<Layout> {
    let state_root = canonical_install_root(&state_root)?;
    let host_bundle = host_bundle
        .canonicalize()
        .map_err(|error| format!("macOS host bundle cannot be resolved: {error}"))?;
    if host_bundle.extension().and_then(|value| value.to_str()) != Some("app") {
        return Err(format!(
            "macOS host bundle must have an .app extension: {}",
            host_bundle.display()
        )
        .into());
    }
    if !host_bundle.join("Contents").join("Info.plist").is_file() {
        return Err(format!(
            "macOS host bundle is missing Contents/Info.plist: {}",
            host_bundle.display()
        )
        .into());
    }
    let app_executable = app_executable
        .canonicalize()
        .map_err(|error| format!("macOS app executable cannot be resolved: {error}"))?;
    assert_inside(
        &host_bundle.join("Contents").join("MacOS"),
        &app_executable,
        "macOS app executable",
    )?;
    if !app_executable.is_file() {
        return Err(format!(
            "macOS app executable is not a file: {}",
            app_executable.display()
        )
        .into());
    }
    if is_inside(&host_bundle, &state_root) || is_inside(&state_root, &host_bundle) {
        return Err("macOS state root and host bundle must not contain each other".into());
    }
    let app_executable_name = app_executable
        .strip_prefix(&host_bundle)
        .map_err(|_| "macOS app executable is outside the host bundle")?
        .to_string_lossy()
        .to_string();
    let updates_dir = state_root.join("updates");
    let layout = Layout {
        layout_kind: LayoutKind::MacosBundle,
        install_root: state_root.clone(),
        state_root,
        host_bundle: Some(host_bundle.clone()),
        install_state_file: PathBuf::new(),
        current_version: None,
        app_executable_name,
        app_dir: host_bundle.clone(),
        app_executable,
        bootstrapper_dir: host_bundle
            .join("Contents")
            .join("Resources")
            .join("bootstrapper"),
        modules_dir: host_bundle.join("Contents").join("modules"),
        transaction_root: updates_dir.join("transactions"),
        updates_dir,
    };
    assert_inside(&layout.state_root, &layout.updates_dir, "updatesDir")?;
    assert_inside(
        &layout.state_root,
        &layout.transaction_root,
        "transactionRoot",
    )?;
    assert_inside(
        layout.host_bundle.as_ref().expect("host bundle"),
        &layout.bootstrapper_dir,
        "bootstrapperDir",
    )?;
    Ok(layout)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "pulsesync-layout-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    }

    #[test]
    fn macos_layout_separates_state_from_bundle() {
        let root = temp_root("separate");
        let state = root.join("state");
        let bundle = root.join("Applications").join("PulseSync.app");
        let executable = bundle.join("Contents").join("MacOS").join("PulseSync");
        fs::create_dir_all(executable.parent().unwrap()).unwrap();
        fs::write(bundle.join("Contents").join("Info.plist"), b"plist").unwrap();
        fs::write(&executable, b"app").unwrap();

        let layout = resolve_macos_layout(state, bundle.clone(), executable).unwrap();
        assert_eq!(layout.layout_kind, LayoutKind::MacosBundle);
        assert_eq!(layout.host_bundle, Some(bundle.canonicalize().unwrap()));
        assert!(is_inside(&layout.state_root, &layout.transaction_root));
        assert!(!is_inside(&layout.state_root, &layout.app_executable));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn macos_layout_rejects_state_inside_bundle() {
        let root = temp_root("nested");
        let bundle = root.join("PulseSync.app");
        let executable = bundle.join("Contents").join("MacOS").join("PulseSync");
        fs::create_dir_all(executable.parent().unwrap()).unwrap();
        fs::write(bundle.join("Contents").join("Info.plist"), b"plist").unwrap();
        fs::write(&executable, b"app").unwrap();

        assert!(
            resolve_macos_layout(
                bundle.join("Contents").join("updates-state"),
                bundle.clone(),
                executable,
            )
            .is_err()
        );
        fs::remove_dir_all(root).unwrap();
    }
}
