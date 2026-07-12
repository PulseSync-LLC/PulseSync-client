use crate::{
    core::install_state::InstallStateV2,
    domain::manifest::{
        ArtifactLayout, BootstrapperDistArtifacts, BootstrapperUpdateDecision,
        BootstrapperUpdateManifest,
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

pub fn decide_update(
    manifest: &BootstrapperUpdateManifest,
    current_version: &str,
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
            target_version: manifest.release_version.clone(),
            update_available: false,
            host_version: String::new(),
            bootstrapper_version: String::new(),
            component_versions: Default::default(),
            selected_artifacts: Vec::new(),
            metadata_version: manifest.metadata_version,
            host_electron_abi: None,
            component_electron_abis: Default::default(),
        };
    };

    let current = parse_comparable_version(current_version);
    let target_version = parse_comparable_version(&manifest.release_version);
    let (Some(current), Some(target_version)) = (current, target_version) else {
        return BootstrapperUpdateDecision {
            artifacts: Some(BootstrapperDistArtifacts {
                layout: target.layout,
                host: target.host.artifact.clone(),
                bootstrapper: Some(target.bootstrapper.artifact.clone()),
                modules: target
                    .components
                    .iter()
                    .map(|(name, component)| (name.clone(), component.artifact.clone()))
                    .collect(),
            }),
            channel: manifest.channel.clone(),
            current_version: current_version.to_string(),
            dist: dist.to_string(),
            reason: "invalid-version".to_string(),
            target_version: manifest.release_version.clone(),
            update_available: false,
            host_version: target.host.version.clone(),
            bootstrapper_version: target.bootstrapper.version.clone(),
            component_versions: target
                .components
                .iter()
                .map(|(name, value)| (name.clone(), value.version.clone()))
                .collect(),
            selected_artifacts: Vec::new(),
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

    let update_available = compare_versions(&target_version, &current) > 0;
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
                .chain(std::iter::once("bootstrapper".to_string()))
                .collect()
        }
    } else {
        Vec::new()
    };
    BootstrapperUpdateDecision {
        artifacts: Some(BootstrapperDistArtifacts {
            layout: target.layout,
            host: target.host.artifact.clone(),
            bootstrapper: Some(target.bootstrapper.artifact.clone()),
            modules: target
                .components
                .iter()
                .map(|(name, component)| (name.clone(), component.artifact.clone()))
                .collect(),
        }),
        channel: manifest.channel.clone(),
        current_version: current_version.to_string(),
        dist: dist.to_string(),
        reason: if update_available {
            "update-available".to_string()
        } else {
            "up-to-date".to_string()
        },
        target_version: manifest.release_version.clone(),
        update_available,
        host_version: target.host.version.clone(),
        bootstrapper_version: target.bootstrapper.version.clone(),
        component_versions: target
            .components
            .iter()
            .map(|(name, value)| (name.clone(), value.version.clone()))
            .collect(),
        selected_artifacts,
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
    installed: &InstallStateV2,
    dist: &str,
) -> BootstrapperUpdateDecision {
    let Some(target) = manifest.targets.get(dist) else {
        return decide_update(
            manifest,
            &installed
                .active
                .components
                .get("desktopCore")
                .map(|value| value.version.as_str())
                .unwrap_or("0.0.0"),
            dist,
        );
    };
    if manifest.metadata_version < installed.metadata_version {
        let mut decision = decide_update(
            manifest,
            &installed
                .active
                .components
                .get("desktopCore")
                .map(|value| value.version.as_str())
                .unwrap_or("0.0.0"),
            dist,
        );
        decision.reason = "stale-metadata".to_string();
        decision.update_available = false;
        decision.selected_artifacts.clear();
        return decision;
    }
    let immutable_mismatch = (installed.active.host.version == target.host.version
        && installed
            .active
            .host
            .artifact_sha256
            .as_deref()
            .is_some_and(|sha| !sha.eq_ignore_ascii_case(&target.host.artifact.sha256)))
        || target.components.iter().any(|(name, component)| {
            installed
                .active
                .components
                .get(name)
                .is_some_and(|installed_component| {
                    installed_component.version == component.version
                        && installed_component
                            .artifact_sha256
                            .as_deref()
                            .is_some_and(|sha| {
                                !sha.eq_ignore_ascii_case(&component.artifact.sha256)
                            })
                })
        })
        || installed
            .active
            .components
            .get("bootstrapper")
            .is_some_and(|installed_component| {
                installed_component.version == target.bootstrapper.version
                    && installed_component
                        .artifact_sha256
                        .as_deref()
                        .is_some_and(|sha| {
                            !sha.eq_ignore_ascii_case(&target.bootstrapper.artifact.sha256)
                        })
            });
    if immutable_mismatch {
        let mut decision = decide_update(
            manifest,
            &installed
                .active
                .components
                .get("desktopCore")
                .map(|value| value.version.as_str())
                .unwrap_or("0.0.0"),
            dist,
        );
        decision.reason = "immutable-artifact-mismatch".to_string();
        decision.update_available = false;
        decision.selected_artifacts.clear();
        return decision;
    }
    let mut selected_artifacts = Vec::new();
    if installed.active.host.version != target.host.version
        || target
            .host
            .electron_abi
            .as_deref()
            .is_some_and(|abi| installed.active.host.electron_abi.as_deref() != Some(abi))
    {
        selected_artifacts.push("host".to_string());
    }
    for (name, component) in &target.components {
        if installed
            .active
            .components
            .get(name)
            .map(|value| value.version.as_str())
            != Some(component.version.as_str())
            || component.electron_abi.as_deref().is_some_and(|abi| {
                installed
                    .active
                    .components
                    .get(name)
                    .and_then(|value| value.electron_abi.as_deref())
                    != Some(abi)
            })
        {
            selected_artifacts.push(format!("module:{name}"));
        }
    }
    if installed
        .active
        .components
        .get("bootstrapper")
        .map(|value| value.version.as_str())
        != Some(target.bootstrapper.version.as_str())
    {
        selected_artifacts.push("bootstrapper".to_string());
    }
    let update_available = !selected_artifacts.is_empty();
    BootstrapperUpdateDecision {
        artifacts: Some(BootstrapperDistArtifacts {
            layout: ArtifactLayout::VersionedComponents,
            host: target.host.artifact.clone(),
            bootstrapper: Some(target.bootstrapper.artifact.clone()),
            modules: target
                .components
                .iter()
                .map(|(name, component)| (name.clone(), component.artifact.clone()))
                .collect(),
        }),
        channel: manifest.channel.clone(),
        current_version: installed
            .active
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
        target_version: manifest.release_version.clone(),
        update_available,
        host_version: target.host.version.clone(),
        bootstrapper_version: target.bootstrapper.version.clone(),
        component_versions: target
            .components
            .iter()
            .map(|(name, value)| (name.clone(), value.version.clone()))
            .collect(),
        selected_artifacts,
        metadata_version: manifest.metadata_version,
        host_electron_abi: target.host.electron_abi.clone(),
        component_electron_abis: target
            .components
            .iter()
            .filter_map(|(name, value)| value.electron_abi.clone().map(|abi| (name.clone(), abi)))
            .collect(),
    }
}
