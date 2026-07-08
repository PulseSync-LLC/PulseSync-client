use crate::{
    core::{
        error::Result,
        fs_ops::{ensure_executable, file_size, sha256_file},
        path_segment::sanitize_path_segment,
    },
    domain::manifest::{
        BootstrapperArtifact, BootstrapperDistArtifacts, BootstrapperUpdateDecision,
        artifact_for_key, read_source,
    },
    domain::install_workflow::events::{InstallProgressReporter, InstallWorkflowEvent},
};
use serde::{Deserialize, Deserializer, Serialize, Serializer, de};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ArtifactKey {
    App,
    Bootstrapper,
    Module(String),
}

impl ArtifactKey {
    pub fn from_str(value: &str) -> Result<Self> {
        if value == "app" {
            return Ok(Self::App);
        }
        if value == "bootstrapper" {
            return Ok(Self::Bootstrapper);
        }
        if let Some(module_name) = value.strip_prefix("module:") {
            if module_name.is_empty() {
                return Err("module artifact key is missing module name".into());
            }
            return Ok(Self::Module(module_name.to_string()));
        }
        Err(format!("unsupported artifact key: {value}").into())
    }

    pub fn as_str(&self) -> String {
        match self {
            Self::App => "app".to_string(),
            Self::Bootstrapper => "bootstrapper".to_string(),
            Self::Module(module_name) => format!("module:{module_name}"),
        }
    }
}

impl Serialize for ArtifactKey {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.as_str())
    }
}

impl<'de> Deserialize<'de> for ArtifactKey {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Self::from_str(&value).map_err(de::Error::custom)
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct StagedArtifact {
    pub key: ArtifactKey,
    pub path: PathBuf,
    pub reused: bool,
    pub sha256: String,
    pub size: u64,
    pub url: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct StagingResult {
    pub artifacts: Vec<StagedArtifact>,
    pub channel: String,
    pub dist: String,
    pub reason: String,
    #[serde(rename = "stagingDir")]
    pub staging_dir: PathBuf,
    #[serde(rename = "targetVersion")]
    pub target_version: String,
    #[serde(rename = "updateAvailable")]
    pub update_available: bool,
}

pub fn default_artifact_keys(artifacts: Option<&BootstrapperDistArtifacts>) -> Vec<ArtifactKey> {
    let mut keys = vec![ArtifactKey::App];
    if let Some(artifacts) = artifacts {
        keys.extend(artifacts.modules.keys().cloned().map(ArtifactKey::Module));
        if artifacts.bootstrapper.is_some() {
            keys.push(ArtifactKey::Bootstrapper);
        }
    }
    keys
}

fn decode_url_file_name(url: &str) -> Option<String> {
    let path_part = if let Some((_, rest)) = url.split_once("://") {
        rest.split_once('/').map(|(_, path)| path).unwrap_or("")
    } else {
        url
    };
    let name = path_part.rsplit(['/', '\\']).next()?;
    if name.is_empty() {
        return None;
    }
    Some(name.replace("%20", " "))
}

pub fn artifact_file_name(artifact: &BootstrapperArtifact, key: &ArtifactKey) -> Result<String> {
    sanitize_path_segment(
        &decode_url_file_name(&artifact.url)
            .unwrap_or_else(|| format!("{}.artifact", key.as_str())),
    )
}

pub fn verify_artifact_file(
    path: &Path,
    artifact: &BootstrapperArtifact,
    key: &ArtifactKey,
) -> Result<(String, u64)> {
    let size = file_size(path)?;
    if let Some(expected) = artifact.size {
        if expected != size {
            return Err(format!(
                "downloaded {} size mismatch: expected {expected}, got {size}",
                key.as_str()
            )
            .into());
        }
    }

    let sha256 = sha256_file(path)?;
    if sha256.to_lowercase() != artifact.sha256.to_lowercase() {
        return Err(format!(
            "downloaded {} sha256 mismatch: expected {}, got {sha256}",
            key.as_str(),
            artifact.sha256
        )
        .into());
    }

    Ok((sha256, size))
}

fn staging_dir(decision: &BootstrapperUpdateDecision, staging_root: &Path) -> Result<PathBuf> {
    Ok(staging_root
        .join(sanitize_path_segment(&decision.channel)?)
        .join(sanitize_path_segment(&decision.target_version)?)
        .join(sanitize_path_segment(&decision.dist)?))
}

fn materialize_artifact(
    artifact: &BootstrapperArtifact,
    key: &ArtifactKey,
    target_path: &Path,
    artifact_index: usize,
    artifact_count: usize,
    reporter: &dyn InstallProgressReporter,
) -> Result<()> {
    let bytes = read_source(&artifact.url)?;
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(target_path, bytes)?;
    reporter.emit(InstallWorkflowEvent::artifact_progress(
        "downloading",
        "Artifact downloaded",
        key.as_str(),
        artifact_index,
        artifact_count,
        artifact.size.unwrap_or_else(|| file_size(target_path).unwrap_or(0)),
        artifact.size,
        Some(target_path.to_path_buf()),
    ));
    Ok(())
}

fn materialize_http_artifact(
    artifact: &BootstrapperArtifact,
    key: &ArtifactKey,
    target_path: &Path,
    artifact_index: usize,
    artifact_count: usize,
    reporter: &dyn InstallProgressReporter,
) -> Result<()> {
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let response = ureq::get(&artifact.url)
        .set("Accept", "application/octet-stream")
        .set("Cache-Control", "no-cache")
        .set("Pragma", "no-cache")
        .call()?;
    let bytes_total = response
        .header("Content-Length")
        .and_then(|value| value.parse::<u64>().ok())
        .or(artifact.size);
    let mut reader = response.into_reader();
    let mut file = fs::File::create(target_path)?;
    let mut buffer = [0_u8; 64 * 1024];
    let mut bytes_read = 0_u64;
    let mut next_report_at = 0_u64;

    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])?;
        bytes_read += read as u64;

        if bytes_read >= next_report_at {
            reporter.emit(InstallWorkflowEvent::artifact_progress(
                "downloading",
                "Downloading artifact",
                key.as_str(),
                artifact_index,
                artifact_count,
                bytes_read,
                bytes_total,
                Some(target_path.to_path_buf()),
            ));
            next_report_at = bytes_read.saturating_add(1024 * 1024);
        }
    }
    file.flush()?;

    reporter.emit(InstallWorkflowEvent::artifact_progress(
        "downloading",
        "Artifact downloaded",
        key.as_str(),
        artifact_index,
        artifact_count,
        bytes_read,
        bytes_total,
        Some(target_path.to_path_buf()),
    ));
    Ok(())
}

fn materialize_artifact_with_progress(
    artifact: &BootstrapperArtifact,
    key: &ArtifactKey,
    target_path: &Path,
    artifact_index: usize,
    artifact_count: usize,
    reporter: &dyn InstallProgressReporter,
) -> Result<()> {
    if artifact.url.starts_with("http://") || artifact.url.starts_with("https://") {
        return materialize_http_artifact(
            artifact,
            key,
            target_path,
            artifact_index,
            artifact_count,
            reporter,
        );
    }

    materialize_artifact(
        artifact,
        key,
        target_path,
        artifact_index,
        artifact_count,
        reporter,
    )
}

fn ensure_artifact_executable(path: &Path, key: &ArtifactKey) -> Result<()> {
    if matches!(key, ArtifactKey::Bootstrapper) {
        ensure_executable(path)?;
    }
    Ok(())
}

fn stage_artifact(
    artifact: &BootstrapperArtifact,
    key: ArtifactKey,
    staging_dir: &Path,
    artifact_index: usize,
    artifact_count: usize,
    reporter: &dyn InstallProgressReporter,
) -> Result<StagedArtifact> {
    let file_name = artifact_file_name(artifact, &key)?;
    let target_path = staging_dir.join(file_name);

    if target_path.exists() {
        if let Ok((sha256, size)) = verify_artifact_file(&target_path, artifact, &key) {
            ensure_artifact_executable(&target_path, &key)?;
            reporter.emit(InstallWorkflowEvent::artifact_progress(
                "downloading",
                "Artifact already staged",
                key.as_str(),
                artifact_index,
                artifact_count,
                size,
                Some(size),
                Some(target_path.clone()),
            ));
            return Ok(StagedArtifact {
                key,
                path: target_path,
                reused: true,
                sha256,
                size,
                url: artifact.url.clone(),
            });
        }
        let _ = fs::remove_file(&target_path);
    }

    let temp_path = target_path.with_extension(format!(
        "{}.part-{}",
        target_path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("artifact"),
        std::process::id()
    ));
    let result = (|| -> Result<StagedArtifact> {
        materialize_artifact_with_progress(
            artifact,
            &key,
            &temp_path,
            artifact_index,
            artifact_count,
            reporter,
        )?;
        let (sha256, size) = verify_artifact_file(&temp_path, artifact, &key)?;
        ensure_artifact_executable(&temp_path, &key)?;
        fs::rename(&temp_path, &target_path)?;
        Ok(StagedArtifact {
            key,
            path: target_path,
            reused: false,
            sha256,
            size,
            url: artifact.url.clone(),
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

pub fn stage_artifacts(
    decision: &BootstrapperUpdateDecision,
    staging_root: &Path,
    artifact_keys: Vec<ArtifactKey>,
    reporter: &dyn InstallProgressReporter,
) -> Result<StagingResult> {
    let staging_dir = staging_dir(decision, staging_root)?;
    fs::create_dir_all(&staging_dir)?;

    let mut artifacts = Vec::new();
    if decision.update_available {
        if let Some(dist_artifacts) = &decision.artifacts {
            let artifact_count = artifact_keys.len();
            for (index, key) in artifact_keys.into_iter().enumerate() {
                if let Some(artifact) = artifact_for_key(dist_artifacts, &key) {
                    artifacts.push(stage_artifact(
                        artifact,
                        key,
                        &staging_dir,
                        index + 1,
                        artifact_count,
                        reporter,
                    )?);
                }
            }
        }
    }

    Ok(StagingResult {
        artifacts,
        channel: decision.channel.clone(),
        dist: decision.dist.clone(),
        reason: decision.reason.clone(),
        staging_dir,
        target_version: decision.target_version.clone(),
        update_available: decision.update_available,
    })
}
