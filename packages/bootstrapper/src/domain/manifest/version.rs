use crate::{
    core::install_state::InstallStateV3,
    domain::manifest::{
        ArtifactLayout, BootstrapperDistArtifacts, BootstrapperUpdateDecision,
        BootstrapperUpdateManifest, ComponentFileSet, DesktopTargetV3, UpdatePlanAction,
        UpdatePlanDelivery, UpdatePlanItem,
    },
};
use std::cmp::Ordering;

fn release_bundle_version(manifest: &BootstrapperUpdateManifest) -> String {
    if manifest.schema_version >= 4 {
        manifest.metadata_version.to_string()
    } else {
        manifest.bundle_version.clone()
    }
}

#[derive(Clone, Debug)]
struct ComparableVersion {
    major: u64,
    minor: u64,
    patch: u64,
    prerelease: Vec<String>,
}

fn parse_comparable_version(version: &str) -> Option<ComparableVersion> {
    let trimmed = version.trim();
    let without_build = trimmed.split_once('+').map_or(trimmed, |(value, _)| value);
    let (core, prerelease) =
        without_build
            .split_once('-')
            .map_or((without_build, Vec::new()), |(core, prerelease)| {
                (
                    core,
                    prerelease
                        .split('.')
                        .map(str::to_string)
                        .collect::<Vec<_>>(),
                )
            });
    let mut parts = core.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some(ComparableVersion {
        major,
        minor,
        patch,
        prerelease,
    })
}

fn ordering_to_i8(ordering: Ordering) -> i8 {
    match ordering {
        Ordering::Less => -1,
        Ordering::Equal => 0,
        Ordering::Greater => 1,
    }
}

fn compare_prerelease_identifier(left: &str, right: &str) -> i8 {
    let left_number = left.parse::<u64>().ok();
    let right_number = right.parse::<u64>().ok();

    match (left_number, right_number) {
        (Some(left), Some(right)) => ordering_to_i8(left.cmp(&right)),
        (Some(_), None) => -1,
        (None, Some(_)) => 1,
        (None, None) => ordering_to_i8(left.cmp(right)),
    }
}

fn compare_versions(left: &ComparableVersion, right: &ComparableVersion) -> i8 {
    for diff in [
        left.major.cmp(&right.major),
        left.minor.cmp(&right.minor),
        left.patch.cmp(&right.patch),
    ] {
        if !diff.is_eq() {
            return ordering_to_i8(diff);
        }
    }

    if left.prerelease.is_empty() && right.prerelease.is_empty() {
        return 0;
    }
    if left.prerelease.is_empty() {
        return 1;
    }
    if right.prerelease.is_empty() {
        return -1;
    }

    let length = left.prerelease.len().max(right.prerelease.len());
    for index in 0..length {
        let Some(left_identifier) = left.prerelease.get(index) else {
            return -1;
        };
        let Some(right_identifier) = right.prerelease.get(index) else {
            return 1;
        };
        let diff = compare_prerelease_identifier(left_identifier, right_identifier);
        if diff != 0 {
            return diff;
        }
    }
    0
}

fn plan_item(
    key: String,
    required: bool,
    from_version: Option<String>,
    to_version: String,
    size: Option<u64>,
    selected_artifacts: &[String],
) -> UpdatePlanItem {
    let selected = selected_artifacts.iter().any(|selected| selected == &key);
    UpdatePlanItem {
        key,
        action: if selected {
            UpdatePlanAction::Install
        } else {
            UpdatePlanAction::Reuse
        },
        required,
        from_version,
        to_version,
        delivery: if selected {
            UpdatePlanDelivery::Full
        } else {
            UpdatePlanDelivery::None
        },
        download_bytes: if selected { size.unwrap_or(0) } else { 0 },
        restart_required: selected,
    }
}

fn target_plan(
    target: &DesktopTargetV3,
    selected_artifacts: &[String],
    installed: Option<&InstallStateV3>,
) -> Vec<UpdatePlanItem> {
    let mut plan = vec![plan_item(
        "host".to_string(),
        target.host.required,
        installed.map(|state| state.latest.host.version.clone()),
        target.host.version.clone(),
        (!target.host.files.is_empty())
            .then(|| target.host.files.iter().map(|file| file.size).sum())
            .or(target.host.artifact.size),
        selected_artifacts,
    )];
    plan.extend(target.components.iter().map(|(name, component)| {
        plan_item(
            format!("module:{name}"),
            component.required,
            installed.and_then(|state| {
                state
                    .latest
                    .components
                    .get(name)
                    .map(|value| value.version.clone())
            }),
            component.version.clone(),
            (!component.files.is_empty())
                .then(|| component.files.iter().map(|file| file.size).sum())
                .or(component.artifact.size),
            selected_artifacts,
        )
    }));
    if let Some(bootstrapper) = target.bootstrapper.as_ref() {
        plan.push(plan_item(
            "bootstrapper".to_string(),
            bootstrapper.required,
            installed.and_then(|state| {
                state
                    .latest
                    .components
                    .get("bootstrapper")
                    .map(|value| value.version.clone())
            }),
            bootstrapper.version.clone(),
            bootstrapper.artifact.size,
            selected_artifacts,
        ));
    }
    if let Some(installed) = installed
        && target.layout != ArtifactLayout::MacosHybrid
    {
        plan.extend(
            installed
                .latest
                .components
                .iter()
                .filter(|(name, _)| {
                    name.as_str() != "bootstrapper"
                        && !target.components.contains_key(name.as_str())
                })
                .map(|(name, component)| UpdatePlanItem {
                    key: format!("module:{name}"),
                    action: UpdatePlanAction::Remove,
                    required: component.required,
                    from_version: Some(component.version.clone()),
                    to_version: "removed".to_string(),
                    delivery: UpdatePlanDelivery::None,
                    download_bytes: 0,
                    restart_required: true,
                }),
        );
    }
    plan
}

fn target_module_files(
    target: &DesktopTargetV3,
) -> std::collections::BTreeMap<String, ComponentFileSet> {
    target
        .components
        .iter()
        .filter_map(|(name, component)| {
            component.content_sha256.as_ref().map(|content_sha256| {
                (
                    name.clone(),
                    ComponentFileSet {
                        content_sha256: content_sha256.clone(),
                        files: component.files.clone(),
                    },
                )
            })
        })
        .collect()
}

fn target_host_files(target: &DesktopTargetV3) -> Option<ComponentFileSet> {
    target
        .host
        .content_sha256
        .as_ref()
        .map(|content_sha256| ComponentFileSet {
            content_sha256: content_sha256.clone(),
            files: target.host.files.clone(),
        })
}

pub fn decide_update(
    manifest: &BootstrapperUpdateManifest,
    current_version: &str,
    current_bundle_version: &str,
    dist: &str,
) -> BootstrapperUpdateDecision {
    let target = manifest.targets.get(dist);
    let Some(target) = target else {
        return BootstrapperUpdateDecision {
            artifacts: None,
            channel: manifest.channel.clone(),
            current_version: current_version.to_string(),
            dist: dist.to_string(),
            reason: "missing-dist-artifacts".to_string(),
            target_version: manifest.desktop_version.clone(),
            bundle_version: release_bundle_version(manifest),
            host_bundle_version: None,
            update_available: false,
            host_version: String::new(),
            bootstrapper_version: None,
            component_versions: Default::default(),
            component_revisions: Default::default(),
            component_disk_names: Default::default(),
            selected_artifacts: Vec::new(),
            plan: Vec::new(),
            metadata_version: manifest.metadata_version,
            host_electron_abi: None,
            component_electron_abis: Default::default(),
        };
    };

    let current = parse_comparable_version(current_version);
    let target_version = parse_comparable_version(&manifest.desktop_version);
    let (Some(current), Some(target_version)) = (current, target_version) else {
        return BootstrapperUpdateDecision {
            artifacts: Some(BootstrapperDistArtifacts {
                layout: target.layout,
                host: target.host.artifact.clone(),
                host_files: target_host_files(target),
                bootstrapper: target
                    .bootstrapper
                    .as_ref()
                    .map(|bootstrapper| bootstrapper.artifact.clone()),
                modules: target
                    .components
                    .iter()
                    .map(|(name, component)| (name.clone(), component.artifact.clone()))
                    .collect(),
                module_files: target_module_files(target),
            }),
            channel: manifest.channel.clone(),
            current_version: current_version.to_string(),
            dist: dist.to_string(),
            reason: "invalid-version".to_string(),
            target_version: manifest.desktop_version.clone(),
            bundle_version: release_bundle_version(manifest),
            host_bundle_version: target.host.bundle_version.clone(),
            update_available: false,
            host_version: target.host.version.clone(),
            bootstrapper_version: target
                .bootstrapper
                .as_ref()
                .map(|bootstrapper| bootstrapper.version.clone()),
            component_versions: target
                .components
                .iter()
                .map(|(name, value)| (name.clone(), value.version.clone()))
                .collect(),
            component_revisions: target
                .components
                .iter()
                .filter_map(|(name, value)| value.revision.map(|revision| (name.clone(), revision)))
                .collect(),
            component_disk_names: target
                .components
                .iter()
                .filter_map(|(name, value)| {
                    value
                        .disk_name
                        .clone()
                        .map(|disk_name| (name.clone(), disk_name))
                })
                .collect(),
            selected_artifacts: Vec::new(),
            plan: Vec::new(),
            metadata_version: manifest.metadata_version,
            host_electron_abi: target.host.electron_abi.clone(),
            component_electron_abis: target
                .components
                .iter()
                .filter_map(|(name, value)| {
                    value.electron_abi.clone().map(|abi| (name.clone(), abi))
                })
                .collect(),
        };
    };

    let current_bundle = current_bundle_version.parse::<u64>().ok();
    if target.layout == ArtifactLayout::MacosBundle && current_bundle.is_none() {
        return BootstrapperUpdateDecision {
            artifacts: Some(BootstrapperDistArtifacts {
                layout: target.layout,
                host: target.host.artifact.clone(),
                host_files: target_host_files(target),
                bootstrapper: target
                    .bootstrapper
                    .as_ref()
                    .map(|bootstrapper| bootstrapper.artifact.clone()),
                modules: Default::default(),
                module_files: Default::default(),
            }),
            channel: manifest.channel.clone(),
            current_version: current_version.to_string(),
            dist: dist.to_string(),
            reason: "invalid-version".to_string(),
            target_version: manifest.desktop_version.clone(),
            bundle_version: release_bundle_version(manifest),
            host_bundle_version: target.host.bundle_version.clone(),
            update_available: false,
            host_version: target.host.version.clone(),
            bootstrapper_version: target
                .bootstrapper
                .as_ref()
                .map(|bootstrapper| bootstrapper.version.clone()),
            component_versions: Default::default(),
            component_revisions: Default::default(),
            component_disk_names: Default::default(),
            selected_artifacts: Vec::new(),
            plan: target_plan(target, &[], None),
            metadata_version: manifest.metadata_version,
            host_electron_abi: target.host.electron_abi.clone(),
            component_electron_abis: Default::default(),
        };
    }
    let stale_bundle = target.layout == ArtifactLayout::MacosBundle
        && current_bundle.is_some_and(|current| manifest.metadata_version < current);
    let update_available = if target.layout == ArtifactLayout::MacosBundle {
        current_bundle.is_some_and(|current| manifest.metadata_version > current)
    } else {
        compare_versions(&target_version, &current) > 0
    };
    let selected_artifacts = if update_available {
        if target.layout == ArtifactLayout::MacosBundle {
            vec!["host".to_string()]
        } else {
            std::iter::once("host".to_string())
                .chain(
                    target
                        .components
                        .keys()
                        .map(|name| format!("module:{name}")),
                )
                .chain(
                    target
                        .bootstrapper
                        .iter()
                        .map(|_| "bootstrapper".to_string()),
                )
                .collect()
        }
    } else {
        Vec::new()
    };
    let plan = target_plan(target, &selected_artifacts, None);
    BootstrapperUpdateDecision {
        artifacts: Some(BootstrapperDistArtifacts {
            layout: target.layout,
            host: target.host.artifact.clone(),
            host_files: target_host_files(target),
            bootstrapper: target
                .bootstrapper
                .as_ref()
                .map(|bootstrapper| bootstrapper.artifact.clone()),
            modules: target
                .components
                .iter()
                .map(|(name, component)| (name.clone(), component.artifact.clone()))
                .collect(),
            module_files: target_module_files(target),
        }),
        channel: manifest.channel.clone(),
        current_version: current_version.to_string(),
        dist: dist.to_string(),
        reason: if stale_bundle {
            "stale-metadata".to_string()
        } else if update_available {
            "update-available".to_string()
        } else {
            "up-to-date".to_string()
        },
        target_version: manifest.desktop_version.clone(),
        bundle_version: release_bundle_version(manifest),
        host_bundle_version: target.host.bundle_version.clone(),
        update_available,
        host_version: target.host.version.clone(),
        bootstrapper_version: target
            .bootstrapper
            .as_ref()
            .map(|bootstrapper| bootstrapper.version.clone()),
        component_versions: target
            .components
            .iter()
            .map(|(name, value)| (name.clone(), value.version.clone()))
            .collect(),
        component_revisions: target
            .components
            .iter()
            .filter_map(|(name, value)| value.revision.map(|revision| (name.clone(), revision)))
            .collect(),
        component_disk_names: target
            .components
            .iter()
            .filter_map(|(name, value)| {
                value
                    .disk_name
                    .clone()
                    .map(|disk_name| (name.clone(), disk_name))
            })
            .collect(),
        selected_artifacts,
        plan,
        metadata_version: manifest.metadata_version,
        host_electron_abi: target.host.electron_abi.clone(),
        component_electron_abis: target
            .components
            .iter()
            .filter_map(|(name, value)| value.electron_abi.clone().map(|abi| (name.clone(), abi)))
            .collect(),
    }
}

pub fn decide_component_update(
    manifest: &BootstrapperUpdateManifest,
    installed: &InstallStateV3,
    dist: &str,
) -> BootstrapperUpdateDecision {
    let installed_desktop_version = installed
        .latest
        .components
        .get("desktopCore")
        .map(|value| value.version.as_str())
        .unwrap_or("0.0.0");
    let installed_bundle_version = installed.latest.metadata_version.to_string();
    let Some(target) = manifest.targets.get(dist) else {
        return decide_update(
            manifest,
            installed_desktop_version,
            &installed_bundle_version,
            dist,
        );
    };
    if manifest.metadata_version < installed.latest.metadata_version {
        let mut decision = decide_update(
            manifest,
            installed_desktop_version,
            &installed_bundle_version,
            dist,
        );
        decision.reason = "stale-metadata".to_string();
        decision.update_available = false;
        decision.selected_artifacts.clear();
        decision.plan = target_plan(target, &[], Some(installed));
        return decision;
    }
    let same_host_identity = if target.layout == ArtifactLayout::MacosHybrid {
        installed.latest.host.bundle_version.as_deref() == target.host.bundle_version.as_deref()
    } else {
        installed.latest.host.version == target.host.version
    };
    let host_immutable_mismatch = same_host_identity
        && (installed
            .latest
            .host
            .artifact_sha256
            .as_deref()
            .is_some_and(|sha| !sha.eq_ignore_ascii_case(&target.host.artifact.sha256))
            || target
                .host
                .content_sha256
                .as_deref()
                .is_some_and(|sha| !sha.eq_ignore_ascii_case(&installed.latest.host.sha256)));
    let component_immutable_mismatch = same_host_identity
        && target.components.iter().any(|(name, component)| {
            installed
                .latest
                .components
                .get(name)
                .is_some_and(|installed_component| {
                    let same_identity = installed_component.version == component.version
                        && component
                            .revision
                            .is_none_or(|revision| installed_component.revision == Some(revision));
                    same_identity
                        && (installed_component
                            .artifact_sha256
                            .as_deref()
                            .is_some_and(|sha| {
                                !sha.eq_ignore_ascii_case(&component.artifact.sha256)
                            })
                            || component.content_sha256.as_deref().is_some_and(|sha| {
                                !sha.eq_ignore_ascii_case(&installed_component.sha256)
                            }))
                })
        });
    let immutable_mismatch = host_immutable_mismatch
        || component_immutable_mismatch
        || target.bootstrapper.as_ref().is_some_and(|bootstrapper| {
            installed
                .latest
                .components
                .get("bootstrapper")
                .is_some_and(|installed_component| {
                    installed_component.version == bootstrapper.version
                        && installed_component
                            .artifact_sha256
                            .as_deref()
                            .is_some_and(|sha| {
                                !sha.eq_ignore_ascii_case(&bootstrapper.artifact.sha256)
                            })
                })
        });
    if immutable_mismatch {
        let mut decision = decide_update(
            manifest,
            installed_desktop_version,
            &installed_bundle_version,
            dist,
        );
        decision.reason = "immutable-artifact-mismatch".to_string();
        decision.update_available = false;
        decision.selected_artifacts.clear();
        decision.plan = target_plan(target, &[], Some(installed));
        return decision;
    }
    let mut selected_artifacts = Vec::new();
    let host_changed = if target.layout == ArtifactLayout::MacosHybrid {
        installed.latest.host.bundle_version.as_deref() != target.host.bundle_version.as_deref()
            || target
                .host
                .electron_abi
                .as_deref()
                .is_some_and(|abi| installed.latest.host.electron_abi.as_deref() != Some(abi))
    } else {
        installed.latest.host.version != target.host.version
            || target
                .host
                .electron_abi
                .as_deref()
                .is_some_and(|abi| installed.latest.host.electron_abi.as_deref() != Some(abi))
    };
    if host_changed {
        selected_artifacts.push("host".to_string());
    }
    for (name, component) in &target.components {
        if installed
            .latest
            .components
            .get(name)
            .map(|value| value.version.as_str())
            != Some(component.version.as_str())
            || component.revision.is_some_and(|revision| {
                installed
                    .latest
                    .components
                    .get(name)
                    .and_then(|value| value.revision)
                    != Some(revision)
            })
            || installed
                .latest
                .components
                .get(name)
                .is_some_and(|value| value.required != component.required)
            || component.electron_abi.as_deref().is_some_and(|abi| {
                installed
                    .latest
                    .components
                    .get(name)
                    .and_then(|value| value.electron_abi.as_deref())
                    != Some(abi)
            })
        {
            selected_artifacts.push(format!("module:{name}"));
        }
    }
    let revision_collision =
        !host_changed
            && target.components.iter().any(|(name, component)| {
                selected_artifacts.contains(&format!("module:{name}"))
                    && component
                        .revision
                        .zip(component.disk_name.as_deref())
                        .is_some_and(|(revision, disk_name)| {
                            installed.latest.components.get(name).is_some_and(
                                |installed_component| {
                                    let expected = std::path::PathBuf::from(format!(
                                        "app-{}",
                                        target.host.version
                                    ))
                                    .join("modules")
                                    .join(format!("{disk_name}-{revision}"))
                                    .join(disk_name);
                                    installed_component
                                        .path
                                        .components()
                                        .eq(expected.components())
                                },
                            )
                        })
            });
    if revision_collision {
        let mut decision = decide_update(
            manifest,
            installed_desktop_version,
            &installed_bundle_version,
            dist,
        );
        decision.reason = "component-revision-not-advanced".to_string();
        decision.update_available = false;
        decision.selected_artifacts.clear();
        decision.plan = target_plan(target, &[], Some(installed));
        return decision;
    }
    if let Some(bootstrapper) = target.bootstrapper.as_ref()
        && installed
            .latest
            .components
            .get("bootstrapper")
            .map(|value| value.version.as_str())
            != Some(bootstrapper.version.as_str())
    {
        selected_artifacts.push("bootstrapper".to_string());
    }
    let removed_components = target.layout != ArtifactLayout::MacosHybrid
        && installed
            .latest
            .components
            .keys()
            .any(|name| name != "bootstrapper" && !target.components.contains_key(name));
    let update_available = !selected_artifacts.is_empty() || removed_components;
    let plan = target_plan(target, &selected_artifacts, Some(installed));
    BootstrapperUpdateDecision {
        artifacts: Some(BootstrapperDistArtifacts {
            layout: target.layout,
            host: target.host.artifact.clone(),
            host_files: target_host_files(target),
            bootstrapper: target
                .bootstrapper
                .as_ref()
                .map(|bootstrapper| bootstrapper.artifact.clone()),
            modules: target
                .components
                .iter()
                .map(|(name, component)| (name.clone(), component.artifact.clone()))
                .collect(),
            module_files: target_module_files(target),
        }),
        channel: manifest.channel.clone(),
        current_version: installed
            .latest
            .components
            .get("desktopCore")
            .map(|value| value.version.clone())
            .unwrap_or_default(),
        dist: dist.to_string(),
        reason: if update_available {
            "update-available"
        } else {
            "up-to-date"
        }
        .to_string(),
        target_version: manifest.desktop_version.clone(),
        bundle_version: release_bundle_version(manifest),
        host_bundle_version: target.host.bundle_version.clone(),
        update_available,
        host_version: target.host.version.clone(),
        bootstrapper_version: target
            .bootstrapper
            .as_ref()
            .map(|bootstrapper| bootstrapper.version.clone()),
        component_versions: target
            .components
            .iter()
            .map(|(name, value)| (name.clone(), value.version.clone()))
            .collect(),
        component_revisions: target
            .components
            .iter()
            .filter_map(|(name, value)| value.revision.map(|revision| (name.clone(), revision)))
            .collect(),
        component_disk_names: target
            .components
            .iter()
            .filter_map(|(name, value)| {
                value
                    .disk_name
                    .clone()
                    .map(|disk_name| (name.clone(), disk_name))
            })
            .collect(),
        selected_artifacts,
        plan,
        metadata_version: manifest.metadata_version,
        host_electron_abi: target.host.electron_abi.clone(),
        component_electron_abis: target
            .components
            .iter()
            .filter_map(|(name, value)| value.electron_abi.clone().map(|abi| (name.clone(), abi)))
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn artifact(sha: &str) -> serde_json::Value {
        serde_json::json!({
            "url": "/tmp/artifact.zip",
            "sha256": sha,
            "size": 10
        })
    }

    fn hybrid_manifest(core_version: &str, revision: u64) -> BootstrapperUpdateManifest {
        serde_json::from_value(serde_json::json!({
            "schemaVersion": 4,
            "metadataVersion": 2,
            "channel": "dev",
            "desktopVersion": core_version,
            "targets": {
                "darwin-arm64": {
                    "layout": "macos-hybrid",
                    "host": {
                        "version": "2.0.0",
                        "bundleVersion": "1",
                        "electronAbi": "140",
                        "required": true,
                        "artifact": artifact("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
                    },
                    "components": {
                        "desktopCore": {
                            "version": core_version,
                            "revision": revision,
                            "diskName": "pulsesync_desktop_core",
                            "required": true,
                            "requiresHost": ">=2.0.0 <3.0.0",
                            "contentSha256": "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
                            "files": [],
                            "artifact": artifact("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")
                        }
                    }
                }
            }
        }))
        .unwrap()
    }

    fn installed_state() -> InstallStateV3 {
        let snapshot: crate::core::install_state::RuntimeSnapshotV3 =
            serde_json::from_value(serde_json::json!({
                "bundleVersion": "1",
                "metadataVersion": 1,
                "host": {
                    "version": "2.0.0",
                    "location": "host-bundle",
                    "bundleVersion": "1",
                    "path": ".",
                    "sha256": "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
                    "artifactSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "electronAbi": "140"
                },
                "components": {
                    "desktopCore": {
                        "version": "2.0.0",
                        "revision": 1,
                        "diskName": "pulsesync_desktop_core",
                        "path": "components/pulsesync_desktop_core-1/pulsesync_desktop_core",
                        "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                        "required": true
                    }
                }
            }))
            .unwrap();
        InstallStateV3 {
            schema_version: 4,
            generation: 1,
            activation: crate::core::install_state::RuntimeActivationV3 {
                state: crate::core::install_state::ActivationState::Confirmed,
                generation: 1,
                launch_owner: None,
            },
            latest: snapshot.clone(),
            running: snapshot.clone(),
            last_successful: snapshot.clone(),
            known_good: snapshot,
            pinned: None,
        }
    }

    #[test]
    fn hybrid_revision_update_selects_only_desktop_core() {
        let decision = decide_component_update(
            &hybrid_manifest("2.0.1", 2),
            &installed_state(),
            "darwin-arm64",
        );
        assert!(decision.update_available);
        assert_eq!(decision.bundle_version, "2");
        assert_eq!(decision.host_bundle_version.as_deref(), Some("1"));
        assert_eq!(decision.selected_artifacts, vec!["module:desktopCore"]);
        assert_eq!(
            decision.artifacts.as_ref().map(|value| value.layout),
            Some(ArtifactLayout::MacosHybrid)
        );
    }
}
