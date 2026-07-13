use super::{
    EffectiveManifestSource, PREPARE_COMMAND, PrepareUpdateOptions, PreparedTransactionRef,
    RequestedManifestSource, UpdateDecision, UpdatePolicy, UpdateWorkflowError,
    common::{is_http_source, paths_match, scoped_update_path, value_path, workflow_error},
};
use crate::{
    core::{
        fs_ops::sha256_file,
        layout::{Layout, is_inside},
        path_segment::sanitize_path_segment,
    },
    domain::{
        artifacts::ArtifactKey,
        install_plan::InstallPlan,
        macos_bundle,
        manifest::{
            ArtifactLayout, BootstrapperUpdateDecision, BootstrapperUpdateManifest,
            GitHubManifestFallback, UpdatePlanAction, github_manifest_url, health_check_available,
        },
        transactions::{TransactionRecord, transaction_artifacts},
    },
};
use node_semver::{Range, Version};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;

pub(super) fn resolve_effective_source(
    options: &PrepareUpdateOptions,
    safe_to_continue: bool,
) -> std::result::Result<EffectiveManifestSource, UpdateWorkflowError> {
    let fallback = || GitHubManifestFallback {
        channel: options.channel.clone(),
        dist: options.dist.clone(),
        owner: options.github_owner.clone(),
        repo: options.github_repo.clone(),
        hybrid: options.host_bundle.is_some(),
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

pub(super) fn evaluate_policy(
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

pub(super) fn public_decision(
    decision: &BootstrapperUpdateDecision,
    manifest: &BootstrapperUpdateManifest,
) -> UpdateDecision {
    UpdateDecision {
        reason: decision.reason.clone(),
        channel: decision.channel.clone(),
        dist: decision.dist.clone(),
        current_version: decision.current_version.clone(),
        target_version: decision.target_version.clone(),
        bundle_version: decision.bundle_version.clone(),
        update_available: decision.update_available,
        plan: decision.plan.clone(),
        policy: evaluate_policy(
            manifest,
            &decision.current_version,
            decision.update_available,
        ),
    }
}

pub(super) fn expected_prepared_path(
    transaction_dir: &Path,
    source_path: &Path,
    key: &ArtifactKey,
) -> Option<PathBuf> {
    let name = match key {
        ArtifactKey::Host => "host.zip".to_string(),
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

pub(super) fn transaction_matches(
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
    if macos_bundle::is_macos_transaction(value) {
        let Some(artifacts) = decision.artifacts.as_ref() else {
            return false;
        };
        return matches!(
            artifacts.layout,
            ArtifactLayout::MacosBundle | ArtifactLayout::MacosHybrid
        ) && value.get("schemaVersion").and_then(Value::as_u64) == Some(1)
            && record.candidate.state == "prepared"
            && Uuid::parse_str(transaction_id).is_ok()
            && value.get("channel").and_then(Value::as_str) == Some(decision.channel.as_str())
            && value.get("dist").and_then(Value::as_str) == Some(decision.dist.as_str())
            && value.get("targetVersion").and_then(Value::as_str)
                == Some(decision.target_version.as_str())
            && value.get("bundleVersion").and_then(Value::as_str)
                == Some(decision.bundle_version.as_str())
            && value.get("applyDeferredByLeaseId").and_then(Value::as_str) == Some(lease_id)
            && value_path(value, "stateRoot")
                .is_some_and(|path| paths_match(&path, &layout.state_root))
            && value_path(value, "hostBundle").is_some_and(|path| {
                layout
                    .host_bundle
                    .as_ref()
                    .is_some_and(|host| paths_match(&path, host))
            })
            && value
                .get("archiveSha256")
                .and_then(Value::as_str)
                .is_some_and(|sha| sha.eq_ignore_ascii_case(&artifacts.host.sha256));
    }
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
        || value.get("bundleVersion").and_then(Value::as_str)
            != Some(decision.bundle_version.as_str())
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
        &decision.bundle_version,
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
        &decision.bundle_version,
        &decision.dist,
    ) else {
        return false;
    };
    let Some(expected_backup_dir) = scoped_update_path(
        &staging_root.join("backups"),
        &decision.channel,
        &decision.bundle_version,
        &decision.dist,
    ) else {
        return false;
    };
    let Some(backup_dir) = value_path(value, "backupDir") else {
        return false;
    };
    let Some(plan_file) = value_path(value, "planFile") else {
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
        || !paths_match(&plan_file, &staging_dir.join("install-plan.json"))
    {
        return false;
    }

    let Ok(plan) = fs::read(&plan_file)
        .map_err(|_| ())
        .and_then(|bytes| serde_json::from_slice::<InstallPlan>(&bytes).map_err(|_| ()))
    else {
        return false;
    };
    let Some(decision_artifacts) = decision.artifacts.as_ref() else {
        return false;
    };
    let expected_host_content = decision_artifacts
        .host_files
        .as_ref()
        .map(|files| files.content_sha256.clone());
    let expected_component_content = decision_artifacts
        .module_files
        .iter()
        .map(|(name, files)| (name.clone(), files.content_sha256.clone()))
        .collect::<BTreeMap<_, _>>();
    let expected_omitted_components = decision
        .plan
        .iter()
        .filter(|item| {
            matches!(item.action, UpdatePlanAction::Remove)
                || (matches!(item.action, UpdatePlanAction::Blocked) && !item.required)
        })
        .filter_map(|item| item.key.strip_prefix("module:").map(str::to_string))
        .collect::<Vec<_>>();
    let transaction_omitted_components = value
        .get("omittedComponents")
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .map(|item| item.as_str().map(str::to_string))
                .collect::<Option<Vec<_>>>()
        });
    if plan.bundle_version != decision.bundle_version
        || plan.artifact_layout != decision_artifacts.layout
        || plan.host_bundle_version != decision.host_bundle_version
        || plan.host_bundle.as_ref().is_some_and(|path| {
            layout
                .host_bundle
                .as_ref()
                .is_none_or(|host| !paths_match(path, host))
        })
        || plan.host_content_sha256 != expected_host_content
        || plan.component_content_sha256s != expected_component_content
        || plan.omitted_components != expected_omitted_components
        || transaction_omitted_components.as_ref() != Some(&plan.omitted_components)
    {
        return false;
    }
    let expected = plan
        .artifacts
        .iter()
        .map(|artifact| (artifact.key.as_str(), artifact))
        .collect::<BTreeMap<_, _>>();
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
        let Some(expected_artifact) = expected.get(&artifact.key) else {
            return false;
        };
        let key = &expected_artifact.key;
        let expected_source_path = &expected_artifact.source_path;
        let Some(expected_prepared_path) =
            expected_prepared_path(actual_dir, expected_source_path, key)
        else {
            return false;
        };
        let expected_prepared_kind = if matches!(key, ArtifactKey::Bootstrapper) {
            "file"
        } else {
            "archive"
        };
        if artifact.action != expected_artifact.action
            || artifact.prepared_kind != expected_prepared_kind
            || !paths_match(&artifact.source_path, expected_source_path)
            || !paths_match(&artifact.target_path, &expected_artifact.target_path)
            || !paths_match(&artifact.backup_path, &expected_artifact.backup_path)
            || !paths_match(&artifact.prepared_path, &expected_prepared_path)
            || artifact.sha256.to_lowercase() != expected_artifact.sha256.to_lowercase()
            || artifact.size != expected_artifact.size
            || artifact.required != expected_artifact.required
            || artifact.file_operations != expected_artifact.file_operations
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

pub(super) fn prepared_ref(record: &TransactionRecord) -> Option<PreparedTransactionRef> {
    let id = record.value.get("transactionId")?.as_str()?.to_string();
    let dir = record.candidate.path.parent()?.to_path_buf();
    Some(PreparedTransactionRef {
        id,
        dir,
        file: record.candidate.path.clone(),
    })
}
