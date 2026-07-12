use crate::{
    core::{
        error::Result,
        fs_ops::{ensure_executable, extract_zip_to, sha256_directory, sha256_file},
        install_state::{
            ActivationState, RuntimeActivationV3, RuntimeComponentV3, read_install_state,
            write_install_state,
        },
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

fn verify_result_content(transaction: &Value, artifact: &TransactionArtifact) -> Result<()> {
    let expected = if artifact.key == "host" {
        transaction.get("hostContentSha256").and_then(Value::as_str)
    } else if let Some(name) = artifact.key.strip_prefix("module:") {
        transaction
            .get("componentContentSha256s")
            .and_then(Value::as_object)
            .and_then(|values| values.get(name))
            .and_then(Value::as_str)
    } else {
        None
    };
    let Some(expected) = expected else {
        return Ok(());
    };
    let actual = sha256_directory(&artifact.target_path)?;
    if !actual.eq_ignore_ascii_case(expected) {
        return Err(format!(
            "{} result content sha256 mismatch: expected {expected}, got {actual}",
            artifact.key
        )
        .into());
    }
    Ok(())
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
    // Validate and capture the current runtime before replacing any component.
    // A bootstrapper self-update changes the file referenced by the current
    // snapshot, so reading the state after the replacement would incorrectly
    // reject the old snapshot because its recorded hash no longer matches.
    let mut install_state = read_install_state(&install_dir)?;
    let mut applied = Vec::new();

    for artifact in &artifacts {
        assert_inside(
            &transaction_dir,
            &artifact.prepared_path,
            "prepared artifact",
        )?;
        assert_inside(&install_dir, &artifact.target_path, "target artifact")?;
        assert_inside(&backup_dir, &artifact.backup_path, "backup artifact")?;
        match apply_artifact(artifact, &transaction_dir)
            .and_then(|value| verify_result_content(&transaction, artifact).map(|_| value))
        {
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
    let mut next_snapshot = install_state.latest.clone();
    let component_versions = transaction
        .get("componentVersions")
        .and_then(Value::as_object)
        .ok_or("componentVersions is required")?;
    let component_electron_abis = transaction
        .get("componentElectronAbis")
        .and_then(Value::as_object)
        .ok_or("componentElectronAbis is required")?;
    let component_artifact_sha256s = transaction
        .get("componentArtifactSha256s")
        .and_then(Value::as_object);
    let omitted_values = transaction
        .get("omittedComponents")
        .and_then(Value::as_array)
        .ok_or("omittedComponents is required")?;
    let mut omitted_components = Vec::with_capacity(omitted_values.len());
    for value in omitted_values {
        omitted_components.push(
            value
                .as_str()
                .ok_or("omittedComponents must contain strings")?,
        );
    }
    for artifact in &artifacts {
        let relative_path = artifact
            .target_path
            .strip_prefix(&install_dir)?
            .to_path_buf();
        if artifact.key == "host" {
            next_snapshot.host.version = transaction
                .get("hostVersion")
                .and_then(Value::as_str)
                .ok_or("hostVersion is required")?
                .to_string();
            next_snapshot.host.path = relative_path;
            next_snapshot.host.sha256 = transaction
                .get("hostContentSha256")
                .and_then(Value::as_str)
                .ok_or("hostContentSha256 is required")?
                .to_string();
            next_snapshot.host.artifact_sha256 = transaction
                .get("hostArtifactSha256")
                .and_then(Value::as_str)
                .map(str::to_string);
            next_snapshot.host.electron_abi = transaction
                .get("hostElectronAbi")
                .and_then(Value::as_str)
                .map(str::to_string);
        } else if artifact.key == "bootstrapper" {
            next_snapshot.components.insert(
                "bootstrapper".to_string(),
                RuntimeComponentV3 {
                    version: transaction
                        .get("bootstrapperVersion")
                        .and_then(Value::as_str)
                        .ok_or("bootstrapperVersion is required")?
                        .to_string(),
                    path: relative_path,
                    sha256: sha256_file(&artifact.target_path)?,
                    required: artifact.required,
                    artifact_sha256: transaction
                        .get("bootstrapperArtifactSha256")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    electron_abi: None,
                },
            );
        } else if let Some(name) = artifact.key.strip_prefix("module:") {
            let version = component_versions
                .get(name)
                .and_then(Value::as_str)
                .ok_or("component version is required")?
                .to_string();
            let sha256 = sha256_directory(&artifact.target_path)?;
            next_snapshot.components.insert(
                name.to_string(),
                RuntimeComponentV3 {
                    version,
                    path: relative_path,
                    sha256,
                    required: artifact.required,
                    artifact_sha256: component_artifact_sha256s
                        .and_then(|values| values.get(name))
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    electron_abi: component_electron_abis
                        .get(name)
                        .and_then(Value::as_str)
                        .map(str::to_string),
                },
            );
        }
    }
    for name in omitted_components {
        if name == "desktopCore" || name == "bootstrapper" {
            return Err(format!("protected runtime component cannot be omitted: {name}").into());
        }
        next_snapshot.components.remove(name);
    }
    next_snapshot.metadata_version = transaction
        .get("metadataVersion")
        .and_then(Value::as_u64)
        .ok_or("metadataVersion is required")?;
    next_snapshot.bundle_version = transaction
        .get("bundleVersion")
        .and_then(Value::as_str)
        .ok_or("bundleVersion is required")?
        .to_string();
    if next_snapshot.bundle_version != next_snapshot.metadata_version.to_string() {
        return Err("bundleVersion must equal metadataVersion".into());
    }
    install_state.latest = next_snapshot;
    install_state.generation = install_state
        .generation
        .checked_add(1)
        .ok_or("install-state generation overflow")?;
    install_state.activation = RuntimeActivationV3 {
        state: ActivationState::Pending,
        generation: install_state.generation,
        launch_owner: None,
    };
    let install_state_file = write_install_state(&install_dir, &install_state)?;
    transaction["installStateFile"] = json!(install_state_file);
    transaction["runtimeGeneration"] = json!(install_state.generation);
    write_transaction(transaction_file, &transaction)?;
    Ok(transaction)
}
