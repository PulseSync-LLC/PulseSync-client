use crate::{
    cli::args::{Args, required_arg, required_state_root},
    core::error::Result,
    domain::update_workflow::{
        UpdateWorkflowError, discard_prepared_update, serialize_discard_result,
    },
};
use serde_json::Value;
use std::path::PathBuf;

fn input_error(error: impl std::fmt::Display) -> UpdateWorkflowError {
    UpdateWorkflowError::new(
        "discard-prepared-update",
        "invalid-argument",
        "validate-input",
        error.to_string(),
        false,
        false,
    )
}

fn required_input(args: &Args, name: &str) -> Result<String> {
    required_arg(args, name).map_err(|error| input_error(error).into())
}

pub fn discard_prepared_update_command(args: &Args) -> Result<Value> {
    let reason = required_input(args, "--reason")?;
    if !matches!(
        reason.as_str(),
        "channel-change" | "source-change" | "manual-reset"
    ) {
        return Err(input_error(format!("unsupported discard reason: {reason}")).into());
    }
    serialize_discard_result(discard_prepared_update(
        PathBuf::from(required_state_root(args).map_err(input_error)?),
        required_input(args, "--transaction-id")?,
    )?)
}
