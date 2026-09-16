use crate::{
    core::{error::Result, fs_ops::sha256_file},
    domain::manifest::{DeltaArtifact, DeltaProvider},
};
use qbsdiff::Bspatch;
use sha2::{Digest, Sha256};
use std::{error::Error, fmt, fs, io::Cursor, path::Path};

const MAX_DELTA_RESULT_SIZE: u64 = 1024 * 1024 * 1024;

#[derive(Debug)]
pub struct DeltaApplyError {
    code: &'static str,
    message: String,
}

impl DeltaApplyError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn code(&self) -> &'static str {
        self.code
    }
}

impl fmt::Display for DeltaApplyError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl Error for DeltaApplyError {}

pub fn delta_error_code(error: &(dyn Error + 'static)) -> &'static str {
    error
        .downcast_ref::<DeltaApplyError>()
        .map(DeltaApplyError::code)
        .unwrap_or("delta-apply-failed")
}

fn validate_delta_metadata(delta: &DeltaArtifact) -> Result<()> {
    if delta.provider != DeltaProvider::Bsdiff {
        return Err(Box::new(DeltaApplyError::new(
            "delta-provider-unavailable",
            "only bsdiff deltas are supported by this bootstrapper build",
        )));
    }
    if delta.result_size > MAX_DELTA_RESULT_SIZE {
        return Err(Box::new(DeltaApplyError::new(
            "delta-result-too-large",
            "delta result exceeds the bootstrapper safety limit",
        )));
    }
    Ok(())
}

fn validate_delta_inputs(source: &Path, patch: &Path, delta: &DeltaArtifact) -> Result<()> {
    validate_delta_metadata(delta)?;
    let source_sha = sha256_file(source)?;
    if !source_sha.eq_ignore_ascii_case(&delta.from_sha256) {
        return Err(Box::new(DeltaApplyError::new(
            "delta-source-sha256-mismatch",
            format!("expected {}, got {source_sha}", delta.from_sha256),
        )));
    }
    let patch_sha = sha256_file(patch)?;
    if !patch_sha.eq_ignore_ascii_case(&delta.artifact.sha256) {
        return Err(Box::new(DeltaApplyError::new(
            "delta-patch-sha256-mismatch",
            format!("expected {}, got {patch_sha}", delta.artifact.sha256),
        )));
    }
    Ok(())
}

fn apply_delta_payload(
    source: &Path,
    patch: &Path,
    target: &Path,
    delta: &DeltaArtifact,
) -> Result<()> {
    let _ = fs::remove_file(target);

    let source_bytes = fs::read(source)?;
    let patch_bytes = fs::read(patch)?;
    let patcher = Bspatch::new(&patch_bytes).map_err(|error| {
        Box::new(DeltaApplyError::new(
            "bsdiff-patch-invalid",
            error.to_string(),
        )) as Box<dyn Error>
    })?;
    if patcher.hint_target_size() != delta.result_size {
        return Err(Box::new(DeltaApplyError::new(
            "bsdiff-target-size-mismatch",
            "delta patch target size does not match manifest resultSize",
        )));
    }

    let mut result = Vec::with_capacity(delta.result_size as usize);
    patcher
        .apply(&source_bytes, Cursor::new(&mut result))
        .map_err(|error| {
            Box::new(DeltaApplyError::new(
                "bsdiff-apply-failed",
                error.to_string(),
            )) as Box<dyn Error>
        })?;
    if result.len() as u64 != delta.result_size {
        return Err(Box::new(DeltaApplyError::new(
            "delta-output-size-mismatch",
            format!("expected {}, got {}", delta.result_size, result.len()),
        )));
    }

    let result_sha = hex::encode(Sha256::digest(&result));
    if !result_sha.eq_ignore_ascii_case(&delta.result_sha256) {
        return Err(Box::new(DeltaApplyError::new(
            "delta-result-sha256-mismatch",
            format!("expected {}, got {result_sha}", delta.result_sha256),
        )));
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(target, result)?;

    let result_size = fs::metadata(target)?.len();
    if result_size != delta.result_size {
        let _ = fs::remove_file(target);
        return Err(Box::new(DeltaApplyError::new(
            "delta-output-size-mismatch",
            format!("expected {}, got {result_size}", delta.result_size),
        )));
    }
    Ok(())
}

pub fn apply_delta(
    source: &Path,
    patch: &Path,
    target: &Path,
    delta: &DeltaArtifact,
) -> Result<()> {
    validate_delta_inputs(source, patch, delta)?;
    apply_delta_payload(source, patch, target, delta)
}

pub fn apply_verified_delta(
    source: &Path,
    source_sha: &str,
    patch: &Path,
    target: &Path,
    delta: &DeltaArtifact,
) -> Result<()> {
    validate_delta_metadata(delta)?;
    if !source_sha.eq_ignore_ascii_case(&delta.from_sha256) {
        return Err(Box::new(DeltaApplyError::new(
            "delta-source-sha256-mismatch",
            format!("expected {}, got {source_sha}", delta.from_sha256),
        )));
    }
    apply_delta_payload(source, patch, target, delta)
}
