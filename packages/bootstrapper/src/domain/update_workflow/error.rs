use serde_json::{Value, json};
use std::{error::Error, fmt};

#[derive(Debug)]
pub struct UpdateWorkflowError {
    pub command: String,
    pub code: String,
    pub phase: &'static str,
    pub message: String,
    pub retryable: bool,
    pub safe_to_continue: bool,
}

impl UpdateWorkflowError {
    pub fn new(
        command: impl Into<String>,
        code: impl Into<String>,
        phase: &'static str,
        message: impl Into<String>,
        retryable: bool,
        safe_to_continue: bool,
    ) -> Self {
        Self {
            command: command.into(),
            code: code.into(),
            phase,
            message: message.into(),
            retryable,
            safe_to_continue,
        }
    }

    pub fn envelope(&self) -> Value {
        json!({
            "schemaVersion": 1,
            "command": self.command,
            "state": "error",
            "error": {
                "code": self.code,
                "phase": self.phase,
                "message": self.message,
                "retryable": self.retryable,
                "safeToContinue": self.safe_to_continue,
            }
        })
    }
}

impl fmt::Display for UpdateWorkflowError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl Error for UpdateWorkflowError {}
