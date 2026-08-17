use super::{
    PREPARE_COMMAND, PrepareUpdateOptions, PrepareUpdateResult, PreparedTransactionRef,
    UPDATE_LOCK_TIMEOUT, UpdateWorkflowError,
    common::{
        active_lease_matches, current_install_is_safe, input_segment_is_safe,
        reject_live_self_update, relative_executable_name_is_safe, resolve_options_layout,
        workflow_error,
    },
    prepare_validation::{
        prepared_ref, public_decision as make_public_decision, resolve_effective_source,
        transaction_matches,
    },
};
use crate::{
    core::{
        active_app::write_json_atomic,
        layout::{
            LayoutKind, assert_inside, canonical_install_root, is_inside,
            normalize_retain_app_versions,
        },
        operation_lock::UpdateLock,
        packaged_runtime::packaged_bundle_version,
        path_segment::sanitize_path_segment,
    },
    domain::{
        artifacts::stage_artifacts,
        install_plan::{checks::warn, create_install_plan},
        install_workflow::events::{InstallProgressReporter, InstallWorkflowEvent},
        macos_bundle,
        manifest::{
            ArtifactLayout, BootstrapperUpdateManifest, UpdatePlanAction, UpdatePlanDelivery,
            decide_component_update, decide_update, read_source, validate_manifest,
        },
        transactions::{prepare_transaction_file_at, prepared_transactions},
    },
};
use serde_json::Value;
use std::fs;
use uuid::Uuid;

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

    let install_root = canonical_install_root(&options.state_root).map_err(|error| {
        workflow_error(
            PREPARE_COMMAND,
            "unsafe-install-root",
            "validate-input",
            error,
            false,
            false,
        )
    })?;
    let prelock_layout = resolve_options_layout(&options, install_root.clone()).ok();
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
    let layout = match resolve_options_layout(&options, install_root) {
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

    if matches!(
        layout.layout_kind,
        LayoutKind::VersionedComponents | LayoutKind::MacosHybrid
    ) && layout.current_version.as_deref() != Some(options.installed_version.as_str())
    {
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
    let mut decision = if matches!(
        layout.layout_kind,
        LayoutKind::VersionedComponents | LayoutKind::MacosHybrid
    ) {
        let installed = if layout.layout_kind == LayoutKind::MacosHybrid {
            crate::core::install_state::read_install_state_with_host(
                &layout.state_root,
                layout.host_bundle.as_deref(),
            )
        } else {
            crate::core::install_state::read_install_state(&layout.state_root)
        }
        .map_err(|error| {
            workflow_error(
                PREPARE_COMMAND,
                "install-state-invalid",
                "decide",
                error,
                false,
                safe_to_continue,
            )
        })?;
        decide_component_update(&manifest, &installed, &options.dist)
    } else {
        let bundle_version = layout
            .host_bundle
            .as_deref()
            .map(packaged_bundle_version)
            .transpose()
            .map_err(|error| {
                workflow_error(
                    PREPARE_COMMAND,
                    "packaged-runtime-invalid",
                    "decide",
                    error,
                    false,
                    safe_to_continue,
                )
            })?
            .unwrap_or_else(|| "0".to_string());
        decide_update(
            &manifest,
            &options.installed_version,
            &bundle_version,
            &options.dist,
        )
    };
    let mut public_decision = make_public_decision(&decision, &manifest);

    let artifact_layout = decision
        .artifacts
        .as_ref()
        .map(|artifacts| artifacts.layout);
    let layout_matches_manifest = matches!(
        (layout.layout_kind, artifact_layout),
        (LayoutKind::MacosBundle, Some(ArtifactLayout::MacosBundle))
            | (
                LayoutKind::VersionedComponents,
                Some(ArtifactLayout::VersionedComponents)
            )
            | (LayoutKind::MacosHybrid, Some(ArtifactLayout::MacosHybrid))
    );
    if decision.artifacts.is_some() && !layout_matches_manifest {
        return Ok(PrepareUpdateResult::blocked(
            Some(public_decision),
            Some(source),
            "artifact-layout-mismatch",
            false,
            safe_to_continue,
            vec!["manifest-artifact-layout".to_string()],
        ));
    }

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
        "missing-dist-artifacts"
        | "invalid-version"
        | "stale-metadata"
        | "immutable-artifact-mismatch" => {
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

    let artifact_keys =
        crate::domain::artifacts::selected_artifact_keys(&decision).map_err(|error| {
            workflow_error(
                PREPARE_COMMAND,
                "component-selection-invalid",
                "decide",
                error,
                false,
                safe_to_continue,
            )
        })?;
    let staging = stage_artifacts(
        &decision,
        Some(&layout.install_root),
        &staging_root,
        artifact_keys.clone(),
        reporter,
    )
    .map_err(|error| {
        workflow_error(
            PREPARE_COMMAND,
            "artifact-download-failed",
            "download",
            error,
            true,
            safe_to_continue,
        )
    })?;
    for failure in &staging.failures {
        if let Some(item) = decision
            .plan
            .iter_mut()
            .find(|item| item.key == failure.key.as_str())
        {
            item.action = UpdatePlanAction::Blocked;
            item.delivery = UpdatePlanDelivery::None;
            item.download_bytes = 0;
            item.restart_required = false;
        }
    }
    for staged in &staging.artifacts {
        if let Some(item) = decision
            .plan
            .iter_mut()
            .find(|item| item.key == staged.key.as_str())
        {
            item.download_bytes = staged.downloaded_bytes;
            let downloaded_operations = staged
                .file_operations
                .iter()
                .filter(|operation| operation.download_bytes > 0)
                .collect::<Vec<_>>();
            if !downloaded_operations.is_empty()
                && downloaded_operations
                    .iter()
                    .all(|operation| operation.delivery == "bsdiff")
            {
                item.delivery = UpdatePlanDelivery::Bsdiff;
            }
        }
    }
    public_decision = make_public_decision(&decision, &manifest);

    if artifact_layout == Some(ArtifactLayout::MacosBundle)
        || (artifact_layout == Some(ArtifactLayout::MacosHybrid)
            && decision.selected_artifacts.iter().any(|key| key == "host"))
    {
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
        let transaction = macos_bundle::prepare_transaction(
            &layout,
            &decision,
            &staging_root,
            &options.active_lease_id,
        )
        .map_err(|error| {
            let code = if error.to_string().starts_with("elevation-required:") {
                "elevation-required"
            } else {
                "macos-transaction-prepare-failed"
            };
            workflow_error(
                PREPARE_COMMAND,
                code,
                "prepare",
                error,
                false,
                safe_to_continue,
            )
        })?;
        return Ok(PrepareUpdateResult::prepared(
            public_decision,
            source,
            false,
            transaction,
            options.active_lease_id,
        ));
    }

    let has_state_removals = decision.plan.iter().any(|item| {
        matches!(item.action, UpdatePlanAction::Remove)
            || (matches!(item.action, UpdatePlanAction::Blocked) && !item.required)
    });
    if staging.artifacts.is_empty() && !has_state_removals {
        decision.reason = "up-to-date".to_string();
        decision.update_available = false;
        public_decision = make_public_decision(&decision, &manifest);
        return Ok(PrepareUpdateResult::up_to_date(public_decision, source));
    }

    reporter.emit(InstallWorkflowEvent::stage(
        "planning",
        "Creating update plan",
    ));
    let mut plan = create_install_plan(
        &decision,
        &layout.install_root,
        &staging_root,
        None,
        staging.artifacts.clone(),
        retain_app_versions,
        layout.host_bundle.clone(),
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
    for failure in staging.failures {
        plan.preflight.push(warn(
            &format!("optional-{}-download", failure.key.as_str()),
            format!(
                "Optional {} artifact was not staged: {}",
                failure.key.as_str(),
                failure.reason
            ),
            None,
        ));
    }
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
            sanitize_path_segment(&decision.bundle_version).map_err(|error| {
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
