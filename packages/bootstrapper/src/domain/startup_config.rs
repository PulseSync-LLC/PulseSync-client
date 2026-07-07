use crate::core::error::Result;
use serde::Deserialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapperStartupConfig {
    pub app_executable_name: Option<String>,
    pub dist: Option<String>,
    pub installed_version: Option<String>,
    pub manifest_url: Option<String>,
    pub schema_version: Option<u64>,
}

impl BootstrapperStartupConfig {
    pub fn string_value(value: &Option<String>) -> Option<String> {
        value
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    }

    pub fn app_executable_name(&self) -> Option<String> {
        Self::string_value(&self.app_executable_name)
    }

    pub fn dist(&self) -> Option<String> {
        Self::string_value(&self.dist)
    }

    pub fn installed_version(&self) -> Option<String> {
        Self::string_value(&self.installed_version)
    }

    pub fn manifest_url(&self) -> Option<String> {
        Self::string_value(&self.manifest_url)
    }
}

pub fn startup_config_path(install_root: &Path) -> PathBuf {
    startup_resources_dir(install_root).join("bootstrapper.json")
}

fn startup_resources_dir(install_root: &Path) -> PathBuf {
    if cfg!(target_os = "macos") {
        install_root.join("Resources")
    } else {
        install_root.join("resources")
    }
}

pub fn load_startup_config(install_root: &Path) -> Result<Option<BootstrapperStartupConfig>> {
    let config_path = startup_config_path(install_root);
    if !config_path.exists() {
        return Ok(None);
    }

    let config: BootstrapperStartupConfig = serde_json::from_slice(&fs::read(&config_path)?)?;
    if let Some(schema_version) = config.schema_version
        && schema_version != 1
    {
        return Err(format!(
            "unsupported bootstrapper config schemaVersion {schema_version}: {}",
            config_path.display()
        )
        .into());
    }

    Ok(Some(config))
}
