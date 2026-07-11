use crate::core::{
    error::Result,
    layout::{assert_inside, is_inside},
};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

const HOST_CONTRACT_FILE: &str = "runtime-host.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeHostContract {
    pub schema_version: u64,
    pub host_bundle: PathBuf,
    pub app_executable: PathBuf,
}

fn contract_path(state_root: &Path) -> PathBuf {
    state_root.join(HOST_CONTRACT_FILE)
}

fn paths_match(left: &Path, right: &Path) -> bool {
    let left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
    if cfg!(windows) {
        left.to_string_lossy()
            .replace('/', "\\")
            .eq_ignore_ascii_case(&right.to_string_lossy().replace('/', "\\"))
    } else {
        left == right
    }
}

fn validate_shape(contract: &RuntimeHostContract) -> Result<()> {
    if contract.schema_version != 1
        || contract
            .host_bundle
            .extension()
            .and_then(|value| value.to_str())
            != Some("app")
    {
        return Err("invalid macOS runtime host contract".into());
    }
    assert_inside(
        &contract.host_bundle.join("Contents").join("MacOS"),
        &contract.app_executable,
        "macOS runtime executable",
    )
}

fn validate(contract: &RuntimeHostContract) -> Result<()> {
    validate_shape(contract)?;
    if !contract
        .host_bundle
        .join("Contents")
        .join("Info.plist")
        .is_file()
        || !contract.app_executable.is_file()
    {
        return Err("invalid macOS runtime host contract".into());
    }
    Ok(())
}

fn read_contract_file(state_root: &Path) -> Result<Option<RuntimeHostContract>> {
    let path = contract_path(state_root);
    if !path.is_file() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_slice(&fs::read(path)?)?))
}

pub fn write_runtime_host_contract(
    state_root: &Path,
    host_bundle: &Path,
    app_executable: &Path,
) -> Result<RuntimeHostContract> {
    let contract = RuntimeHostContract {
        schema_version: 1,
        host_bundle: host_bundle.canonicalize()?,
        app_executable: app_executable.canonicalize()?,
    };
    validate(&contract)?;
    if is_inside(&contract.host_bundle, state_root) || is_inside(state_root, &contract.host_bundle)
    {
        return Err("macOS state root and host bundle must not contain each other".into());
    }
    fs::create_dir_all(state_root)?;
    let target = contract_path(state_root);
    let temp = target.with_extension(format!("json.tmp-{}", std::process::id()));
    fs::write(
        &temp,
        format!("{}\n", serde_json::to_string_pretty(&contract)?),
    )?;
    fs::rename(temp, target)?;
    Ok(contract)
}

pub fn read_runtime_host_contract(state_root: &Path) -> Result<Option<RuntimeHostContract>> {
    let Some(contract) = read_contract_file(state_root)? else {
        return Ok(None);
    };
    validate(&contract)?;
    Ok(Some(contract))
}

pub fn read_runtime_host_contract_for_rotation(
    state_root: &Path,
) -> Result<Option<RuntimeHostContract>> {
    let Some(contract) = read_contract_file(state_root)? else {
        return Ok(None);
    };
    validate_shape(&contract)?;
    Ok(Some(contract))
}

pub fn runtime_host_contract_matches(
    contract: &RuntimeHostContract,
    host_bundle: &Path,
    app_executable: &Path,
) -> bool {
    paths_match(&contract.host_bundle, host_bundle)
        && paths_match(&contract.app_executable, app_executable)
}

pub fn assert_runtime_executable(state_root: &Path, executable: &Path, label: &str) -> Result<()> {
    if is_inside(state_root, executable) {
        return Ok(());
    }
    let contract = read_runtime_host_contract(state_root)?.ok_or_else(|| {
        format!("{label} is outside state root and no runtime host contract exists")
    })?;
    if !paths_match(&contract.app_executable, executable) {
        return Err(format!(
            "{label} does not match the authorized macOS host executable: {}",
            executable.display()
        )
        .into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn stale_contract_is_available_only_for_safe_rotation() {
        let root =
            std::env::temp_dir().join(format!("pulsesync-stale-host-contract-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let host_bundle = root.join("Missing.app");
        let app_executable = host_bundle.join("Contents/MacOS/PulseSync");
        fs::write(
            contract_path(&root),
            serde_json::to_vec(&RuntimeHostContract {
                schema_version: 1,
                host_bundle: host_bundle.clone(),
                app_executable: app_executable.clone(),
            })
            .unwrap(),
        )
        .unwrap();

        assert!(read_runtime_host_contract(&root).is_err());
        let stale = read_runtime_host_contract_for_rotation(&root)
            .unwrap()
            .unwrap();
        assert!(runtime_host_contract_matches(
            &stale,
            &host_bundle,
            &app_executable
        ));

        fs::remove_dir_all(root).unwrap();
    }
}
