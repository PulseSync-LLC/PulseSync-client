use serde::Serialize;
use std::path::PathBuf;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallWorkflowEvent {
    pub schema_version: u64,
    pub event: String,
    pub stage: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_count: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_read: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<PathBuf>,
}

impl InstallWorkflowEvent {
    pub fn stage(stage: impl Into<String>, message: impl Into<String>) -> Self {
        let stage = stage.into();
        Self {
            schema_version: 1,
            event: "stage".to_string(),
            message: message.into(),
            stage,
            artifact_key: None,
            artifact_index: None,
            artifact_count: None,
            bytes_read: None,
            bytes_total: None,
            path: None,
        }
    }

    pub fn artifact_progress(
        stage: impl Into<String>,
        message: impl Into<String>,
        artifact_key: impl Into<String>,
        artifact_index: usize,
        artifact_count: usize,
        bytes_read: u64,
        bytes_total: Option<u64>,
        path: Option<PathBuf>,
    ) -> Self {
        let stage = stage.into();
        Self {
            schema_version: 1,
            event: "artifact-progress".to_string(),
            message: message.into(),
            stage,
            artifact_key: Some(artifact_key.into()),
            artifact_index: Some(artifact_index),
            artifact_count: Some(artifact_count),
            bytes_read: Some(bytes_read),
            bytes_total,
            path,
        }
    }
}

pub trait InstallProgressReporter {
    fn emit(&self, event: InstallWorkflowEvent);
}

pub struct NoopInstallProgressReporter;

impl InstallProgressReporter for NoopInstallProgressReporter {
    fn emit(&self, _event: InstallWorkflowEvent) {}
}

pub struct StderrJsonInstallProgressReporter;

impl InstallProgressReporter for StderrJsonInstallProgressReporter {
    fn emit(&self, event: InstallWorkflowEvent) {
        if let Ok(payload) = serde_json::to_string(&event) {
            eprintln!("{payload}");
        }
    }
}
