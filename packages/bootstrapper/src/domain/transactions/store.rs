use crate::{
    core::error::Result,
    domain::transactions::model::{TransactionArtifact, TransactionCandidate},
};
use serde_json::Value;
use std::{fs, path::Path, time::SystemTime};

fn read_transaction_state(path: &Path) -> Option<String> {
    let payload = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&payload).ok()?;
    value.get("state")?.as_str().map(str::to_string)
}

fn collect_transactions(root: &Path, output: &mut Vec<TransactionCandidate>) -> Result<()> {
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_transactions(&path, output)?;
            continue;
        }
        if path.file_name().and_then(|value| value.to_str()) != Some("transaction.json") {
            continue;
        }
        let Some(state) = read_transaction_state(&path) else {
            continue;
        };
        let modified = fs::metadata(&path)?
            .modified()
            .unwrap_or(SystemTime::UNIX_EPOCH);
        output.push(TransactionCandidate {
            modified,
            path,
            state,
        });
    }
    Ok(())
}

pub fn newest_transaction(root: &Path) -> Result<Option<TransactionCandidate>> {
    let mut candidates = Vec::new();
    collect_transactions(root, &mut candidates)?;
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
    let temp = path.with_extension(format!("json.tmp-{}", std::process::id()));
    fs::write(&temp, format!("{}\n", serde_json::to_string_pretty(value)?))?;
    fs::rename(temp, path)?;
    Ok(())
}
