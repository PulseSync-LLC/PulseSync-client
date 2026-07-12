use crate::{
    core::{
        error::Result,
        fs_ops::{ensure_executable, extract_zip_to, sha256_directory, sha256_file},
        install_state::{RuntimeComponentV3, RuntimeSnapshotV3, read_install_state_metadata},
        layout::{assert_inside, canonical_install_root},
        path_segment::sanitize_path_segment,
    },
    domain::{
        artifacts::{ArtifactKey, stage_artifact},
        install_workflow::events::{InstallProgressReporter, InstallWorkflowEvent},
        manifest::{
            ArtifactLayout, BootstrapperArtifact, BootstrapperUpdateManifest, VersionedArtifact,
            load_manifest,
        },
    },
};
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

struct NoopProgressReporter;

impl InstallProgressReporter for NoopProgressReporter {
    fn emit(&self, _event: InstallWorkflowEvent) {}
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RepairItem {
    key: String,
    required: bool,
    state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

struct RepairCandidate<'a> {
    key: ArtifactKey,
    required: bool,
    target_path: PathBuf,
    expected_content_sha256: &'a str,
    artifact: &'a BootstrapperArtifact,
}

fn resolve_relative(root: &Path, relative: &Path, label: &str) -> Result<PathBuf> {
    if relative.as_os_str().is_empty()
        || relative.is_absolute()
        || !relative
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err(format!("{label} must be a normalized relative path").into());
    }
    let path = root.join(relative);
    assert_inside(root, &path, label)?;
    Ok(path)
}

fn path_hash(path: &Path) -> Result<String> {
    if path.is_file() {
        sha256_file(path)
    } else if path.is_dir() {
        sha256_directory(path)
    } else {
        Err(format!("path is missing: {}", path.display()).into())
    }
}

fn descriptor_matches(
    component: &RuntimeComponentV3,
    descriptor: &VersionedArtifact,
    label: &str,
) -> Result<()> {
    let immutable_hash_matches = component
        .artifact_sha256
        .as_deref()
        .map(|sha| sha.eq_ignore_ascii_case(&descriptor.artifact.sha256))
        .unwrap_or_else(|| {
            descriptor
                .content_sha256
                .as_deref()
                .map(|sha| sha.eq_ignore_ascii_case(&component.sha256))
                .unwrap_or_else(|| {
                    component
                        .sha256
                        .eq_ignore_ascii_case(&descriptor.artifact.sha256)
                })
        });
    if component.version != descriptor.version
        || component.required != descriptor.required
        || !immutable_hash_matches
    {
        return Err(format!("{label} installed metadata does not match immutable manifest").into());
    }
    Ok(())
}

fn collect_candidates<'a>(
    root: &Path,
    snapshot: &'a RuntimeSnapshotV3,
    manifest: &'a BootstrapperUpdateManifest,
    dist: &str,
) -> Result<Vec<RepairCandidate<'a>>> {
    if manifest.bundle_version != snapshot.bundle_version
        || manifest.metadata_version != snapshot.metadata_version
    {
        return Err("repair manifest does not identify the latest installed snapshot".into());
    }
    let target = manifest
        .targets
        .get(dist)
        .ok_or("repair manifest does not contain requested dist")?;
    if target.layout != ArtifactLayout::VersionedComponents {
        return Err("repair is only supported for versioned-components installs".into());
    }
    let host_hash_matches = snapshot
        .host
        .artifact_sha256
        .as_deref()
        .map(|sha| sha.eq_ignore_ascii_case(&target.host.artifact.sha256))
        .unwrap_or_else(|| {
            target
                .host
                .content_sha256
                .as_deref()
                .is_some_and(|sha| sha.eq_ignore_ascii_case(&snapshot.host.sha256))
        });
    if snapshot.host.version != target.host.version || !host_hash_matches {
        return Err("installed host metadata does not match immutable manifest".into());
    }
    let mut candidates = vec![RepairCandidate {
        key: ArtifactKey::Host,
        required: true,
        target_path: resolve_relative(root, &snapshot.host.path, "repair host path")?,
        expected_content_sha256: &snapshot.host.sha256,
        artifact: &target.host.artifact,
    }];
    for (name, component) in &snapshot.components {
        let descriptor = if name == "bootstrapper" {
            target
                .bootstrapper
                .as_ref()
                .ok_or("repair manifest is missing bootstrapper")?
        } else {
            target
                .components
                .get(name)
                .ok_or_else(|| format!("repair manifest is missing component: {name}"))?
        };
        descriptor_matches(component, descriptor, name)?;
        candidates.push(RepairCandidate {
            key: if name == "bootstrapper" {
                ArtifactKey::Bootstrapper
            } else {
                ArtifactKey::Module(name.clone())
            },
            required: component.required,
            target_path: resolve_relative(root, &component.path, &format!("repair {name} path"))?,
            expected_content_sha256: &component.sha256,
            artifact: &descriptor.artifact,
        });
    }
    for (name, descriptor) in &target.components {
        if descriptor.required && !snapshot.components.contains_key(name) {
            return Err(
                format!("required installed component is missing from state: {name}").into(),
            );
        }
    }
    Ok(candidates)
}

fn extracted_directory(unpack_dir: &Path, key: &ArtifactKey) -> Result<PathBuf> {
    let expected_name = match key {
        ArtifactKey::Host => "host",
        ArtifactKey::Module(name) => name,
        ArtifactKey::Bootstrapper => return Err("bootstrapper is not a directory artifact".into()),
    };
    let expected = unpack_dir.join(expected_name);
    if expected.is_dir() {
        return Ok(expected);
    }
    let roots = fs::read_dir(unpack_dir)?
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.path().is_dir())
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    if roots.len() == 1 {
        return Ok(roots[0].clone());
    }
    Err(format!(
        "repair archive has no unambiguous root for {}",
        key.as_str()
    )
    .into())
}

fn replace_path(target: &Path, prepared: &Path, backup: &Path) -> Result<()> {
    if backup.exists() {
        if backup.is_dir() {
            fs::remove_dir_all(backup)?;
        } else {
            fs::remove_file(backup)?;
        }
    }
    if target.exists() {
        fs::rename(target, backup)?;
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    if let Err(error) = fs::rename(prepared, target) {
        if backup.exists() {
            let _ = fs::rename(backup, target);
        }
        return Err(error.into());
    }
    if backup.exists() {
        if backup.is_dir() {
            fs::remove_dir_all(backup)?;
        } else {
            fs::remove_file(backup)?;
        }
    }
    Ok(())
}

fn repair_candidate(candidate: &RepairCandidate<'_>, work_dir: &Path) -> Result<()> {
    let staging_dir = work_dir.join("staging");
    fs::create_dir_all(&staging_dir)?;
    let staged = stage_artifact(
        candidate.artifact,
        candidate.key.clone(),
        &staging_dir,
        1,
        1,
        &NoopProgressReporter,
    )?;
    let safe_key = sanitize_path_segment(&candidate.key.as_str().replace(':', "-"))?;
    let prepared = work_dir.join(format!("prepared-{safe_key}"));
    let backup = work_dir.join(format!("backup-{safe_key}"));
    if matches!(candidate.key, ArtifactKey::Bootstrapper) {
        fs::copy(&staged.path, &prepared)?;
        ensure_executable(&prepared)?;
    } else {
        let unpack_dir = work_dir.join(format!("unpack-{safe_key}"));
        fs::create_dir_all(&unpack_dir)?;
        extract_zip_to(&staged.path, &unpack_dir)?;
        fs::rename(extracted_directory(&unpack_dir, &candidate.key)?, &prepared)?;
    }
    let actual = path_hash(&prepared)?;
    if !actual.eq_ignore_ascii_case(candidate.expected_content_sha256) {
        return Err(format!(
            "repaired {} content hash mismatch: expected {}, got {actual}",
            candidate.key.as_str(),
            candidate.expected_content_sha256
        )
        .into());
    }
    replace_path(&candidate.target_path, &prepared, &backup)?;
    Ok(())
}

pub fn repair_install(state_root: &Path, manifest_url: &str, dist: &str) -> Result<Value> {
    let state_root = canonical_install_root(state_root)?;
    let state = read_install_state_metadata(&state_root)?;
    let manifest = load_manifest(manifest_url)?;
    let candidates = collect_candidates(&state_root, &state.latest, &manifest, dist)?;
    let root = state_root
        .join("updates")
        .join("repair")
        .join(sanitize_path_segment(&state.latest.bundle_version)?)
        .join(Uuid::new_v4().to_string());
    fs::create_dir_all(&root)?;
    assert_inside(&state_root.join("updates"), &root, "repair work directory")?;
    let mut items = Vec::new();
    let result = (|| -> Result<()> {
        for candidate in candidates {
            match path_hash(&candidate.target_path) {
                Ok(actual) if actual.eq_ignore_ascii_case(candidate.expected_content_sha256) => {
                    items.push(RepairItem {
                        key: candidate.key.as_str(),
                        required: candidate.required,
                        state: "healthy".to_string(),
                        reason: None,
                    });
                }
                check => {
                    let detected = check.err().map(|error| error.to_string());
                    match repair_candidate(&candidate, &root) {
                        Ok(()) => items.push(RepairItem {
                            key: candidate.key.as_str(),
                            required: candidate.required,
                            state: "repaired".to_string(),
                            reason: detected,
                        }),
                        Err(error) if !candidate.required => items.push(RepairItem {
                            key: candidate.key.as_str(),
                            required: false,
                            state: "failed".to_string(),
                            reason: Some(error.to_string()),
                        }),
                        Err(error) => return Err(error),
                    }
                }
            }
        }
        Ok(())
    })();
    let _ = fs::remove_dir_all(&root);
    result?;
    let state_name = if items.iter().any(|item| item.state == "failed") {
        "partial"
    } else if items.iter().any(|item| item.state == "repaired") {
        "repaired"
    } else {
        "healthy"
    };
    Ok(json!({
        "schemaVersion": 3,
        "state": state_name,
        "bundleVersion": state.latest.bundle_version,
        "items": items,
    }))
}
