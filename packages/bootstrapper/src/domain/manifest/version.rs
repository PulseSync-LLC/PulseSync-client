use crate::{
    core::install_state::InstallStateV3,
    domain::manifest::{
        ArtifactLayout, BootstrapperDistArtifacts, BootstrapperUpdateDecision,
        BootstrapperUpdateManifest, ComponentFileSet, DesktopTargetV3, UpdatePlanAction,
        UpdatePlanDelivery, UpdatePlanItem,
    },
};
use std::cmp::Ordering;

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
    if let Some(installed) = installed {
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
            bundle_version: manifest.bundle_version.clone(),
            update_available: false,
            host_version: String::new(),
            bootstrapper_version: None,
            component_versions: Default::default(),
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
            bundle_version: manifest.bundle_version.clone(),
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
            bundle_version: manifest.bundle_version.clone(),
            update_available: false,
            host_version: target.host.version.clone(),
            bootstrapper_version: target
                .bootstrapper
                .as_ref()
                .map(|bootstrapper| bootstrapper.version.clone()),
            component_versions: Default::default(),
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
        bundle_version: manifest.bundle_version.clone(),
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
    let host_immutable_mismatch = installed.latest.host.version == target.host.version
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
    let immutable_mismatch = host_immutable_mismatch
        || target.components.iter().any(|(name, component)| {
            installed
                .latest
                .components
                .get(name)
                .is_some_and(|installed_component| {
                    installed_component.version == component.version
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
        })
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
    if installed.latest.host.version != target.host.version
        || target
            .host
            .electron_abi
            .as_deref()
            .is_some_and(|abi| installed.latest.host.electron_abi.as_deref() != Some(abi))
    {
        selected_artifacts.push("host".to_string());
    }
    for (name, component) in &target.components {
        if installed
            .latest
            .components
            .get(name)
            .map(|value| value.version.as_str())
            != Some(component.version.as_str())
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
    let removed_components = installed
        .latest
        .components
        .keys()
        .any(|name| name != "bootstrapper" && !target.components.contains_key(name));
    let update_available = !selected_artifacts.is_empty() || removed_components;
    let plan = target_plan(target, &selected_artifacts, Some(installed));
    BootstrapperUpdateDecision {
        artifacts: Some(BootstrapperDistArtifacts {
            layout: ArtifactLayout::VersionedComponents,
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
        bundle_version: manifest.bundle_version.clone(),
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
