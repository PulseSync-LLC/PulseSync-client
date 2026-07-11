mod common;
mod discard;
mod error;
mod model;
mod prepare;
mod prepare_validation;

pub use discard::discard_prepared_update;
pub use error::UpdateWorkflowError;
pub use model::{
    DiscardPreparedUpdateResult, DiscardReason, EffectiveManifestSource, PrepareUpdateResult,
    PreparedTransactionRef, RemovedPreparedState, RequestedManifestSource, UpdateDecision,
    UpdatePolicy,
};
pub use prepare::prepare_update;

use crate::{
    core::error::Result as CoreResult,
    domain::manifest::{DEFAULT_GITHUB_OWNER, DEFAULT_GITHUB_REPO},
};
use serde_json::{Value, to_value};
use std::{path::PathBuf, time::Duration};

const PREPARE_COMMAND: &str = "prepare-update";
const DISCARD_COMMAND: &str = "discard-prepared-update";
const UPDATE_LOCK_TIMEOUT: Duration = Duration::from_secs(10);
const SESSION_LOCK_TIMEOUT: Duration = Duration::from_secs(10);

pub struct PrepareUpdateOptions {
    pub state_root: PathBuf,
    pub host_bundle: Option<PathBuf>,
    pub app_executable: Option<PathBuf>,
    pub app_executable_name: Option<String>,
    pub installed_version: String,
    pub dist: String,
    pub channel: String,
    pub requested_source: RequestedManifestSource,
    pub manifest_url: Option<String>,
    pub server_health_url: Option<String>,
    pub github_owner: String,
    pub github_repo: String,
    pub staging_dir: Option<PathBuf>,
    pub retain_app_versions: usize,
    pub active_lease_id: String,
}

pub fn serialize_prepare_result(result: PrepareUpdateResult) -> CoreResult<Value> {
    Ok(to_value(result)?)
}

pub fn serialize_discard_result(result: DiscardPreparedUpdateResult) -> CoreResult<Value> {
    Ok(to_value(result)?)
}

pub fn default_github_owner() -> String {
    DEFAULT_GITHUB_OWNER.to_string()
}

pub fn default_github_repo() -> String {
    DEFAULT_GITHUB_REPO.to_string()
}
