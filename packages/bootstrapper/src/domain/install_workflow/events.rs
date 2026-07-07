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
            path: None,
        }
    }

    pub fn artifact(
        stage: impl Into<String>,
        message: impl Into<String>,
        artifact_key: impl Into<String>,
        artifact_index: usize,
        artifact_count: usize,
        path: Option<PathBuf>,
    ) -> Self {
        let stage = stage.into();
        Self {
            schema_version: 1,
            event: "artifact".to_string(),
            message: message.into(),
            stage,
            artifact_key: Some(artifact_key.into()),
            artifact_index: Some(artifact_index),
            artifact_count: Some(artifact_count),
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
