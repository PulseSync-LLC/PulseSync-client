use crate::{
    core::{
        error::Result,
        fs_ops::{ensure_executable, file_size, sha256_directory, sha256_file},
        install_state::read_install_state_metadata,
        path_segment::sanitize_path_segment,
    },
    domain::delta::apply_delta,
    domain::install_workflow::events::{InstallProgressReporter, InstallWorkflowEvent},
    domain::manifest::{
        BootstrapperArtifact, BootstrapperUpdateDecision, ComponentFileSet, artifact_for_key,
        read_source,
    },
};
use serde::{Deserialize, Deserializer, Serialize, Serializer, de};
use std::{
    cell::Cell,
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};
use zip::{ZipWriter, write::SimpleFileOptions};

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ArtifactKey {
    Host,
    Bootstrapper,
    Module(String),
}

impl ArtifactKey {
    pub fn from_str(value: &str) -> Result<Self> {
        if value == "host" {
            return Ok(Self::Host);
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
            Self::Host => "host".to_string(),
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
    #[serde(rename = "downloadedBytes")]
    pub downloaded_bytes: u64,
    #[serde(rename = "fileOperations")]
    pub file_operations: Vec<StagedFileOperation>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct StagedFileOperation {
    pub path: String,
    pub action: String,
    pub delivery: String,
    #[serde(rename = "downloadBytes")]
    pub download_bytes: u64,
    #[serde(rename = "resultSha256")]
    pub result_sha256: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct StagingResult {
    pub artifacts: Vec<StagedArtifact>,
    pub failures: Vec<StagingFailure>,
    pub channel: String,
    pub dist: String,
    pub reason: String,
    #[serde(rename = "stagingDir")]
    pub staging_dir: PathBuf,
    #[serde(rename = "targetVersion")]
    pub target_version: String,
    #[serde(rename = "bundleVersion")]
    pub bundle_version: String,
    #[serde(rename = "updateAvailable")]
    pub update_available: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct StagingFailure {
    pub key: ArtifactKey,
    pub required: bool,
    pub reason: String,
}

pub fn selected_artifact_keys(decision: &BootstrapperUpdateDecision) -> Result<Vec<ArtifactKey>> {
    decision
        .selected_artifacts
        .iter()
        .map(|key| ArtifactKey::from_str(key))
        .collect()
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
    if let Some(expected) = artifact.size
        && expected != size
    {
        return Err(format!(
            "downloaded {} size mismatch: expected {expected}, got {size}",
            key.as_str()
        )
        .into());
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
        .join(sanitize_path_segment(&decision.bundle_version)?)
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
        artifact
            .size
            .unwrap_or_else(|| file_size(target_path).unwrap_or(0)),
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

    let response = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(30))
        .build()
        .get(&artifact.url)
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

pub(crate) fn stage_artifact(
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
                downloaded_bytes: 0,
                file_operations: Vec::new(),
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
            downloaded_bytes: size,
            file_operations: Vec::new(),
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result
}

fn safe_relative_path(value: &str) -> Result<PathBuf> {
    let mut path = PathBuf::new();
    for segment in value.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(format!("unsafe component file path: {value}").into());
        }
        path.push(segment);
    }
    Ok(path)
}

fn collect_relative_files(root: &Path) -> Result<Vec<String>> {
    fn visit(root: &Path, current: &Path, files: &mut Vec<String>) -> Result<()> {
        if !current.is_dir() {
            return Ok(());
        }
        for entry in fs::read_dir(current)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                visit(root, &path, files)?;
            } else if path.is_file() {
                files.push(
                    path.strip_prefix(root)?
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    visit(root, root, &mut files)?;
    files.sort();
    Ok(files)
}

#[cfg(unix)]
fn zip_permissions(path: &Path) -> Result<u32> {
    use std::os::unix::fs::PermissionsExt;
    Ok(fs::metadata(path)?.permissions().mode() & 0o777)
}

#[cfg(not(unix))]
fn zip_permissions(_path: &Path) -> Result<u32> {
    Ok(0o644)
}

fn write_snapshot_archive(source: &Path, module_name: &str, target: &Path) -> Result<()> {
    let file = fs::File::create(target)?;
    let mut archive = ZipWriter::new(file);
    for relative in collect_relative_files(source)? {
        let source_path = source.join(safe_relative_path(&relative)?);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(zip_permissions(&source_path)?);
        archive.start_file(format!("{module_name}/{relative}"), options)?;
        let mut input = fs::File::open(source_path)?;
        std::io::copy(&mut input, &mut archive)?;
    }
    archive.finish()?;
    Ok(())
}

fn stage_full_fallback(
    fallback: &BootstrapperArtifact,
    key: ArtifactKey,
    result_sha256: &str,
    staging_dir: &Path,
    artifact_index: usize,
    artifact_count: usize,
    reporter: &dyn InstallProgressReporter,
) -> Result<StagedArtifact> {
    let mut staged = stage_artifact(
        fallback,
        key,
        staging_dir,
        artifact_index,
        artifact_count,
        reporter,
    )?;
    staged.file_operations.push(StagedFileOperation {
        path: "*".to_string(),
        action: "new".to_string(),
        delivery: "full-fallback".to_string(),
        download_bytes: staged.downloaded_bytes,
        result_sha256: result_sha256.to_string(),
    });
    Ok(staged)
}

fn stage_file_set(
    key: ArtifactKey,
    archive_root: &str,
    file_set: &ComponentFileSet,
    fallback: &BootstrapperArtifact,
    source_root: Option<PathBuf>,
    staging_dir: &Path,
    artifact_index: usize,
    artifact_count: usize,
    reporter: &dyn InstallProgressReporter,
) -> Result<StagedArtifact> {
    let progress_total = file_set
        .files
        .iter()
        .fold(0_u64, |total, file| total.saturating_add(file.size));
    let component_reporter = WeightedArtifactProgressReporter {
        inner: reporter,
        bytes_offset: 0,
        bytes_weight: progress_total,
        bytes_total: progress_total,
    };
    let source_root = source_root.filter(|path| path.is_dir());
    let source_hashes = source_root
        .as_ref()
        .map(|root| {
            file_set
                .files
                .iter()
                .filter_map(|file| {
                    let source = safe_relative_path(&file.path)
                        .ok()
                        .map(|path| root.join(path))?;
                    source
                        .is_file()
                        .then(|| sha256_file(&source).ok())
                        .flatten()
                        .map(|sha| (file.path.clone(), sha))
                })
                .collect::<BTreeMap<_, _>>()
        })
        .unwrap_or_default();
    let estimated_download = file_set.files.iter().fold(0_u64, |total, file| {
        let bytes = match source_hashes.get(&file.path) {
            Some(source_sha) if source_sha.eq_ignore_ascii_case(&file.sha256) => 0,
            Some(source_sha) => file
                .patches
                .iter()
                .find(|patch| patch.from_sha256.eq_ignore_ascii_case(source_sha))
                .and_then(|patch| patch.artifact.size)
                .unwrap_or(file.size),
            None => file.size,
        };
        total.saturating_add(bytes)
    });
    if fallback
        .size
        .is_some_and(|fallback_size| estimated_download >= fallback_size)
    {
        return stage_full_fallback(
            fallback,
            key,
            &file_set.content_sha256,
            staging_dir,
            artifact_index,
            artifact_count,
            &component_reporter,
        );
    }
    let safe_key = sanitize_path_segment(&key.as_str().replace(':', "-"))?;
    let work_dir = staging_dir.join(format!(".snapshot-{}-{}", safe_key, std::process::id()));
    let snapshot_dir = work_dir.join("snapshot");
    if work_dir.exists() {
        fs::remove_dir_all(&work_dir)?;
    }
    fs::create_dir_all(&snapshot_dir)?;
    let result = (|| -> Result<StagedArtifact> {
        let target_paths = file_set
            .files
            .iter()
            .map(|file| file.path.clone())
            .collect::<BTreeSet<_>>();
        let mut operations = Vec::new();
        let mut downloaded_bytes = 0_u64;
        let mut progress_completed = 0_u64;
        for (file_index, file) in file_set.files.iter().enumerate() {
            let file_reporter = WeightedArtifactProgressReporter {
                inner: reporter,
                bytes_offset: progress_completed,
                bytes_weight: file.size,
                bytes_total: progress_total,
            };
            let relative = safe_relative_path(&file.path)?;
            let destination = snapshot_dir.join(&relative);
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent)?;
            }
            let source = source_root.as_ref().map(|root| root.join(&relative));
            let source_with_sha = source
                .as_ref()
                .and_then(|path| source_hashes.get(&file.path).map(|sha| (path, sha.clone())));
            let (action, delivery, operation_download_bytes) = if let Some((source, _)) =
                source_with_sha
                    .as_ref()
                    .filter(|(_, sha)| sha.eq_ignore_ascii_case(&file.sha256))
            {
                if fs::hard_link(source, &destination).is_ok() {
                    ("link", "none", 0)
                } else {
                    fs::copy(source, &destination)?;
                    ("existing", "none", 0)
                }
            } else {
                let patched = source_with_sha.as_ref().and_then(|(source, source_sha)| {
                    let delta = file
                        .patches
                        .iter()
                        .find(|patch| patch.from_sha256.eq_ignore_ascii_case(source_sha))?;
                    let patch_dir = work_dir.join("patches");
                    fs::create_dir_all(&patch_dir).ok()?;
                    let patch_path = patch_dir.join(format!("{file_index}.patch"));
                    let result = (|| -> Result<()> {
                        materialize_artifact_with_progress(
                            &delta.artifact,
                            &key,
                            &patch_path,
                            file_index + 1,
                            file_set.files.len(),
                            &file_reporter,
                        )?;
                        verify_artifact_file(&patch_path, &delta.artifact, &key)?;
                        apply_delta(source, &patch_path, &destination, delta)
                    })();
                    let _ = fs::remove_file(&patch_path);
                    result.ok().map(|_| delta.artifact.size.unwrap_or(0))
                });
                if let Some(patch_bytes) = patched {
                    downloaded_bytes = downloaded_bytes.saturating_add(patch_bytes);
                    ("new", "bsdiff", patch_bytes)
                } else {
                    let _ = fs::remove_file(&destination);
                    materialize_artifact_with_progress(
                        &file.artifact,
                        &key,
                        &destination,
                        file_index + 1,
                        file_set.files.len(),
                        &file_reporter,
                    )?;
                    verify_artifact_file(&destination, &file.artifact, &key)?;
                    downloaded_bytes = downloaded_bytes.saturating_add(file.size);
                    ("new", "full", file.size)
                }
            };
            if file.executable {
                ensure_executable(&destination)?;
            }
            operations.push(StagedFileOperation {
                path: file.path.clone(),
                action: action.to_string(),
                delivery: delivery.to_string(),
                download_bytes: operation_download_bytes,
                result_sha256: file.sha256.clone(),
            });
            progress_completed = progress_completed.saturating_add(file.size);
        }
        if let Some(source_root) = source_root.as_ref() {
            for deleted in collect_relative_files(source_root)?
                .into_iter()
                .filter(|path| !target_paths.contains(path))
            {
                operations.push(StagedFileOperation {
                    path: deleted,
                    action: "delete".to_string(),
                    delivery: "none".to_string(),
                    download_bytes: 0,
                    result_sha256: String::new(),
                });
            }
        }
        reporter.emit(InstallWorkflowEvent::stage(
            "preparing",
            format!("Preparing {} snapshot", key.as_str()),
        ));
        let content_sha = sha256_directory(&snapshot_dir)?;
        if !content_sha.eq_ignore_ascii_case(&file_set.content_sha256) {
            return Err(format!(
                "reconstructed {} hash mismatch: expected {}, got {content_sha}",
                key.as_str(),
                file_set.content_sha256
            )
            .into());
        }
        let target_path = staging_dir.join(format!("pulsesync-{safe_key}-snapshot.zip"));
        let temp_path = target_path.with_extension(format!("zip.part-{}", std::process::id()));
        write_snapshot_archive(&snapshot_dir, archive_root, &temp_path)?;
        if target_path.exists() {
            fs::remove_file(&target_path)?;
        }
        fs::rename(&temp_path, &target_path)?;
        let sha256 = sha256_file(&target_path)?;
        let size = file_size(&target_path)?;
        reporter.emit(InstallWorkflowEvent::artifact_progress(
            "downloading",
            "Component snapshot prepared",
            key.as_str(),
            artifact_index,
            artifact_count,
            progress_total,
            Some(progress_total),
            Some(target_path.clone()),
        ));
        Ok(StagedArtifact {
            key: key.clone(),
            path: target_path,
            reused: downloaded_bytes == 0,
            sha256,
            size,
            url: "reconstructed:file-inventory".to_string(),
            downloaded_bytes,
            file_operations: operations,
        })
    })();
    let _ = fs::remove_dir_all(&work_dir);
    match result {
        Ok(staged) => Ok(staged),
        Err(_) => stage_full_fallback(
            fallback,
            key,
            &file_set.content_sha256,
            staging_dir,
            artifact_index,
            artifact_count,
            &component_reporter,
        ),
    }
}

struct AggregateArtifactProgressReporter<'a> {
    inner: &'a dyn InstallProgressReporter,
    bytes_offset: u64,
    bytes_total: Option<u64>,
    last_bytes_read: &'a Cell<u64>,
}

impl InstallProgressReporter for AggregateArtifactProgressReporter<'_> {
    fn emit(&self, mut event: InstallWorkflowEvent) {
        if event.event == "artifact-progress"
            && let Some(bytes_total) = self.bytes_total
        {
            let bytes_read = event
                .bytes_read
                .map(|bytes| self.bytes_offset.saturating_add(bytes).min(bytes_total))
                .unwrap_or(self.bytes_offset.min(bytes_total));
            let bytes_read = bytes_read.max(self.last_bytes_read.get());
            self.last_bytes_read.set(bytes_read);
            event.bytes_read = Some(bytes_read);
            event.bytes_total = Some(bytes_total);
        }
        self.inner.emit(event);
    }
}

struct WeightedArtifactProgressReporter<'a> {
    inner: &'a dyn InstallProgressReporter,
    bytes_offset: u64,
    bytes_weight: u64,
    bytes_total: u64,
}

impl InstallProgressReporter for WeightedArtifactProgressReporter<'_> {
    fn emit(&self, mut event: InstallWorkflowEvent) {
        if event.event == "artifact-progress"
            && let (Some(bytes_read), Some(bytes_total)) = (event.bytes_read, event.bytes_total)
            && bytes_total > 0
        {
            let scaled = ((bytes_read.min(bytes_total) as u128 * self.bytes_weight as u128)
                / bytes_total as u128) as u64;
            event.bytes_read = Some(self.bytes_offset.saturating_add(scaled));
            event.bytes_total = Some(self.bytes_total);
        }
        self.inner.emit(event);
    }
}

fn artifact_progress_weight(
    artifact: &BootstrapperArtifact,
    file_set: Option<&ComponentFileSet>,
) -> Option<u64> {
    file_set.map_or(artifact.size, |set| {
        Some(
            set.files
                .iter()
                .fold(0_u64, |total, file| total.saturating_add(file.size)),
        )
    })
}

pub fn stage_artifacts(
    decision: &BootstrapperUpdateDecision,
    state_root: Option<&Path>,
    staging_root: &Path,
    artifact_keys: Vec<ArtifactKey>,
    reporter: &dyn InstallProgressReporter,
) -> Result<StagingResult> {
    let staging_dir = staging_dir(decision, staging_root)?;
    fs::create_dir_all(&staging_dir)?;

    let mut artifacts = Vec::new();
    let mut failures = Vec::new();
    if decision.update_available
        && let Some(dist_artifacts) = &decision.artifacts
    {
        let installed_state = state_root.and_then(|root| read_install_state_metadata(root).ok());
        let selected = artifact_keys
            .into_iter()
            .filter_map(|key| {
                artifact_for_key(dist_artifacts, &key).map(|artifact| {
                    let file_set = match &key {
                        ArtifactKey::Host => dist_artifacts.host_files.as_ref(),
                        ArtifactKey::Module(module_name) => {
                            dist_artifacts.module_files.get(module_name)
                        }
                        _ => None,
                    };
                    (key, artifact, file_set)
                })
            })
            .collect::<Vec<_>>();
        let bytes_total = selected
            .iter()
            .try_fold(0_u64, |total, (_, artifact, file_set)| {
                artifact_progress_weight(artifact, *file_set)
                    .and_then(|size| total.checked_add(size))
            });
        let artifact_count = selected.len();
        let mut bytes_completed = 0_u64;
        let last_bytes_read = Cell::new(0_u64);
        for (index, (key, artifact, file_set)) in selected.into_iter().enumerate() {
            let progress_weight = artifact_progress_weight(artifact, file_set).unwrap_or(0);
            let aggregate_reporter = AggregateArtifactProgressReporter {
                inner: reporter,
                bytes_offset: bytes_completed,
                bytes_total,
                last_bytes_read: &last_bytes_read,
            };
            let required = decision
                .plan
                .iter()
                .find(|item| item.key == key.as_str())
                .map(|item| item.required)
                .unwrap_or(true);
            let staged = match file_set {
                Some(file_set) => {
                    let (archive_root, source_root) = match &key {
                        ArtifactKey::Host => (
                            "host",
                            installed_state.as_ref().and_then(|state| {
                                state_root.map(|root| root.join(&state.latest.host.path))
                            }),
                        ),
                        ArtifactKey::Module(module_name) => (
                            decision
                                .component_disk_names
                                .get(module_name)
                                .map(String::as_str)
                                .unwrap_or(module_name.as_str()),
                            installed_state.as_ref().and_then(|state| {
                                state_root.and_then(|root| {
                                    state
                                        .latest
                                        .components
                                        .get(module_name)
                                        .map(|component| root.join(&component.path))
                                })
                            }),
                        ),
                        ArtifactKey::Bootstrapper => {
                            unreachable!("bootstrapper has no file set")
                        }
                    };
                    stage_file_set(
                        key.clone(),
                        archive_root,
                        file_set,
                        artifact,
                        source_root,
                        &staging_dir,
                        index + 1,
                        artifact_count,
                        &aggregate_reporter,
                    )
                }
                _ => stage_artifact(
                    artifact,
                    key.clone(),
                    &staging_dir,
                    index + 1,
                    artifact_count,
                    &aggregate_reporter,
                ),
            };
            match staged {
                Ok(staged) => {
                    bytes_completed = bytes_completed.saturating_add(progress_weight);
                    artifacts.push(staged);
                }
                Err(error) if !required => {
                    let failed_bytes = file_set
                        .map(|set| {
                            let file_bytes = set.files.iter().map(|file| file.size).sum::<u64>();
                            artifact
                                .size
                                .map_or(file_bytes, |archive_bytes| file_bytes.min(archive_bytes))
                        })
                        .or(artifact.size)
                        .unwrap_or(0);
                    bytes_completed =
                        bytes_completed.saturating_add(progress_weight.max(failed_bytes));
                    failures.push(StagingFailure {
                        key,
                        required,
                        reason: error.to_string(),
                    });
                }
                Err(error) => return Err(error),
            }
        }
    }

    Ok(StagingResult {
        artifacts,
        failures,
        channel: decision.channel.clone(),
        dist: decision.dist.clone(),
        reason: decision.reason.clone(),
        staging_dir,
        target_version: decision.target_version.clone(),
        bundle_version: decision.bundle_version.clone(),
        update_available: decision.update_available,
    })
}
