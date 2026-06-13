use crate::file_ops::{copy_path, delete_path};
use crate::fs_transaction::{DirectoryTransaction, unique_sibling};
use flate2::read::GzDecoder;
use napi_derive::napi;
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;
use zip::ZipArchive;

#[napi(object)]
pub struct NativeArtifactDurations {
    pub read_ms: u32,
    pub checksum_ms: u32,
    pub decompress_ms: u32,
    pub write_ms: u32,
    pub clone_ms: u32,
    pub extract_ms: u32,
    pub cache_write_ms: u32,
    pub backup_ms: u32,
    pub install_ms: u32,
    pub cleanup_ms: u32,
}

impl Default for NativeArtifactDurations {
    fn default() -> Self {
        Self {
            read_ms: 0,
            checksum_ms: 0,
            decompress_ms: 0,
            write_ms: 0,
            clone_ms: 0,
            extract_ms: 0,
            cache_write_ms: 0,
            backup_ms: 0,
            install_ms: 0,
            cleanup_ms: 0,
        }
    }
}

#[napi(object)]
pub struct NativeArtifactWarning {
    pub stage: String,
    pub code: Option<String>,
    pub message: String,
}

#[napi(object)]
pub struct NativeArtifactResult {
    pub ok: bool,
    pub stage: Option<String>,
    pub code: Option<String>,
    pub message: Option<String>,
    pub prepared_path: Option<String>,
    pub durations: NativeArtifactDurations,
    pub warnings: Vec<NativeArtifactWarning>,
}

#[napi(object)]
pub struct PrepareAsarArtifactRequest {
    pub archive_path: String,
    pub archive_extension: String,
    pub expected_checksum: Option<String>,
    pub output_path: String,
}

#[napi(object)]
pub struct PreparedDirectoryMarker {
    pub file_name: String,
    pub value: String,
}

#[napi(object)]
pub struct InstallUnpackedArtifactRequest {
    pub source_kind: String,
    pub archive_path: String,
    pub archive_extension: String,
    pub expected_checksum: Option<String>,
    pub prepared_directory_path: Option<String>,
    pub prepared_directory_marker: Option<PreparedDirectoryMarker>,
    pub staging_path: String,
    pub target_path: String,
}

struct ArtifactError {
    stage: &'static str,
    code: Option<String>,
    message: String,
}

impl ArtifactError {
    fn new(stage: &'static str, message: impl Into<String>) -> Self {
        Self {
            stage,
            code: None,
            message: message.into(),
        }
    }

    fn checksum_mismatch() -> Self {
        Self {
            stage: "checksum",
            code: Some("CHECKSUM_MISMATCH".to_owned()),
            message: "Archive checksum mismatch".to_owned(),
        }
    }

    fn from_io(stage: &'static str, error: io::Error) -> Self {
        Self {
            stage,
            code: error.raw_os_error().map(|code| code.to_string()),
            message: error.to_string(),
        }
    }
}

fn elapsed_ms(started_at: Instant) -> u32 {
    started_at.elapsed().as_millis().min(u128::from(u32::MAX)) as u32
}

fn success(
    prepared_path: Option<String>,
    durations: NativeArtifactDurations,
    warnings: Vec<NativeArtifactWarning>,
) -> NativeArtifactResult {
    NativeArtifactResult {
        ok: true,
        stage: None,
        code: None,
        message: None,
        prepared_path,
        durations,
        warnings,
    }
}

fn failure(
    error: ArtifactError,
    durations: NativeArtifactDurations,
    warnings: Vec<NativeArtifactWarning>,
) -> NativeArtifactResult {
    NativeArtifactResult {
        ok: false,
        stage: Some(error.stage.to_owned()),
        code: error.code,
        message: Some(error.message),
        prepared_path: None,
        durations,
        warnings,
    }
}

struct HashingReader<R> {
    inner: R,
    hasher: Sha256,
}

impl<R> HashingReader<R> {
    fn new(inner: R) -> Self {
        Self {
            inner,
            hasher: Sha256::new(),
        }
    }

    fn finish(self) -> String {
        digest_hex(self.hasher.finalize().as_slice())
    }
}

fn digest_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

impl<R: Read> Read for HashingReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        let read = self.inner.read(buffer)?;
        if read > 0 {
            self.hasher.update(&buffer[..read]);
        }
        Ok(read)
    }
}

fn verify_checksum(actual: String, expected: Option<&str>) -> Result<(), ArtifactError> {
    if expected.is_some_and(|expected| !actual.eq_ignore_ascii_case(expected)) {
        return Err(ArtifactError::checksum_mismatch());
    }
    Ok(())
}

fn hash_file_impl(path: &Path) -> io::Result<String> {
    let file = File::open(path)?;
    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];

    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(digest_hex(hasher.finalize().as_slice()))
}

#[napi]
pub fn hash_file(path: String) -> napi::Result<String> {
    hash_file_impl(Path::new(&path))
        .map_err(|error| napi::Error::from_reason(format!("Failed to hash '{path}': {error}")))
}

fn stream_archive_to_file(
    archive_path: &Path,
    archive_extension: &str,
    output_path: &Path,
    expected_checksum: Option<&str>,
) -> Result<(), ArtifactError> {
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|error| ArtifactError::from_io("write", error))?;
    }

    let input = File::open(archive_path).map_err(|error| ArtifactError::from_io("read", error))?;
    let hashing_reader = HashingReader::new(BufReader::with_capacity(1024 * 1024, input));
    let output =
        File::create(output_path).map_err(|error| ArtifactError::from_io("write", error))?;
    let mut output = BufWriter::with_capacity(1024 * 1024, output);
    let extension = archive_extension.to_ascii_lowercase();

    let actual_checksum = if extension == ".gz" {
        let mut decoder = GzDecoder::new(hashing_reader);
        io::copy(&mut decoder, &mut output)
            .map_err(|error| ArtifactError::from_io("decompress", error))?;
        decoder.into_inner().finish()
    } else if extension == ".zst" || extension == ".zstd" {
        let mut decoder = zstd::stream::read::Decoder::new(hashing_reader)
            .map_err(|error| ArtifactError::from_io("decompress", error))?;
        io::copy(&mut decoder, &mut output)
            .map_err(|error| ArtifactError::from_io("decompress", error))?;
        decoder.finish().into_inner().finish()
    } else {
        let mut reader = hashing_reader;
        io::copy(&mut reader, &mut output)
            .map_err(|error| ArtifactError::from_io("write", error))?;
        reader.finish()
    };

    output
        .flush()
        .map_err(|error| ArtifactError::from_io("write", error))?;
    verify_checksum(actual_checksum, expected_checksum)
}

#[napi]
pub fn prepare_asar_artifact(request: PrepareAsarArtifactRequest) -> NativeArtifactResult {
    let mut durations = NativeArtifactDurations::default();
    let warnings = Vec::new();
    let output_path = PathBuf::from(&request.output_path);
    let started_at = Instant::now();

    let result = stream_archive_to_file(
        Path::new(&request.archive_path),
        &request.archive_extension,
        &output_path,
        request.expected_checksum.as_deref(),
    );
    durations.decompress_ms = elapsed_ms(started_at);

    match result {
        Ok(()) => success(Some(request.output_path), durations, warnings),
        Err(error) => {
            let _ = fs::remove_file(output_path);
            failure(error, durations, warnings)
        }
    }
}

fn extract_zip(zip_path: &Path, destination: &Path) -> Result<(), ArtifactError> {
    let file = File::open(zip_path).map_err(|error| ArtifactError::from_io("extract", error))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| ArtifactError::new("extract", error.to_string()))?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| ArtifactError::new("extract", error.to_string()))?;
        let enclosed = entry.enclosed_name().ok_or_else(|| {
            ArtifactError::new("extract", format!("Unsafe ZIP entry: {}", entry.name()))
        })?;
        let output_path = destination.join(enclosed);

        if entry.is_dir() {
            fs::create_dir_all(&output_path)
                .map_err(|error| ArtifactError::from_io("extract", error))?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|error| ArtifactError::from_io("extract", error))?;
        }
        let output =
            File::create(&output_path).map_err(|error| ArtifactError::from_io("extract", error))?;
        let mut output = BufWriter::new(output);
        io::copy(&mut entry, &mut output)
            .map_err(|error| ArtifactError::from_io("extract", error))?;
        output
            .flush()
            .map_err(|error| ArtifactError::from_io("extract", error))?;

        #[cfg(unix)]
        if let Some(mode) = entry.unix_mode() {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&output_path, fs::Permissions::from_mode(mode))
                .map_err(|error| ArtifactError::from_io("extract", error))?;
        }
    }

    Ok(())
}

fn resolve_extracted_root(staging_path: &Path, target_path: &Path) -> PathBuf {
    let Ok(entries) = fs::read_dir(staging_path) else {
        return staging_path.to_path_buf();
    };
    let entries: Vec<_> = entries
        .flatten()
        .filter(|entry| entry.file_name() != "__MACOSX" && entry.file_name() != ".DS_Store")
        .collect();
    if entries.len() == 1
        && entries[0]
            .file_type()
            .is_ok_and(|file_type| file_type.is_dir())
        && target_path
            .file_name()
            .is_some_and(|name| entries[0].file_name() == name)
    {
        return entries[0].path();
    }
    staging_path.to_path_buf()
}

fn write_prepared_cache(
    source: &Path,
    prepared_path: &Path,
    marker: &PreparedDirectoryMarker,
) -> Result<(), ArtifactError> {
    let temporary_path = unique_sibling(prepared_path, "tmp");
    let _ = delete_path(&temporary_path);
    if let Some(parent) = prepared_path.parent() {
        fs::create_dir_all(parent).map_err(|error| ArtifactError::from_io("cache", error))?;
    }
    copy_path(source, &temporary_path).map_err(|error| ArtifactError::from_io("cache", error))?;
    fs::write(
        temporary_path.join(&marker.file_name),
        format!("{}\n", marker.value),
    )
    .map_err(|error| ArtifactError::from_io("cache", error))?;
    let _ = delete_path(prepared_path);
    fs::rename(&temporary_path, prepared_path)
        .map_err(|error| ArtifactError::from_io("cache", error))
}

fn run_unpacked_install(
    request: &InstallUnpackedArtifactRequest,
    durations: &mut NativeArtifactDurations,
    warnings: &mut Vec<NativeArtifactWarning>,
) -> Result<(), ArtifactError> {
    let archive_path = PathBuf::from(&request.archive_path);
    let staging_path = PathBuf::from(&request.staging_path);
    let target_path = PathBuf::from(&request.target_path);
    let _ = delete_path(&staging_path);

    let extracted_root = if request.source_kind == "directory" {
        let started_at = Instant::now();
        copy_path(&archive_path, &staging_path)
            .map_err(|error| ArtifactError::from_io("extract", error))?;
        durations.clone_ms = elapsed_ms(started_at);
        staging_path.clone()
    } else {
        let extension = request.archive_extension.to_ascii_lowercase();
        let temporary_zip = unique_sibling(&staging_path, "archive.zip");
        let zip_path = if extension == ".gz" || extension == ".zst" || extension == ".zstd" {
            let started_at = Instant::now();
            stream_archive_to_file(
                &archive_path,
                &extension,
                &temporary_zip,
                request.expected_checksum.as_deref(),
            )?;
            durations.decompress_ms = elapsed_ms(started_at);
            temporary_zip.clone()
        } else {
            if let Some(expected) = request.expected_checksum.as_deref() {
                let started_at = Instant::now();
                let actual = hash_file_impl(&archive_path)
                    .map_err(|error| ArtifactError::from_io("checksum", error))?;
                durations.checksum_ms = elapsed_ms(started_at);
                verify_checksum(actual, Some(expected))?;
            }
            archive_path.clone()
        };

        fs::create_dir_all(&staging_path)
            .map_err(|error| ArtifactError::from_io("extract", error))?;
        let started_at = Instant::now();
        let extract_result = extract_zip(&zip_path, &staging_path);
        durations.extract_ms = elapsed_ms(started_at);
        if zip_path == temporary_zip {
            let _ = fs::remove_file(&temporary_zip);
        }
        extract_result?;
        resolve_extracted_root(&staging_path, &target_path)
    };

    if let (Some(prepared_path), Some(marker)) = (
        request.prepared_directory_path.as_deref(),
        request.prepared_directory_marker.as_ref(),
    ) {
        let started_at = Instant::now();
        if let Err(error) = write_prepared_cache(&extracted_root, Path::new(prepared_path), marker)
        {
            warnings.push(NativeArtifactWarning {
                stage: "cache".to_owned(),
                code: error.code,
                message: error.message,
            });
        }
        durations.cache_write_ms = elapsed_ms(started_at);
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|error| ArtifactError::from_io("install", error))?;
    }

    let started_at = Instant::now();
    let mut transaction = DirectoryTransaction::begin(&target_path)
        .map_err(|error| ArtifactError::from_io("backup", error))?;
    durations.backup_ms = elapsed_ms(started_at);

    let started_at = Instant::now();
    if let Err(error) = transaction.install(&extracted_root) {
        transaction
            .restore()
            .map_err(|restore_error| ArtifactError::from_io("restore", restore_error))?;
        return Err(ArtifactError::from_io("install", error));
    }
    durations.install_ms = elapsed_ms(started_at);

    let started_at = Instant::now();
    if let Err(error) = transaction.commit() {
        warnings.push(NativeArtifactWarning {
            stage: "cleanup".to_owned(),
            code: error.raw_os_error().map(|code| code.to_string()),
            message: error.to_string(),
        });
    }
    if staging_path.exists() {
        if let Err(error) = delete_path(&staging_path) {
            warnings.push(NativeArtifactWarning {
                stage: "cleanup".to_owned(),
                code: error.raw_os_error().map(|code| code.to_string()),
                message: error.to_string(),
            });
        }
    }
    durations.cleanup_ms = elapsed_ms(started_at);

    Ok(())
}

#[napi]
pub fn install_unpacked_artifact(request: InstallUnpackedArtifactRequest) -> NativeArtifactResult {
    let mut durations = NativeArtifactDurations::default();
    let mut warnings = Vec::new();
    match run_unpacked_install(&request, &mut durations, &mut warnings) {
        Ok(()) => success(None, durations, warnings),
        Err(error) => {
            let _ = delete_path(Path::new(&request.staging_path));
            failure(error, durations, warnings)
        }
    }
}
