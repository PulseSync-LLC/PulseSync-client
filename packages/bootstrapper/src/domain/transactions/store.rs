use crate::{
    core::{active_app::write_json_atomic, error::Result, layout::is_inside},
    domain::transactions::model::{TransactionArtifact, TransactionCandidate, TransactionRecord},
};
use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

fn metadata_is_link(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        return metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    false
}

fn collect_transaction_files(
    root: &Path,
    directory: &Path,
    output: &mut Vec<PathBuf>,
) -> Result<()> {
    if !directory.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        if metadata_is_link(&metadata) {
            return Err(format!(
                "transaction root contains a symbolic link: {}",
                path.display()
            )
            .into());
        }
        if !is_inside(root, &path) {
            return Err(format!(
                "transaction path escapes transaction root: {}",
                path.display()
            )
            .into());
        }
        if metadata.is_dir() {
            collect_transaction_files(root, &path, output)?;
            continue;
        }
        if path.file_name().and_then(|value| value.to_str()) != Some("transaction.json") {
            continue;
        }
        output.push(path);
    }
    Ok(())
}

pub fn transaction_records(root: &Path) -> Result<Vec<TransactionRecord>> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let root = root.canonicalize()?;
    let mut files = Vec::new();
    collect_transaction_files(&root, &root, &mut files)?;
    let mut records = Vec::with_capacity(files.len());
    for path in files {
        let value: Value = serde_json::from_slice(&fs::read(&path)?)?;
        let state = value
            .get("state")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("transaction is missing state: {}", path.display()))?
            .to_string();
        let modified = fs::metadata(&path)?
            .modified()
            .unwrap_or(SystemTime::UNIX_EPOCH);
        records.push(TransactionRecord {
            candidate: TransactionCandidate {
                modified,
                path,
                state,
            },
            value,
        });
    }
    Ok(records)
}

pub fn transactions_with_id(root: &Path, transaction_id: &str) -> Result<Vec<TransactionRecord>> {
    Ok(transaction_records(root)?
        .into_iter()
        .filter(|record| {
            record.value.get("transactionId").and_then(Value::as_str) == Some(transaction_id)
        })
        .collect())
}

pub fn prepared_transactions(root: &Path) -> Result<Vec<TransactionRecord>> {
    Ok(transaction_records(root)?
        .into_iter()
        .filter(|record| record.candidate.state == "prepared")
        .collect())
}

pub fn newest_transaction(root: &Path) -> Result<Option<TransactionCandidate>> {
    let mut candidates = transaction_records(root)?
        .into_iter()
        .map(|record| record.candidate)
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .modified
            .cmp(&left.modified)
            .then_with(|| right.path.cmp(&left.path))
    });
    Ok(candidates.into_iter().next())
}

pub fn transaction_artifacts(value: &Value) -> Result<Vec<TransactionArtifact>> {
    Ok(serde_json::from_value(
        value
            .get("artifacts")
            .cloned()
            .unwrap_or(Value::Array(vec![])),
    )?)
}

pub fn write_transaction(path: &Path, value: &Value) -> Result<()> {
    write_json_atomic(path, value)
}
