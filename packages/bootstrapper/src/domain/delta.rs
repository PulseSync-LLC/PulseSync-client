use crate::{
    core::{error::Result, fs_ops::sha256_file},
    domain::manifest::{DeltaArtifact, DeltaProvider},
};
use qbsdiff::Bspatch;
use std::{fs, io::Cursor, path::Path};

const MAX_DELTA_RESULT_SIZE: u64 = 1024 * 1024 * 1024;

pub fn apply_delta(
    source: &Path,
    patch: &Path,
    target: &Path,
    delta: &DeltaArtifact,
) -> Result<()> {
    if delta.provider != DeltaProvider::Bsdiff {
        return Err("delta provider is unavailable in this bootstrapper build".into());
    }
    if delta.result_size > MAX_DELTA_RESULT_SIZE {
        return Err("delta result exceeds the bootstrapper safety limit".into());
    }
    let source_sha = sha256_file(source)?;
    if !source_sha.eq_ignore_ascii_case(&delta.from_sha256) {
        return Err(format!(
            "delta source sha256 mismatch: expected {}, got {source_sha}",
            delta.from_sha256
        )
        .into());
    }
    let patch_sha = sha256_file(patch)?;
    if !patch_sha.eq_ignore_ascii_case(&delta.artifact.sha256) {
        return Err(format!(
            "delta patch sha256 mismatch: expected {}, got {patch_sha}",
            delta.artifact.sha256
        )
        .into());
    }
    let source_bytes = fs::read(source)?;
    let patch_bytes = fs::read(patch)?;
    let patcher = Bspatch::new(&patch_bytes)?;
    if patcher.hint_target_size() != delta.result_size {
        return Err("delta patch target size does not match manifest resultSize".into());
    }
    let mut result = Vec::with_capacity(delta.result_size as usize);
    patcher.apply(&source_bytes, Cursor::new(&mut result))?;
    if result.len() as u64 != delta.result_size {
        return Err("delta output size does not match manifest resultSize".into());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(target, result)?;
    let result_sha = sha256_file(target)?;
    if !result_sha.eq_ignore_ascii_case(&delta.result_sha256) {
        let _ = fs::remove_file(target);
        return Err(format!(
            "delta result sha256 mismatch: expected {}, got {result_sha}",
            delta.result_sha256
        )
        .into());
    }
    Ok(())
}
