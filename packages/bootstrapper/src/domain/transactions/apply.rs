use crate::{
    core::{
        error::Result,
        fs_ops::{ensure_executable, extract_zip_to, sha256_file},
        layout::assert_inside,
        path_segment::sanitize_path_segment,
    },
    domain::transactions::{
        model::TransactionArtifact,
        store::{transaction_artifacts, write_transaction},
    },
};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
};

fn write_current_version(install_dir: &Path, version: &str) -> Result<()> {
    let current_file = install_dir.join("current.json");
    let temp_file = current_file.with_extension(format!("json.tmp-{}", std::process::id()));
    let payload = json!({
        "schemaVersion": 1,
        "version": version,
    });

    if let Some(parent) = current_file.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(
        &temp_file,
        format!("{}\n", serde_json::to_string_pretty(&payload)?),
    )?;
    fs::rename(&temp_file, &current_file)?;
    Ok(())
}

fn verify_artifact(artifact: &TransactionArtifact) -> Result<()> {
    let stat = fs::metadata(&artifact.prepared_path)?;
    if !stat.is_file() {
        return Err(format!(
            "prepared artifact path is not a file: {}",
            artifact.prepared_path.display()
        )
        .into());
    }
    if stat.len() != artifact.size {
        return Err(format!(
            "prepared artifact size mismatch: expected {}, got {}",
            artifact.size,
            stat.len()
        )
        .into());
    }
    let actual = sha256_file(&artifact.prepared_path)?;
    if actual.to_lowercase() != artifact.sha256.to_lowercase() {
        return Err(format!(
            "prepared artifact sha256 mismatch: expected {}, got {actual}",
            artifact.sha256
        )
        .into());
    }
    Ok(())
}

fn backup_target(artifact: &TransactionArtifact) -> Result<&'static str> {
    if !artifact.target_path.exists() {
        return Ok("missing");
    }
    if artifact.backup_path.exists() {
        return Err(format!(
            "backup path already exists: {}",
            artifact.backup_path.display()
        )
        .into());
    }
    if let Some(parent) = artifact.backup_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(&artifact.target_path, &artifact.backup_path)?;
    Ok("created")
}

fn find_extracted_directory(temp_dir: &Path, target_path: &Path) -> Result<PathBuf> {
    let target_name = target_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let mut root_directories = Vec::new();

    let mut pending = vec![temp_dir.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(&directory)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if directory == temp_dir {
                root_directories.push(path.clone());
            }
            if entry.file_name().to_string_lossy() == target_name {
                return Ok(path);
            }
            pending.push(path);
        }
    }

    if root_directories.len() == 1 {
        return Ok(root_directories.remove(0));
    }

    Ok(temp_dir.to_path_buf())
}

fn apply_file_artifact(artifact: &TransactionArtifact) -> Result<Value> {
    let backup_status = backup_target(artifact)?;
    if let Some(parent) = artifact.target_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(&artifact.prepared_path, &artifact.target_path)?;
    if artifact.key == "bootstrapper" {
        ensure_executable(&artifact.target_path)?;
    }
    Ok(json!({
        "key": artifact.key,
        "action": artifact.action,
        "preparedKind": artifact.prepared_kind,
        "preparedPath": artifact.prepared_path,
        "backupPath": artifact.backup_path,
        "targetPath": artifact.target_path,
        "sourcePath": artifact.source_path,
        "sha256": artifact.sha256,
        "size": artifact.size,
        "backupStatus": backup_status,
        "status": "applied",
        "message": "File artifact applied"
    }))
}

fn apply_directory_archive_artifact(
    artifact: &TransactionArtifact,
    transaction_dir: &Path,
) -> Result<Value> {
    if artifact.prepared_kind != "archive" {
        return Err("directory archive artifact must have preparedKind=archive".into());
    }

    let temp_dir = transaction_dir.join(format!(
        "apply-temp-{}-{}",
        sanitize_path_segment(&artifact.key)?,
        std::process::id()
    ));
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)?;
    }
    fs::create_dir_all(&temp_dir)?;

    let apply_result = (|| -> Result<Value> {
        extract_zip_to(&artifact.prepared_path, &temp_dir)?;
        let extracted = find_extracted_directory(&temp_dir, &artifact.target_path)?;
        let backup_status = backup_target(artifact)?;
        if let Some(parent) = artifact.target_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(extracted, &artifact.target_path)?;
        Ok(json!({
            "key": artifact.key,
            "action": artifact.action,
            "preparedKind": artifact.prepared_kind,
            "preparedPath": artifact.prepared_path,
            "backupPath": artifact.backup_path,
            "targetPath": artifact.target_path,
            "sourcePath": artifact.source_path,
            "sha256": artifact.sha256,
            "size": artifact.size,
            "backupStatus": backup_status,
            "status": "applied",
            "message": "Directory archive extracted and moved to transaction-recorded target path"
        }))
    })();
    let _ = fs::remove_dir_all(&temp_dir);
    apply_result
}

fn apply_artifact(artifact: &TransactionArtifact, transaction_dir: &Path) -> Result<Value> {
    verify_artifact(artifact)?;

    match artifact.action.as_str() {
        "replace-file" => apply_file_artifact(artifact),
        "replace-directory-archive" => apply_directory_archive_artifact(artifact, transaction_dir),
        _ => Err(format!("unsupported artifact action: {}", artifact.action).into()),
    }
}

pub fn apply_transaction_file(transaction_file: &Path) -> Result<Value> {
    let payload = fs::read_to_string(transaction_file)?;
    let mut transaction: Value = serde_json::from_str(&payload)?;
    if transaction.get("state").and_then(Value::as_str) != Some("prepared") {
        return Err("transaction state must be prepared".into());
    }

    let transaction_dir = PathBuf::from(
        transaction
            .get("transactionDir")
            .and_then(Value::as_str)
            .ok_or("transactionDir is required")?,
    );
    let install_dir = PathBuf::from(
        transaction
            .get("installDir")
            .and_then(Value::as_str)
            .ok_or("installDir is required")?,
    );
    let backup_dir = PathBuf::from(
        transaction
            .get("backupDir")
            .and_then(Value::as_str)
            .ok_or("backupDir is required")?,
    );
    let artifacts = transaction_artifacts(&transaction)?;
    let mut applied = Vec::new();
    let should_switch_current_version = artifacts.iter().any(|artifact| artifact.key == "app");

    for artifact in &artifacts {
        assert_inside(
            &transaction_dir,
            &artifact.prepared_path,
            "prepared artifact",
        )?;
        assert_inside(&install_dir, &artifact.target_path, "target artifact")?;
        assert_inside(&backup_dir, &artifact.backup_path, "backup artifact")?;
        match apply_artifact(artifact, &transaction_dir) {
            Ok(value) => applied.push(value),
            Err(error) => {
                transaction["state"] = json!("failed");
                transaction["applied"] = json!(false);
                transaction["error"] = json!(error.to_string());
                transaction["artifacts"] = Value::Array(applied);
                write_transaction(transaction_file, &transaction)?;
                return Ok(transaction);
            }
        }
    }

    transaction["state"] = json!("applied");
    transaction["applied"] = json!(true);
    transaction["artifacts"] = Value::Array(applied);
    if should_switch_current_version {
        let target_version = transaction
            .get("targetVersion")
            .and_then(Value::as_str)
            .ok_or("targetVersion is required to switch current version")?
            .to_string();
        write_current_version(&install_dir, &target_version)?;
        transaction["currentVersionFile"] = json!(install_dir.join("current.json"));
        transaction["currentVersion"] = json!(target_version);
    }
    write_transaction(transaction_file, &transaction)?;
    Ok(transaction)
}
