use serde::{Deserialize, Serialize};
use std::{path::PathBuf, str::FromStr};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RequestedManifestSource {
    Backend,
    Github,
    Direct,
}

impl FromStr for RequestedManifestSource {
    type Err = String;

    fn from_str(value: &str) -> std::result::Result<Self, Self::Err> {
        match value {
            "backend" => Ok(Self::Backend),
            "github" => Ok(Self::Github),
            "direct" => Ok(Self::Direct),
            _ => Err(format!("unsupported requested source: {value}")),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveManifestSource {
    pub requested: RequestedManifestSource,
    pub effective: RequestedManifestSource,
    pub url: String,
    pub fallback_used: bool,
    pub fallback_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePolicy {
    pub current_version_deprecated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched_deprecated_range: Option<String>,
    pub invalid_deprecated_ranges: Vec<String>,
    pub forced: bool,
    pub force_reason: Option<String>,
    pub min_client_version: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateDecision {
    pub reason: String,
    pub channel: String,
    pub dist: String,
    pub current_version: String,
    pub target_version: String,
    pub update_available: bool,
    pub policy: UpdatePolicy,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareUpdateBlock {
    pub code: String,
    pub retryable: bool,
    pub safe_to_continue: bool,
    pub check_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedTransactionRef {
    pub id: String,
    pub dir: PathBuf,
    pub file: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum PrepareUpdateResult {
    UpToDate {
        #[serde(rename = "schemaVersion")]
        schema_version: u64,
        decision: UpdateDecision,
        source: EffectiveManifestSource,
    },
    Prepared {
        #[serde(rename = "schemaVersion")]
        schema_version: u64,
        decision: UpdateDecision,
        source: EffectiveManifestSource,
        reused: bool,
        transaction: PreparedTransactionRef,
        #[serde(rename = "applyDeferredByLeaseId")]
        apply_deferred_by_lease_id: String,
    },
    Blocked {
        #[serde(rename = "schemaVersion")]
        schema_version: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        decision: Option<UpdateDecision>,
        #[serde(skip_serializing_if = "Option::is_none")]
        source: Option<EffectiveManifestSource>,
        block: PrepareUpdateBlock,
    },
}

impl PrepareUpdateResult {
    pub fn up_to_date(decision: UpdateDecision, source: EffectiveManifestSource) -> Self {
        Self::UpToDate {
            schema_version: 1,
            decision,
            source,
        }
    }

    pub fn prepared(
        decision: UpdateDecision,
        source: EffectiveManifestSource,
        reused: bool,
        transaction: PreparedTransactionRef,
        lease_id: String,
    ) -> Self {
        Self::Prepared {
            schema_version: 1,
            decision,
            source,
            reused,
            transaction,
            apply_deferred_by_lease_id: lease_id,
        }
    }

    pub fn blocked(
        decision: Option<UpdateDecision>,
        source: Option<EffectiveManifestSource>,
        code: impl Into<String>,
        retryable: bool,
        safe_to_continue: bool,
        check_ids: Vec<String>,
    ) -> Self {
        Self::Blocked {
            schema_version: 1,
            decision,
            source,
            block: PrepareUpdateBlock {
                code: code.into(),
                retryable,
                safe_to_continue,
                check_ids,
            },
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardReason {
    pub code: String,
    pub retryable: bool,
    pub safe_to_continue: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemovedPreparedState {
    pub transaction: bool,
    pub staging: bool,
    pub backup: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardPreparedUpdateResult {
    pub schema_version: u64,
    pub state: String,
    pub transaction_id: String,
    pub target_version: Option<String>,
    pub reason: DiscardReason,
    pub removed: RemovedPreparedState,
}
