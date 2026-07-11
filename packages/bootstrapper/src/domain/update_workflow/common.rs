use super::{PrepareUpdateOptions, SESSION_LOCK_TIMEOUT, UpdateWorkflowError};
use crate::core::{
    active_app::{ActiveAppLeaseState, verified_live_lease},
    error::Result as CoreResult,
    layout::{Layout, LayoutKind, resolve_layout, resolve_macos_layout},
    path_segment::sanitize_path_segment,
    self_update::{SelfUpdateMutationGate, reconcile_self_update_mutation},
    session_lock::SessionLock,
};
use serde_json::Value;
use std::path::{Component, Path, PathBuf};

pub(super) fn workflow_error(
    command: &'static str,
    code: &str,
    phase: &'static str,
    error: impl std::fmt::Display,
    retryable: bool,
    safe_to_continue: bool,
) -> UpdateWorkflowError {
    UpdateWorkflowError::new(
        command,
        code,
        phase,
        error.to_string(),
        retryable,
        safe_to_continue,
    )
}

pub(super) fn reject_live_self_update(
    install_root: &Path,
    command: &'static str,
    safe_to_continue: bool,
) -> std::result::Result<(), UpdateWorkflowError> {
    let _session_lock =
        SessionLock::acquire(install_root, SESSION_LOCK_TIMEOUT).map_err(|error| {
            workflow_error(
                command,
                "session-lock-failed",
                "lock",
                error,
                true,
                safe_to_continue,
            )
        })?;
    match reconcile_self_update_mutation(install_root).map_err(|error| {
        workflow_error(
            command,
            "self-update-reservation-invalid",
            "lock",
            error,
            false,
            safe_to_continue,
        )
    })? {
        SelfUpdateMutationGate::Busy(result) => Err(workflow_error(
            command,
            "self-update-busy",
            "lock",
            format!(
                "self-update handoff {} is owned by child {}",
                result.id, result.child_pid
            ),
            true,
            safe_to_continue,
        )),
        SelfUpdateMutationGate::Clear => Ok(()),
    }
}

pub(super) fn paths_match(left: &Path, right: &Path) -> bool {
    let left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
    if cfg!(windows) {
        left.to_string_lossy()
            .replace('/', "\\")
            .eq_ignore_ascii_case(&right.to_string_lossy().replace('/', "\\"))
    } else {
        left == right
    }
}

pub(super) fn value_path(value: &Value, key: &str) -> Option<PathBuf> {
    value.get(key).and_then(Value::as_str).map(PathBuf::from)
}

pub(super) fn scoped_update_path(
    root: &Path,
    channel: &str,
    target_version: &str,
    dist: &str,
) -> Option<PathBuf> {
    Some(
        root.join(sanitize_path_segment(channel).ok()?)
            .join(sanitize_path_segment(target_version).ok()?)
            .join(sanitize_path_segment(dist).ok()?),
    )
}

pub(super) fn current_install_is_safe(layout: &Layout, installed_version: Option<&str>) -> bool {
    if layout.layout_kind == LayoutKind::MacosBundle {
        return layout
            .host_bundle
            .as_ref()
            .is_some_and(|bundle| bundle.join("Contents").join("Info.plist").is_file())
            && layout.app_executable.is_file();
    }
    let Ok(state) = crate::core::install_state::read_install_state(&layout.install_root) else {
        return false;
    };
    let core_version = state
        .active
        .components
        .get("desktopCore")
        .map(|value| value.version.as_str());
    installed_version.is_none_or(|expected| core_version == Some(expected))
        && layout.install_state_file.is_file()
        && layout.app_executable.is_file()
}

pub(super) fn resolve_options_layout(
    options: &PrepareUpdateOptions,
    state_root: PathBuf,
) -> CoreResult<Layout> {
    match (&options.host_bundle, &options.app_executable) {
        (Some(host_bundle), Some(app_executable)) => {
            resolve_macos_layout(state_root, host_bundle.clone(), app_executable.clone())
        }
        (None, None) => resolve_layout(state_root, options.app_executable_name.clone()),
        _ => Err("--host-bundle and --app-executable must be provided together".into()),
    }
}

pub(super) fn relative_executable_name_is_safe(value: &str) -> bool {
    let path = Path::new(value);
    !value.trim().is_empty()
        && !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

pub(super) fn input_segment_is_safe(value: &str) -> bool {
    sanitize_path_segment(value)
        .ok()
        .is_some_and(|sanitized| sanitized == value)
}

pub(super) fn is_http_source(value: &str) -> bool {
    value.starts_with("https://") || value.starts_with("http://")
}

pub(super) fn active_lease_matches(layout: &Layout, lease_id: &str) -> CoreResult<bool> {
    let _session_lock = SessionLock::acquire(&layout.install_root, SESSION_LOCK_TIMEOUT)?;
    let Some(lease) = verified_live_lease(&layout.install_root)? else {
        return Ok(false);
    };
    Ok(lease.state == ActiveAppLeaseState::Active
        && lease.lease_id == lease_id
        && paths_match(&lease.executable, &layout.app_executable))
}
