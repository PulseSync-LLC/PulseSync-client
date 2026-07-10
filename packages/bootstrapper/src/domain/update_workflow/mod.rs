mod error;
mod model;

pub use error::UpdateWorkflowError;
pub use model::{
    DiscardPreparedUpdateResult, DiscardReason, EffectiveManifestSource, PrepareUpdateResult,
    PreparedTransactionRef, RemovedPreparedState, RequestedManifestSource, UpdateDecision,
    UpdatePolicy,
};

use crate::{
    core::{
        active_app::{ActiveAppLeaseState, verified_live_lease, write_json_atomic},
        error::Result as CoreResult,
        fs_ops::sha256_file,
        layout::{
            Layout, assert_inside, canonical_install_root, is_inside,
            normalize_retain_app_versions, read_current_version, resolve_layout, versioned_app_dir,
            versioned_modules_dir,
        },
        operation_lock::UpdateLock,
        path_segment::sanitize_path_segment,
        self_update::{SelfUpdateMutationGate, reconcile_self_update_mutation},
        session_lock::SessionLock,
    },
    domain::{
        artifacts::{ArtifactKey, artifact_file_name, stage_artifacts},
        install_plan::{create_install_plan, default_install_artifact_keys},
        install_workflow::events::{InstallProgressReporter, InstallWorkflowEvent},
        manifest::{
            BootstrapperArtifact, BootstrapperUpdateDecision, BootstrapperUpdateManifest,
            DEFAULT_GITHUB_OWNER, DEFAULT_GITHUB_REPO, GitHubManifestFallback, artifact_for_key,
            decide_update, github_manifest_url, health_check_available, read_source,
            validate_manifest,
        },
        transactions::{
            TransactionRecord, prepare_transaction_file_at, prepared_transactions,
            transaction_artifacts, transaction_records, transactions_with_id,
        },
    },
};
use node_semver::{Range, Version};
use serde_json::{Value, to_value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Component, Path, PathBuf},
    time::Duration,
};
use uuid::Uuid;

const PREPARE_COMMAND: &str = "prepare-update";
const DISCARD_COMMAND: &str = "discard-prepared-update";
const UPDATE_LOCK_TIMEOUT: Duration = Duration::from_secs(10);
const SESSION_LOCK_TIMEOUT: Duration = Duration::from_secs(10);

pub struct PrepareUpdateOptions {
    pub install_root: PathBuf,
    pub app_executable_name: Option<String>,
    pub installed_version: String,
    pub dist: String,
    pub channel: String,
    pub requested_source: RequestedManifestSource,
    pub manifest_url: Option<String>,
    pub server_health_url: Option<String>,
    pub github_owner: String,
    pub github_repo: String,
    pub staging_dir: Option<PathBuf>,
    pub retain_app_versions: usize,
    pub active_lease_id: String,
}

fn workflow_error(
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

fn reject_live_self_update(
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

fn paths_match(left: &Path, right: &Path) -> bool {
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

fn current_install_is_safe(layout: &Layout, installed_version: Option<&str>) -> bool {
    let Some(current_version) = layout.current_version.as_deref() else {
        return false;
    };
    if installed_version.is_some_and(|expected| expected != current_version) {
        return false;
    }
    layout.current_version_file.is_file()
        && layout.app_executable.is_file()
        && read_current_version(&layout.install_root)
            .ok()
            .flatten()
            .as_deref()
            == Some(current_version)
}

fn relative_executable_name_is_safe(value: &str) -> bool {
    let path = Path::new(value);
    !value.trim().is_empty()
        && !path.is_absolute()
        && path
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir))
}

fn input_segment_is_safe(value: &str) -> bool {
    sanitize_path_segment(value)
        .ok()
        .is_some_and(|sanitized| sanitized == value)
}

fn is_http_source(value: &str) -> bool {
    value.starts_with("https://") || value.starts_with("http://")
}

fn active_lease_matches(layout: &Layout, lease_id: &str) -> CoreResult<bool> {
    let _session_lock = SessionLock::acquire(&layout.install_root, SESSION_LOCK_TIMEOUT)?;
    let Some(lease) = verified_live_lease(&layout.install_root)? else {
        return Ok(false);
    };
    Ok(lease.state == ActiveAppLeaseState::Active
        && lease.lease_id == lease_id
        && paths_match(&lease.executable, &layout.app_executable))
}

fn resolve_effective_source(
    options: &PrepareUpdateOptions,
    safe_to_continue: bool,
) -> std::result::Result<EffectiveManifestSource, UpdateWorkflowError> {
    let fallback = || GitHubManifestFallback {
        channel: options.channel.clone(),
        dist: options.dist.clone(),
        health_url: options.server_health_url.clone().unwrap_or_default(),
        owner: options.github_owner.clone(),
        repo: options.github_repo.clone(),
    };

    match options.requested_source {
        RequestedManifestSource::Backend => {
            let manifest_url = options
                .manifest_url
                .clone()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    workflow_error(
                        PREPARE_COMMAND,
                        "missing-manifest-url",
                        "validate-input",
                        "backend source requires --manifest-url",
                        false,
                        safe_to_continue,
                    )
                })?;
            let health_url = options
                .server_health_url
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    workflow_error(
                        PREPARE_COMMAND,
                        "missing-server-health-url",
                        "validate-input",
                        "backend source requires --server-health-url",
                        false,
                        safe_to_continue,
                    )
                })?;
            if !is_http_source(&manifest_url) || !is_http_source(health_url) {
                return Err(workflow_error(
                    PREPARE_COMMAND,
                    "invalid-backend-source",
                    "validate-input",
                    "backend manifest and health sources must use http(s)",
                    false,
                    safe_to_continue,
                ));
            }
            if health_check_available(health_url) {
                return Ok(EffectiveManifestSource {
                    requested: RequestedManifestSource::Backend,
                    effective: RequestedManifestSource::Backend,
                    url: manifest_url,
                    fallback_used: false,
                    fallback_reason: None,
                });
            }
            let url = github_manifest_url(&fallback()).map_err(|error| {
                workflow_error(
                    PREPARE_COMMAND,
                    "github-manifest-resolution-failed",
                    "resolve-source",
                    error,
                    true,
                    safe_to_continue,
                )
            })?;
            Ok(EffectiveManifestSource {
                requested: RequestedManifestSource::Backend,
                effective: RequestedManifestSource::Github,
                url,
                fallback_used: true,
                fallback_reason: Some("health-unavailable".to_string()),
            })
        }
        RequestedManifestSource::Github => {
            let url = github_manifest_url(&fallback()).map_err(|error| {
                workflow_error(
                    PREPARE_COMMAND,
                    "github-manifest-resolution-failed",
                    "resolve-source",
                    error,
                    true,
                    safe_to_continue,
                )
            })?;
            Ok(EffectiveManifestSource {
                requested: RequestedManifestSource::Github,
                effective: RequestedManifestSource::Github,
                url,
                fallback_used: false,
                fallback_reason: Some("requested-github".to_string()),
            })
        }
        RequestedManifestSource::Direct => {
            if !cfg!(debug_assertions) && options.channel != "dev" {
                return Err(workflow_error(
                    PREPARE_COMMAND,
                    "direct-source-not-allowed",
                    "validate-input",
                    "direct source is restricted to explicit dev/test invocations",
                    false,
                    safe_to_continue,
                ));
            }
            let url = options
                .manifest_url
                .clone()
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    workflow_error(
                        PREPARE_COMMAND,
                        "missing-manifest-url",
                        "validate-input",
                        "direct source requires --manifest-url",
                        false,
                        safe_to_continue,
                    )
                })?;
            Ok(EffectiveManifestSource {
                requested: RequestedManifestSource::Direct,
                effective: RequestedManifestSource::Direct,
                url,
                fallback_used: false,
                fallback_reason: None,
            })
        }
    }
}

fn evaluate_policy(
    manifest: &BootstrapperUpdateManifest,
    current_version: &str,
    update_available: bool,
) -> UpdatePolicy {
    let current = Version::parse(current_version).ok();
    let mut invalid_ranges = Vec::new();
    let mut matched_range = None;
    for deprecated_range in manifest.deprecated_versions.iter().flatten() {
        match Range::parse(deprecated_range) {
            Ok(range) => {
                if matched_range.is_none()
                    && current
                        .as_ref()
                        .is_some_and(|version| range.satisfies(version))
                {
                    matched_range = Some(deprecated_range.clone());
                }
            }
            Err(_) => invalid_ranges.push(deprecated_range.clone()),
        }
    }
    let current_version_deprecated = matched_range.is_some();
    let forced = current_version_deprecated && update_available;
    UpdatePolicy {
        current_version_deprecated,
        matched_deprecated_range: matched_range,
        invalid_deprecated_ranges: invalid_ranges,
        forced,
        force_reason: forced.then(|| "deprecated-version".to_string()),
        min_client_version: manifest.min_client_version.clone(),
    }
}

fn public_decision(
    decision: &BootstrapperUpdateDecision,
    manifest: &BootstrapperUpdateManifest,
) -> UpdateDecision {
    UpdateDecision {
        reason: decision.reason.clone(),
        channel: decision.channel.clone(),
        dist: decision.dist.clone(),
        current_version: decision.current_version.clone(),
        target_version: decision.target_version.clone(),
        update_available: decision.update_available,
        policy: evaluate_policy(
            manifest,
            &decision.current_version,
            decision.update_available,
        ),
    }
}

fn value_path(value: &Value, key: &str) -> Option<PathBuf> {
    value.get(key).and_then(Value::as_str).map(PathBuf::from)
}

fn artifact_map(
    decision: &BootstrapperUpdateDecision,
) -> BTreeMap<String, (ArtifactKey, BootstrapperArtifact)> {
    let mut artifacts = BTreeMap::new();
    let Some(dist_artifacts) = decision.artifacts.as_ref() else {
        return artifacts;
    };
    for key in default_install_artifact_keys(Some(dist_artifacts)) {
        if let Some(artifact) = artifact_for_key(dist_artifacts, &key) {
            artifacts.insert(key.as_str(), (key, artifact.clone()));
        }
    }
    artifacts
}

fn scoped_update_path(
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

fn bootstrapper_executable_name() -> &'static str {
    if cfg!(windows) {
        "pulsesync-bootstrapper.exe"
    } else {
        "pulsesync-bootstrapper"
    }
}

fn expected_target_path(
    layout: &Layout,
    target_version: &str,
    key: &ArtifactKey,
) -> Option<PathBuf> {
    match key {
        ArtifactKey::App => versioned_app_dir(&layout.install_root, target_version).ok(),
        ArtifactKey::Module(module_name) => {
            versioned_modules_dir(&layout.install_root, target_version)
                .ok()
                .map(|path| path.join(module_name))
        }
        ArtifactKey::Bootstrapper => {
            Some(layout.bootstrapper_dir.join(bootstrapper_executable_name()))
        }
    }
}

fn expected_backup_path(backup_dir: &Path, key: &ArtifactKey) -> Option<PathBuf> {
    match key {
        ArtifactKey::App => Some(backup_dir.join("app")),
        ArtifactKey::Module(module_name) => Some(backup_dir.join("modules").join(module_name)),
        ArtifactKey::Bootstrapper => Some(
            backup_dir
                .join("bootstrapper")
                .join(bootstrapper_executable_name()),
        ),
    }
}

fn expected_prepared_path(
    transaction_dir: &Path,
    source_path: &Path,
    key: &ArtifactKey,
) -> Option<PathBuf> {
    let name = match key {
        ArtifactKey::App => "app.zip".to_string(),
        ArtifactKey::Module(module_name) => {
            format!("module-{}.zip", sanitize_path_segment(module_name).ok()?)
        }
        ArtifactKey::Bootstrapper => source_path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("bootstrapper.artifact")
            .to_string(),
    };
    Some(transaction_dir.join("prepared").join(name))
}

fn transaction_matches(
    record: &TransactionRecord,
    decision: &BootstrapperUpdateDecision,
    layout: &Layout,
    retain_app_versions: usize,
    lease_id: &str,
) -> bool {
    let value = &record.value;
    let Some(transaction_id) = value.get("transactionId").and_then(Value::as_str) else {
        return false;
    };
    if value.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || record.candidate.state != "prepared"
        || Uuid::parse_str(transaction_id).is_err()
        || value.get("prepared").and_then(Value::as_bool) != Some(true)
        || value.get("channel").and_then(Value::as_str) != Some(decision.channel.as_str())
        || value.get("dist").and_then(Value::as_str) != Some(decision.dist.as_str())
        || value.get("currentVersion").and_then(Value::as_str)
            != Some(decision.current_version.as_str())
        || value.get("targetVersion").and_then(Value::as_str)
            != Some(decision.target_version.as_str())
        || value.get("retainAppVersions").and_then(Value::as_u64)
            != Some(retain_app_versions as u64)
        || value.get("applyDeferredByLeaseId").and_then(Value::as_str) != Some(lease_id)
    {
        return false;
    }

    let Some(transaction_dir) = value_path(value, "transactionDir") else {
        return false;
    };
    let Some(actual_dir) = record.candidate.path.parent() else {
        return false;
    };
    let Some(expected_transaction_dir) = scoped_update_path(
        &layout.transaction_root,
        &decision.channel,
        &decision.target_version,
        &decision.dist,
    )
    .map(|path| path.join(transaction_id)) else {
        return false;
    };
    let Some(staging_dir) = value_path(value, "stagingDir") else {
        return false;
    };
    let Some(staging_root) = staging_dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
    else {
        return false;
    };
    let Some(expected_staging_dir) = scoped_update_path(
        &staging_root,
        &decision.channel,
        &decision.target_version,
        &decision.dist,
    ) else {
        return false;
    };
    let Some(expected_backup_dir) = scoped_update_path(
        &staging_root.join("backups"),
        &decision.channel,
        &decision.target_version,
        &decision.dist,
    ) else {
        return false;
    };
    let Some(backup_dir) = value_path(value, "backupDir") else {
        return false;
    };
    if !paths_match(&transaction_dir, actual_dir)
        || !paths_match(actual_dir, &expected_transaction_dir)
        || actual_dir.file_name().and_then(|value| value.to_str()) != Some(transaction_id)
        || !is_inside(&layout.transaction_root, actual_dir)
        || value_path(value, "installDir")
            .is_none_or(|path| !paths_match(&path, &layout.install_root))
        || !paths_match(&staging_dir, &expected_staging_dir)
        || !is_inside(&layout.updates_dir, &staging_dir)
        || !paths_match(&backup_dir, &expected_backup_dir)
        || !is_inside(&layout.updates_dir, &backup_dir)
        || value_path(value, "planFile")
            .is_none_or(|path| !paths_match(&path, &staging_dir.join("install-plan.json")))
    {
        return false;
    }

    let expected = artifact_map(decision);
    let Ok(actual) = transaction_artifacts(value) else {
        return false;
    };
    if actual.len() != expected.len() {
        return false;
    }
    let mut seen_keys = BTreeSet::new();
    for artifact in actual {
        if !seen_keys.insert(artifact.key.clone()) {
            return false;
        }
        let Some((key, expected_artifact)) = expected.get(&artifact.key) else {
            return false;
        };
        let Ok(source_file_name) = artifact_file_name(expected_artifact, key) else {
            return false;
        };
        let expected_source_path = staging_dir.join(source_file_name);
        let Some(expected_target_path) =
            expected_target_path(layout, &decision.target_version, key)
        else {
            return false;
        };
        let Some(expected_backup_path) = expected_backup_path(&backup_dir, key) else {
            return false;
        };
        let Some(expected_prepared_path) =
            expected_prepared_path(actual_dir, &expected_source_path, key)
        else {
            return false;
        };
        let expected_action = if matches!(key, ArtifactKey::Bootstrapper) {
            "replace-file"
        } else {
            "replace-directory-archive"
        };
        let expected_prepared_kind = if matches!(key, ArtifactKey::Bootstrapper) {
            "file"
        } else {
            "archive"
        };
        if artifact.action != expected_action
            || artifact.prepared_kind != expected_prepared_kind
            || !paths_match(&artifact.source_path, &expected_source_path)
            || !paths_match(&artifact.target_path, &expected_target_path)
            || !paths_match(&artifact.backup_path, &expected_backup_path)
            || !paths_match(&artifact.prepared_path, &expected_prepared_path)
            || artifact.sha256.to_lowercase() != expected_artifact.sha256.to_lowercase()
            || expected_artifact
                .size
                .is_some_and(|size| size != artifact.size)
            || !is_inside(actual_dir, &artifact.prepared_path)
            || fs::metadata(&artifact.prepared_path)
                .ok()
                .is_none_or(|metadata| !metadata.is_file() || metadata.len() != artifact.size)
            || sha256_file(&artifact.prepared_path)
                .ok()
                .is_none_or(|sha256| sha256.to_lowercase() != artifact.sha256.to_lowercase())
        {
            return false;
        }
    }
    seen_keys.len() == expected.len()
}

fn prepared_ref(record: &TransactionRecord) -> Option<PreparedTransactionRef> {
    let id = record.value.get("transactionId")?.as_str()?.to_string();
    let dir = record.candidate.path.parent()?.to_path_buf();
    Some(PreparedTransactionRef {
        id,
        dir,
        file: record.candidate.path.clone(),
    })
}

pub fn prepare_update(
    options: PrepareUpdateOptions,
    reporter: &dyn InstallProgressReporter,
) -> std::result::Result<PrepareUpdateResult, UpdateWorkflowError> {
    if !matches!(options.channel.as_str(), "beta" | "dev")
        || !input_segment_is_safe(&options.dist)
        || !input_segment_is_safe(&options.github_owner)
        || !input_segment_is_safe(&options.github_repo)
        || options.active_lease_id.trim().is_empty()
        || Uuid::parse_str(&options.active_lease_id).is_err()
        || options
            .app_executable_name
            .as_deref()
            .is_some_and(|value| !relative_executable_name_is_safe(value))
    {
        return Err(workflow_error(
            PREPARE_COMMAND,
            "invalid-argument",
            "validate-input",
            "prepare-update received an invalid channel, dist, lease id, or executable name",
            false,
            false,
        ));
    }

    let install_root = canonical_install_root(&options.install_root).map_err(|error| {
        workflow_error(
            PREPARE_COMMAND,
            "unsafe-install-root",
            "validate-input",
            error,
            false,
            false,
        )
    })?;
    let prelock_layout =
        resolve_layout(install_root.clone(), options.app_executable_name.clone()).ok();
    let prelock_safe = prelock_layout
        .as_ref()
        .is_some_and(|layout| current_install_is_safe(layout, Some(&options.installed_version)));
    let _update_lock =
        UpdateLock::acquire(&install_root, UPDATE_LOCK_TIMEOUT).map_err(|error| {
            workflow_error(
                PREPARE_COMMAND,
                "update-busy",
                "lock",
                error,
                true,
                prelock_safe,
            )
        })?;
    reject_live_self_update(&install_root, PREPARE_COMMAND, prelock_safe)?;
    let layout = match resolve_layout(install_root, options.app_executable_name.clone()) {
        Ok(layout) => layout,
        Err(_) => {
            return Ok(PrepareUpdateResult::blocked(
                None,
                None,
                "unsafe-layout",
                false,
                false,
                vec!["current-version-pointer".to_string()],
            ));
        }
    };
    let safe_to_continue = current_install_is_safe(&layout, Some(&options.installed_version));

    if layout.current_version.as_deref() != Some(options.installed_version.as_str()) {
        return Ok(PrepareUpdateResult::blocked(
            None,
            None,
            "installed-version-mismatch",
            false,
            current_install_is_safe(&layout, None),
            vec!["current-version".to_string()],
        ));
    }
    if !safe_to_continue {
        return Ok(PrepareUpdateResult::blocked(
            None,
            None,
            "unsafe-layout",
            false,
            false,
            vec!["current-executable".to_string()],
        ));
    }
    if !active_lease_matches(&layout, &options.active_lease_id).map_err(|error| {
        workflow_error(
            PREPARE_COMMAND,
            "session-lock-failed",
            "lock",
            error,
            true,
            safe_to_continue,
        )
    })? {
        return Ok(PrepareUpdateResult::blocked(
            None,
            None,
            "active-lease-mismatch",
            true,
            safe_to_continue,
            vec!["active-lease".to_string()],
        ));
    }

    fs::create_dir_all(&layout.updates_dir).map_err(|error| {
        workflow_error(
            PREPARE_COMMAND,
            "updates-directory-failed",
            "validate-input",
            error,
            false,
            safe_to_continue,
        )
    })?;
    let updates_dir = layout.updates_dir.canonicalize().map_err(|error| {
        workflow_error(
            PREPARE_COMMAND,
            "updates-directory-failed",
            "validate-input",
            error,
            false,
            safe_to_continue,
        )
    })?;
    if !is_inside(&layout.install_root, &updates_dir)
        || !is_inside(&updates_dir, &layout.transaction_root)
    {
        return Ok(PrepareUpdateResult::blocked(
            None,
            None,
            "unsafe-layout",
            false,
            safe_to_continue,
            vec!["updates-layout-contained".to_string()],
        ));
    }
    let requested_staging = options
        .staging_dir
        .clone()
        .unwrap_or_else(|| updates_dir.join("staging"));
    if !requested_staging.is_absolute() {
        return Ok(PrepareUpdateResult::blocked(
            None,
            None,
            "unsafe-layout",
            false,
            safe_to_continue,
            vec!["staging-dir-contained".to_string()],
        ));
    }
    fs::create_dir_all(&requested_staging).map_err(|error| {
        workflow_error(
            PREPARE_COMMAND,
            "staging-directory-failed",
            "validate-input",
            error,
            false,
            safe_to_continue,
        )
    })?;
    let staging_root = requested_staging.canonicalize().map_err(|error| {
        workflow_error(
            PREPARE_COMMAND,
            "staging-directory-failed",
            "validate-input",
            error,
            false,
            safe_to_continue,
        )
    })?;
    let discard_root = updates_dir.join("discarded");
    if staging_root == updates_dir
        || !is_inside(&updates_dir, &staging_root)
        || is_inside(&layout.transaction_root, &staging_root)
        || is_inside(&discard_root, &staging_root)
    {
        return Ok(PrepareUpdateResult::blocked(
            None,
            None,
            "unsafe-layout",
            false,
            safe_to_continue,
            vec!["staging-dir-contained".to_string()],
        ));
    }

    reporter.emit(InstallWorkflowEvent::stage(
        "resolving-source",
        "Resolving update source",
    ));
    let source = resolve_effective_source(&options, safe_to_continue)?;
    reporter.emit(InstallWorkflowEvent::stage(
        "checking",
        "Checking update manifest",
    ));
    let manifest_bytes = read_source(&source.url).map_err(|error| {
        workflow_error(
            PREPARE_COMMAND,
            "manifest-fetch-failed",
            "fetch-manifest",
            error,
            true,
            safe_to_continue,
        )
    })?;
    let manifest: BootstrapperUpdateManifest =
        serde_json::from_slice(&manifest_bytes).map_err(|error| {
            workflow_error(
                PREPARE_COMMAND,
                "manifest-json-invalid",
                "validate-manifest",
                error,
                false,
                safe_to_continue,
            )
        })?;
    validate_manifest(&manifest).map_err(|error| {
        workflow_error(
            PREPARE_COMMAND,
            "manifest-invalid",
            "validate-manifest",
            error,
            false,
            safe_to_continue,
        )
    })?;
    let decision = decide_update(&manifest, &options.installed_version, &options.dist);
    let public_decision = public_decision(&decision, &manifest);

    if manifest.channel != options.channel {
        return Ok(PrepareUpdateResult::blocked(
            Some(public_decision),
            Some(source),
            "channel-mismatch",
            false,
            safe_to_continue,
            vec!["manifest-channel".to_string()],
        ));
    }
    match decision.reason.as_str() {
        "missing-dist-artifacts" | "invalid-version" => {
            let reason = decision.reason.clone();
            return Ok(PrepareUpdateResult::blocked(
                Some(public_decision),
                Some(source),
                reason,
                false,
                safe_to_continue,
                vec!["update-decision".to_string()],
            ));
        }
        "up-to-date" => return Ok(PrepareUpdateResult::up_to_date(public_decision, source)),
        "update-available" => {}
        other => {
            return Err(workflow_error(
                PREPARE_COMMAND,
                "unexpected-update-decision",
                "decide",
                format!("unexpected update decision reason: {other}"),
                false,
                safe_to_continue,
            ));
        }
    }

    let retain_app_versions = normalize_retain_app_versions(options.retain_app_versions);
    let pending = prepared_transactions(&layout.transaction_root).map_err(|error| {
        workflow_error(
            PREPARE_COMMAND,
            "transaction-scan-failed",
            "prepare",
            error,
            false,
            safe_to_continue,
        )
    })?;
    if !pending.is_empty() {
        if pending.len() == 1
            && transaction_matches(
                &pending[0],
                &decision,
                &layout,
                retain_app_versions,
                &options.active_lease_id,
            )
            && active_lease_matches(&layout, &options.active_lease_id).map_err(|error| {
                workflow_error(
                    PREPARE_COMMAND,
                    "session-lock-failed",
                    "lock",
                    error,
                    true,
                    safe_to_continue,
                )
            })?
            && let Some(transaction) = prepared_ref(&pending[0])
        {
            return Ok(PrepareUpdateResult::prepared(
                public_decision,
                source,
                true,
                transaction,
                options.active_lease_id,
            ));
        }
        return Ok(PrepareUpdateResult::blocked(
            None,
            None,
            "pending-transaction-exists",
            true,
            safe_to_continue,
            pending
                .iter()
                .filter_map(|record| record.value.get("transactionId").and_then(Value::as_str))
                .map(|id| format!("pending-transaction:{id}"))
                .collect(),
        ));
    }

    reporter.emit(InstallWorkflowEvent::stage(
        "downloading",
        "Downloading update artifacts",
    ));
    let artifact_keys = default_install_artifact_keys(decision.artifacts.as_ref());
    stage_artifacts(&decision, &staging_root, artifact_keys.clone(), reporter).map_err(
        |error| {
            workflow_error(
                PREPARE_COMMAND,
                "artifact-download-failed",
                "download",
                error,
                true,
                safe_to_continue,
            )
        },
    )?;

    reporter.emit(InstallWorkflowEvent::stage(
        "planning",
        "Creating update plan",
    ));
    let plan = create_install_plan(
        &decision,
        &layout.install_root,
        &staging_root,
        None,
        artifact_keys,
        retain_app_versions,
    )
    .map_err(|error| {
        workflow_error(
            PREPARE_COMMAND,
            "install-plan-failed",
            "plan",
            error,
            false,
            safe_to_continue,
        )
    })?;
    let blocked_checks = plan
        .preflight
        .iter()
        .filter(|check| check.status == "block")
        .map(|check| check.id.clone())
        .collect::<Vec<_>>();
    if !plan.executable || !blocked_checks.is_empty() {
        return Ok(PrepareUpdateResult::blocked(
            Some(public_decision),
            Some(source),
            "plan-preflight-blocked",
            false,
            safe_to_continue,
            blocked_checks,
        ));
    }
    let plan_file = plan.staging_dir.join("install-plan.json");
    write_json_atomic(&plan_file, &plan).map_err(|error| {
        workflow_error(
            PREPARE_COMMAND,
            "install-plan-write-failed",
            "plan",
            error,
            false,
            safe_to_continue,
        )
    })?;

    if !active_lease_matches(&layout, &options.active_lease_id).map_err(|error| {
        workflow_error(
            PREPARE_COMMAND,
            "session-lock-failed",
            "lock",
            error,
            true,
            safe_to_continue,
        )
    })? {
        return Ok(PrepareUpdateResult::blocked(
            None,
            None,
            "active-lease-mismatch",
            true,
            safe_to_continue,
            vec!["active-lease-before-prepare".to_string()],
        ));
    }

    reporter.emit(InstallWorkflowEvent::stage(
        "preparing",
        "Preparing update transaction",
    ));
    fs::create_dir_all(&layout.transaction_root).map_err(|error| {
        workflow_error(
            PREPARE_COMMAND,
            "transaction-root-failed",
            "prepare",
            error,
            false,
            safe_to_continue,
        )
    })?;
    assert_inside(
        &layout.updates_dir,
        &layout.transaction_root,
        "transaction root",
    )
    .map_err(|error| {
        workflow_error(
            PREPARE_COMMAND,
            "unsafe-transaction-root",
            "prepare",
            error,
            false,
            safe_to_continue,
        )
    })?;
    let transaction_id = Uuid::new_v4().to_string();
    let transaction_dir = layout
        .transaction_root
        .join(sanitize_path_segment(&decision.channel).map_err(|error| {
            workflow_error(
                PREPARE_COMMAND,
                "unsafe-layout",
                "prepare",
                error,
                false,
                safe_to_continue,
            )
        })?)
        .join(
            sanitize_path_segment(&decision.target_version).map_err(|error| {
                workflow_error(
                    PREPARE_COMMAND,
                    "unsafe-layout",
                    "prepare",
                    error,
                    false,
                    safe_to_continue,
                )
            })?,
        )
        .join(sanitize_path_segment(&decision.dist).map_err(|error| {
            workflow_error(
                PREPARE_COMMAND,
                "unsafe-layout",
                "prepare",
                error,
                false,
                safe_to_continue,
            )
        })?)
        .join(&transaction_id);
    let prepared = prepare_transaction_file_at(
        &plan_file,
        &layout.transaction_root,
        transaction_dir.clone(),
        transaction_id.clone(),
        &options.active_lease_id,
    )
    .map_err(|error| {
        workflow_error(
            PREPARE_COMMAND,
            "transaction-prepare-failed",
            "prepare",
            error,
            false,
            safe_to_continue,
        )
    })?;
    if prepared.get("state").and_then(Value::as_str) != Some("prepared")
        || prepared.get("prepared").and_then(Value::as_bool) != Some(true)
    {
        let check_ids = prepared
            .get("checks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|check| check.get("status").and_then(Value::as_str) == Some("block"))
            .filter_map(|check| check.get("id").and_then(Value::as_str))
            .map(str::to_string)
            .collect();
        return Ok(PrepareUpdateResult::blocked(
            Some(public_decision),
            Some(source),
            "prepare-check-blocked",
            false,
            safe_to_continue,
            check_ids,
        ));
    }
    let transaction = PreparedTransactionRef {
        id: transaction_id,
        file: transaction_dir.join("transaction.json"),
        dir: transaction_dir,
    };
    Ok(PrepareUpdateResult::prepared(
        public_decision,
        source,
        false,
        transaction,
        options.active_lease_id,
    ))
}

fn referenced_by_other_transaction(records: &[TransactionRecord], candidate: &Path) -> bool {
    records.iter().any(|record| {
        let references = ["transactionDir", "stagingDir", "backupDir", "planFile"]
            .into_iter()
            .filter_map(|key| value_path(&record.value, key))
            .chain(
                record
                    .value
                    .get("artifacts")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .flat_map(|artifact| {
                        ["sourcePath", "backupPath", "preparedPath"]
                            .into_iter()
                            .filter_map(|key| value_path(artifact, key))
                    }),
            );
        references.into_iter().any(|path| {
            paths_match(candidate, &path)
                || is_inside(candidate, &path)
                || is_inside(&path, candidate)
        })
    })
}

fn remove_contained_directory(path: &Path, root: &Path) -> CoreResult<bool> {
    if !path.exists() {
        return Ok(false);
    }
    if paths_match(path, root) || !is_inside(root, path) {
        return Err(format!(
            "refusing to remove directory outside owned root: {}",
            path.display()
        )
        .into());
    }
    fs::remove_dir_all(path)?;
    Ok(true)
}

pub fn discard_prepared_update(
    install_root: PathBuf,
    transaction_id: String,
) -> std::result::Result<DiscardPreparedUpdateResult, UpdateWorkflowError> {
    if Uuid::parse_str(&transaction_id).is_err() {
        return Err(workflow_error(
            DISCARD_COMMAND,
            "invalid-transaction-id",
            "validate-input",
            "transaction id must be a UUID",
            false,
            false,
        ));
    }
    let install_root = canonical_install_root(&install_root).map_err(|error| {
        workflow_error(
            DISCARD_COMMAND,
            "unsafe-install-root",
            "validate-input",
            error,
            false,
            false,
        )
    })?;
    let prelock_layout = resolve_layout(install_root.clone(), None).ok();
    let prelock_safe = prelock_layout
        .as_ref()
        .is_some_and(|layout| current_install_is_safe(layout, None));
    let _update_lock =
        UpdateLock::acquire(&install_root, UPDATE_LOCK_TIMEOUT).map_err(|error| {
            workflow_error(
                DISCARD_COMMAND,
                "update-busy",
                "lock",
                error,
                true,
                prelock_safe,
            )
        })?;
    reject_live_self_update(&install_root, DISCARD_COMMAND, prelock_safe)?;
    let layout = resolve_layout(install_root, None).map_err(|error| {
        workflow_error(
            DISCARD_COMMAND,
            "layout-resolution-failed",
            "validate-input",
            error,
            false,
            false,
        )
    })?;
    let safe_to_continue = current_install_is_safe(&layout, None);
    if !is_inside(&layout.install_root, &layout.updates_dir)
        || !is_inside(&layout.updates_dir, &layout.transaction_root)
    {
        return Err(workflow_error(
            DISCARD_COMMAND,
            "unsafe-transaction-layout",
            "discard",
            "update directories escape the canonical install root",
            false,
            safe_to_continue,
        ));
    }
    let mut matches =
        transactions_with_id(&layout.transaction_root, &transaction_id).map_err(|error| {
            workflow_error(
                DISCARD_COMMAND,
                "transaction-scan-failed",
                "discard",
                error,
                false,
                safe_to_continue,
            )
        })?;
    let empty_removed = RemovedPreparedState {
        transaction: false,
        staging: false,
        backup: false,
    };
    if matches.is_empty() {
        return Ok(DiscardPreparedUpdateResult {
            schema_version: 1,
            state: "not-found".to_string(),
            transaction_id,
            target_version: None,
            reason: DiscardReason {
                code: "transaction-not-found".to_string(),
                retryable: false,
                safe_to_continue,
            },
            removed: empty_removed,
        });
    }
    if matches.len() != 1 {
        return Ok(DiscardPreparedUpdateResult {
            schema_version: 1,
            state: "blocked".to_string(),
            transaction_id,
            target_version: None,
            reason: DiscardReason {
                code: "transaction-ambiguous".to_string(),
                retryable: false,
                safe_to_continue,
            },
            removed: empty_removed,
        });
    }
    let record = matches.remove(0);
    let target_version = record
        .value
        .get("targetVersion")
        .and_then(Value::as_str)
        .map(str::to_string);
    if record.candidate.state != "prepared" {
        return Ok(DiscardPreparedUpdateResult {
            schema_version: 1,
            state: "blocked".to_string(),
            transaction_id,
            target_version,
            reason: DiscardReason {
                code: "transaction-not-prepared".to_string(),
                retryable: false,
                safe_to_continue,
            },
            removed: empty_removed,
        });
    }

    let transaction_dir = record
        .candidate
        .path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            workflow_error(
                DISCARD_COMMAND,
                "unsafe-transaction-layout",
                "discard",
                "transaction file has no parent directory",
                false,
                safe_to_continue,
            )
        })?;
    let recorded_transaction_dir =
        value_path(&record.value, "transactionDir").ok_or_else(|| {
            workflow_error(
                DISCARD_COMMAND,
                "unsafe-transaction-layout",
                "discard",
                "transaction is missing transactionDir",
                false,
                safe_to_continue,
            )
        })?;
    let staging_dir = value_path(&record.value, "stagingDir").ok_or_else(|| {
        workflow_error(
            DISCARD_COMMAND,
            "unsafe-transaction-layout",
            "discard",
            "transaction is missing stagingDir",
            false,
            safe_to_continue,
        )
    })?;
    let backup_dir = value_path(&record.value, "backupDir").ok_or_else(|| {
        workflow_error(
            DISCARD_COMMAND,
            "unsafe-transaction-layout",
            "discard",
            "transaction is missing backupDir",
            false,
            safe_to_continue,
        )
    })?;
    let channel = record
        .value
        .get("channel")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            workflow_error(
                DISCARD_COMMAND,
                "unsafe-transaction-layout",
                "discard",
                "transaction is missing channel",
                false,
                safe_to_continue,
            )
        })?;
    let dist = record
        .value
        .get("dist")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            workflow_error(
                DISCARD_COMMAND,
                "unsafe-transaction-layout",
                "discard",
                "transaction is missing dist",
                false,
                safe_to_continue,
            )
        })?;
    let target_version_value = target_version.as_deref().ok_or_else(|| {
        workflow_error(
            DISCARD_COMMAND,
            "unsafe-transaction-layout",
            "discard",
            "transaction is missing targetVersion",
            false,
            safe_to_continue,
        )
    })?;
    let staging_root = staging_dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            workflow_error(
                DISCARD_COMMAND,
                "unsafe-transaction-layout",
                "discard",
                "transaction stagingDir does not have the canonical channel/version/dist shape",
                false,
                safe_to_continue,
            )
        })?;
    let backup_root = staging_root.join("backups");
    let discard_root = layout.updates_dir.join("discarded");
    let expected_transaction_dir = scoped_update_path(
        &layout.transaction_root,
        channel,
        target_version_value,
        dist,
    )
    .map(|path| path.join(&transaction_id));
    let expected_staging_dir =
        scoped_update_path(&staging_root, channel, target_version_value, dist);
    let expected_backup_dir = scoped_update_path(&backup_root, channel, target_version_value, dist);
    let plan_file = value_path(&record.value, "planFile");
    let install_dir = value_path(&record.value, "installDir");
    let artifacts = transaction_artifacts(&record.value).map_err(|error| {
        workflow_error(
            DISCARD_COMMAND,
            "unsafe-transaction-layout",
            "discard",
            error,
            false,
            safe_to_continue,
        )
    })?;
    let mut artifact_keys = BTreeSet::new();
    let artifacts_contained = !artifacts.is_empty()
        && artifacts.iter().all(|artifact| {
            artifact_keys.insert(artifact.key.clone())
                && is_inside(&transaction_dir, &artifact.prepared_path)
                && is_inside(&staging_dir, &artifact.source_path)
                && is_inside(&backup_dir, &artifact.backup_path)
                && is_inside(&layout.install_root, &artifact.target_path)
        });
    if record.value.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || record.value.get("transactionId").and_then(Value::as_str)
            != Some(transaction_id.as_str())
        || !paths_match(&transaction_dir, &recorded_transaction_dir)
        || expected_transaction_dir
            .as_ref()
            .is_none_or(|expected| !paths_match(&transaction_dir, expected))
        || transaction_dir.file_name().and_then(|value| value.to_str())
            != Some(transaction_id.as_str())
        || !is_inside(&layout.transaction_root, &transaction_dir)
        || paths_match(&staging_root, &layout.updates_dir)
        || !is_inside(&layout.updates_dir, &staging_root)
        || is_inside(&layout.transaction_root, &staging_root)
        || is_inside(&discard_root, &staging_root)
        || paths_match(&staging_dir, &staging_root)
        || !is_inside(&staging_root, &staging_dir)
        || expected_staging_dir
            .as_ref()
            .is_none_or(|expected| !paths_match(&staging_dir, expected))
        || paths_match(&backup_dir, &backup_root)
        || !is_inside(&backup_root, &backup_dir)
        || expected_backup_dir
            .as_ref()
            .is_none_or(|expected| !paths_match(&backup_dir, expected))
        || plan_file
            .as_ref()
            .is_none_or(|path| !paths_match(path, &staging_dir.join("install-plan.json")))
        || install_dir
            .as_ref()
            .is_none_or(|path| !paths_match(path, &layout.install_root))
        || !artifacts_contained
    {
        return Err(workflow_error(
            DISCARD_COMMAND,
            "unsafe-transaction-layout",
            "discard",
            "transaction paths are outside the canonical update layout",
            false,
            safe_to_continue,
        ));
    }

    fs::create_dir_all(&discard_root).map_err(|error| {
        workflow_error(
            DISCARD_COMMAND,
            "discard-quarantine-failed",
            "discard",
            error,
            false,
            safe_to_continue,
        )
    })?;
    let quarantined = discard_root.join(format!("{}-{}", transaction_id, Uuid::new_v4()));
    assert_inside(&layout.updates_dir, &quarantined, "discard quarantine").map_err(|error| {
        workflow_error(
            DISCARD_COMMAND,
            "unsafe-discard-quarantine",
            "discard",
            error,
            false,
            safe_to_continue,
        )
    })?;
    fs::rename(&transaction_dir, &quarantined).map_err(|error| {
        workflow_error(
            DISCARD_COMMAND,
            "transaction-quarantine-failed",
            "discard",
            error,
            false,
            safe_to_continue,
        )
    })?;
    let remaining = transaction_records(&layout.transaction_root).map_err(|error| {
        workflow_error(
            DISCARD_COMMAND,
            "transaction-rescan-failed",
            "discard",
            error,
            false,
            safe_to_continue,
        )
    })?;
    let remove_staging = !referenced_by_other_transaction(&remaining, &staging_dir);
    let remove_backup = !referenced_by_other_transaction(&remaining, &backup_dir);
    let staging_removed = if remove_staging {
        remove_contained_directory(&staging_dir, &staging_root).map_err(|error| {
            workflow_error(
                DISCARD_COMMAND,
                "staging-discard-failed",
                "discard",
                error,
                false,
                safe_to_continue,
            )
        })?
    } else {
        false
    };
    let backup_removed = if remove_backup {
        remove_contained_directory(&backup_dir, &backup_root).map_err(|error| {
            workflow_error(
                DISCARD_COMMAND,
                "backup-discard-failed",
                "discard",
                error,
                false,
                safe_to_continue,
            )
        })?
    } else {
        false
    };
    fs::remove_dir_all(&quarantined).map_err(|error| {
        workflow_error(
            DISCARD_COMMAND,
            "transaction-discard-failed",
            "discard",
            error,
            false,
            safe_to_continue,
        )
    })?;

    Ok(DiscardPreparedUpdateResult {
        schema_version: 1,
        state: "discarded".to_string(),
        transaction_id,
        target_version,
        reason: DiscardReason {
            code: "discarded".to_string(),
            retryable: false,
            safe_to_continue,
        },
        removed: RemovedPreparedState {
            transaction: true,
            staging: staging_removed,
            backup: backup_removed,
        },
    })
}

pub fn serialize_prepare_result(result: PrepareUpdateResult) -> CoreResult<Value> {
    Ok(to_value(result)?)
}

pub fn serialize_discard_result(result: DiscardPreparedUpdateResult) -> CoreResult<Value> {
    Ok(to_value(result)?)
}

pub fn default_github_owner() -> String {
    DEFAULT_GITHUB_OWNER.to_string()
}

pub fn default_github_repo() -> String {
    DEFAULT_GITHUB_REPO.to_string()
}
