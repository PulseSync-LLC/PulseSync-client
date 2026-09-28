use crate::{
    cli::args::{Args, required_arg},
    core::{error::Result, fs_ops::sha256_file},
    domain::{
        delta::apply_delta,
        manifest::{BootstrapperArtifact, DeltaArtifact, DeltaProvider},
    },
};
use qbsdiff::Bsdiff;
use serde_json::{Value, json};
use std::{fs, io::Cursor, path::PathBuf};

pub fn make_delta(args: &Args) -> Result<Value> {
    let provider = required_arg(args, "--provider")?;
    if provider != "bsdiff" {
        return Err(format!("delta provider is unavailable: {provider}").into());
    }
    let source = PathBuf::from(required_arg(args, "--source")?);
    let target = PathBuf::from(required_arg(args, "--target")?);
    let output = PathBuf::from(required_arg(args, "--output")?);
    if !source.is_file() || !target.is_file() {
        return Err("delta source and target must be files".into());
    }
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    let source_bytes = fs::read(&source)?;
    let target_bytes = fs::read(&target)?;
    let mut patch = Vec::new();
    Bsdiff::new(&source_bytes, &target_bytes).compare(Cursor::new(&mut patch))?;
    let temporary = output.with_extension(format!("patch.part-{}", std::process::id()));
    fs::write(&temporary, patch)?;
    if output.exists() {
        fs::remove_file(&output)?;
    }
    fs::rename(&temporary, &output)?;
    let source_sha256 = sha256_file(&source)?;
    let target_sha256 = sha256_file(&target)?;
    let patch_sha256 = sha256_file(&output)?;
    let patch_size = fs::metadata(&output)?.len();
    let verification_output = output.with_extension(format!("verify-{}", std::process::id()));
    let delta = DeltaArtifact {
        provider: DeltaProvider::Bsdiff,
        from_sha256: source_sha256.clone(),
        result_sha256: target_sha256.clone(),
        result_size: target_bytes.len() as u64,
        artifact: BootstrapperArtifact {
            sha256: patch_sha256.clone(),
            signature: None,
            signature_algorithm: None,
            size: Some(patch_size),
            url: output.to_string_lossy().to_string(),
        },
    };
    let verification = apply_delta(&source, &output, &verification_output, &delta);
    let verified = verification
        .and_then(|_| Ok(fs::read(&verification_output)? == target_bytes))
        .unwrap_or(false);
    let _ = fs::remove_file(&verification_output);
    if !verified {
        let _ = fs::remove_file(&output);
        return Err("generated bsdiff patch failed runtime round-trip verification".into());
    }
    Ok(json!({
        "schemaVersion": 1,
        "state": "created",
        "provider": provider,
        "sourceSha256": source_sha256,
        "targetSha256": target_sha256,
        "targetSize": fs::metadata(&target)?.len(),
        "patchSha256": patch_sha256,
        "patchSize": patch_size,
        "output": output,
    }))
}
