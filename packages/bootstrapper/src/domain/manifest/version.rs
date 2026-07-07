use crate::domain::manifest::{BootstrapperUpdateDecision, BootstrapperUpdateManifest};
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
    let artifacts = manifest.artifacts.get(dist);
    let Some(artifacts) = artifacts else {
        return BootstrapperUpdateDecision {
            artifacts: None,
            channel: manifest.channel.clone(),
            current_version: current_version.to_string(),
            dist: dist.to_string(),
            reason: "missing-dist-artifacts".to_string(),
            target_version: manifest.client_version.clone(),
            update_available: false,
        };
    };

    let current = parse_comparable_version(current_version);
    let target = parse_comparable_version(&manifest.client_version);
    let (Some(current), Some(target)) = (current, target) else {
        return BootstrapperUpdateDecision {
            artifacts: Some(artifacts.clone()),
            channel: manifest.channel.clone(),
            current_version: current_version.to_string(),
            dist: dist.to_string(),
            reason: "invalid-version".to_string(),
            target_version: manifest.client_version.clone(),
            update_available: false,
        };
    };

    let update_available = compare_versions(&target, &current) > 0;
    BootstrapperUpdateDecision {
        artifacts: Some(artifacts.clone()),
        channel: manifest.channel.clone(),
        current_version: current_version.to_string(),
        dist: dist.to_string(),
        reason: if update_available {
            "update-available".to_string()
        } else {
            "up-to-date".to_string()
        },
        target_version: manifest.client_version.clone(),
        update_available,
    }
}
