use serde::{Deserialize, Serialize};
use std::{path::PathBuf, time::SystemTime};

#[derive(Clone, Debug)]
pub struct TransactionCandidate {
    pub modified: SystemTime,
    pub path: PathBuf,
    pub state: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TransactionArtifact {
    pub action: String,
    #[serde(rename = "backupPath")]
    pub backup_path: PathBuf,
    pub key: String,
    #[serde(rename = "preparedKind")]
    pub prepared_kind: String,
    #[serde(rename = "preparedPath")]
    pub prepared_path: PathBuf,
    pub sha256: String,
    pub size: u64,
    #[serde(rename = "sourcePath")]
    pub source_path: PathBuf,
    #[serde(rename = "targetPath")]
    pub target_path: PathBuf,
}
