use crate::core::{error::Result, path_segment::sanitize_path_segment};
use serde::Deserialize;
use serde::Serialize;
use serde_json::json;
use std::{
    env, fs,
    path::Component,
    path::{Path, PathBuf},
};

const CURRENT_VERSION_FILE_NAME: &str = "current.json";
pub const DEFAULT_RETAIN_APP_VERSIONS: usize = 2;
pub const MIN_RETAIN_APP_VERSIONS: usize = 2;

#[derive(Debug, Deserialize)]
struct CurrentVersionPointer {
    #[serde(rename = "schemaVersion")]
    schema_version: Option<u64>,
    version: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Layout {
    #[serde(rename = "installRoot")]
    pub install_root: PathBuf,
    #[serde(rename = "currentVersionFile")]
    pub current_version_file: PathBuf,
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

fn default_app_executable_name() -> &'static str {
    if cfg!(windows) {
        "PulseSync.exe"
    } else {
        "PulseSync"
    }
}

pub fn current_version_file(install_root: &Path) -> PathBuf {
    install_root.join(CURRENT_VERSION_FILE_NAME)
}

pub fn versioned_app_dir(install_root: &Path, version: &str) -> Result<PathBuf> {
    Ok(install_root.join(format!("app-{}", sanitize_path_segment(version)?)))
}

pub fn versioned_modules_dir(install_root: &Path, version: &str) -> Result<PathBuf> {
    Ok(versioned_app_dir(install_root, version)?.join("modules"))
}

pub fn read_current_version(install_root: &Path) -> Result<Option<String>> {
    let path = current_version_file(install_root);
    if !path.is_file() {
        return Ok(None);
    }

    let pointer: CurrentVersionPointer = serde_json::from_slice(&fs::read(&path)?)?;
    if let Some(schema_version) = pointer.schema_version
        && schema_version != 1
    {
        return Err(format!(
            "unsupported current version pointer schemaVersion {schema_version}: {}",
            path.display()
        )
        .into());
    }

    if pointer.version.trim().is_empty() {
        return Err(format!(
            "current version pointer has empty version: {}",
            path.display()
        )
        .into());
    }

    Ok(Some(pointer.version))
}

pub fn write_current_version(install_root: &Path, version: &str) -> Result<PathBuf> {
    let current_file = current_version_file(install_root);
    let temp_file = current_file.with_extension(format!("json.tmp-{}", std::process::id()));
    let payload = json!({
        "schemaVersion": 1,
        "version": version,
    });

    if let Some(parent) = current_file.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(
        &temp_file,
        format!("{}\n", serde_json::to_string_pretty(&payload)?),
    )?;
    fs::rename(&temp_file, &current_file)?;
    Ok(current_file)
}

pub fn clear_current_version(install_root: &Path) -> Result<Option<PathBuf>> {
    let current_file = current_version_file(install_root);
    if !current_file.exists() {
        return Ok(None);
    }
    fs::remove_file(&current_file)?;
    Ok(Some(current_file))
}

pub fn normalize_retain_app_versions(value: usize) -> usize {
    value.max(MIN_RETAIN_APP_VERSIONS)
}

struct AppVersionCandidate {
    is_previous: bool,
    modified: std::time::SystemTime,
    path: PathBuf,
}

pub fn cleanup_inactive_app_versions(
    install_root: &Path,
    active_version: &str,
    previous_version: Option<&str>,
    retain_app_versions: usize,
) -> Result<Vec<PathBuf>> {
    let active_dir = versioned_app_dir(install_root, active_version)?;
    let previous_dir = previous_version
        .map(|version| versioned_app_dir(install_root, version))
        .transpose()?;
    let mut removed = Vec::new();
    let mut candidates = Vec::new();
    let retain_inactive_versions = normalize_retain_app_versions(retain_app_versions)
        .saturating_sub(2)
        + usize::from(previous_dir.is_some());

    if !install_root.is_dir() {
        return Ok(removed);
    }

    for entry in fs::read_dir(install_root)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if !name.starts_with("app-") || path == active_dir {
            continue;
        }

        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(std::time::UNIX_EPOCH);
        candidates.push(AppVersionCandidate {
            is_previous: previous_dir
                .as_ref()
                .is_some_and(|previous| &path == previous),
            modified,
            path,
        });
    }

    candidates.sort_by(|left, right| {
        right
            .is_previous
            .cmp(&left.is_previous)
            .then_with(|| right.modified.cmp(&left.modified))
            .then_with(|| {
                left.path
                    .to_string_lossy()
                    .cmp(&right.path.to_string_lossy())
            })
    });

    for candidate in candidates.into_iter().skip(retain_inactive_versions) {
        let path = candidate.path;

        assert_inside(install_root, &path, "inactive app version")?;
        fs::remove_dir_all(&path)?;
        removed.push(path);
    }

    Ok(removed)
}

fn absolute_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        return path.to_path_buf();
    }

    env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(path)
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
    let install_root = install_root.canonicalize().unwrap_or(install_root);
    let app_executable_name =
        app_executable_name.unwrap_or_else(|| default_app_executable_name().to_string());
    let current_version_file = current_version_file(&install_root);
    let current_version = read_current_version(&install_root)?;
    let app_dir = match current_version.as_deref() {
        Some(version) => versioned_app_dir(&install_root, version)?,
        None => install_root.join("app"),
    };
    let modules_dir = match current_version.as_deref() {
        Some(version) => versioned_modules_dir(&install_root, version)?,
        None => install_root.join("modules"),
    };
    let updates_dir = install_root.join("updates");
    let layout = Layout {
        app_executable: app_dir.join(&app_executable_name),
        bootstrapper_dir: install_root.join("bootstrapper"),
        transaction_root: updates_dir.join("transactions"),
        install_root,
        current_version_file,
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
        &layout.current_version_file,
        "currentVersionFile",
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
