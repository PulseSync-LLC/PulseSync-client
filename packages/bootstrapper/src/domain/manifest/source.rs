use crate::{
    core::error::Result,
    domain::manifest::{BootstrapperUpdateManifest, validation::validate_manifest},
};
use serde_json::Value;
use std::{fs, path::PathBuf, time::Duration};

pub const DEFAULT_GITHUB_OWNER: &str = "PulseSync-LLC";
pub const DEFAULT_GITHUB_REPO: &str = "PulseSync-client";
const GITHUB_API_BASE_URL: &str = "https://api.github.com";

fn http_agent(connect_timeout: Duration, read_timeout: Duration) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(connect_timeout)
        .timeout_read(read_timeout)
        .build()
}

#[derive(Clone, Debug)]
pub struct GitHubManifestFallback {
    pub channel: String,
    pub dist: String,
    pub owner: String,
    pub repo: String,
    pub hybrid: bool,
}

fn percent_decode(value: &str) -> Result<String> {
    let mut output = Vec::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let encoded = value
                .get(index + 1..index + 3)
                .ok_or("invalid percent-encoded url path")?;
            output.push(u8::from_str_radix(encoded, 16)?);
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    Ok(String::from_utf8(output)?)
}

fn file_url_to_path(url: &str) -> Result<PathBuf> {
    let without_scheme = url
        .strip_prefix("file://")
        .ok_or("file url must start with file://")?;
    let decoded = percent_decode(without_scheme)?;
    if cfg!(windows) {
        return Ok(PathBuf::from(
            decoded.trim_start_matches('/').replace('/', "\\"),
        ));
    }
    Ok(PathBuf::from(decoded))
}

pub fn read_source(source: &str) -> Result<Vec<u8>> {
    if source.starts_with("file://") {
        return Ok(fs::read(file_url_to_path(source)?)?);
    }
    if source.starts_with("http://") || source.starts_with("https://") {
        let response = http_agent(Duration::from_secs(5), Duration::from_secs(15))
            .get(source)
            .set("Accept", "application/json")
            .set("Cache-Control", "no-cache")
            .set("Pragma", "no-cache")
            .timeout(Duration::from_secs(30))
            .call()?;
        let mut reader = response.into_reader();
        let mut bytes = Vec::new();
        std::io::copy(&mut reader, &mut bytes)?;
        return Ok(bytes);
    }
    Ok(fs::read(source)?)
}

fn is_http_source(source: &str) -> bool {
    source.starts_with("http://") || source.starts_with("https://")
}

pub fn health_check_available(health_url: &str) -> bool {
    if !is_http_source(health_url) {
        return false;
    }

    http_agent(Duration::from_secs(3), Duration::from_secs(3))
        .get(health_url)
        .set("Accept", "application/json")
        .timeout(Duration::from_secs(3))
        .call()
        .map(|response| (200..300).contains(&response.status()))
        .unwrap_or(false)
}

pub fn github_manifest_url(fallback: &GitHubManifestFallback) -> Result<String> {
    let api_url = format!(
        "{GITHUB_API_BASE_URL}/repos/{}/{}/releases",
        fallback.owner, fallback.repo
    );
    let response = http_agent(Duration::from_secs(5), Duration::from_secs(15))
        .get(&api_url)
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", "PulseSyncBootstrapper")
        .timeout(Duration::from_secs(15))
        .call()?;
    let releases: Value = serde_json::from_reader(response.into_reader())?;
    let releases = releases
        .as_array()
        .ok_or("GitHub releases response must be an array")?;
    let want_prerelease = matches!(fallback.channel.as_str(), "alpha" | "dev");
    let asset_name = if fallback.hybrid {
        format!("desktop-update-hybrid-{}.json", fallback.dist)
    } else {
        format!("desktop-update-{}.json", fallback.dist)
    };

    for release in releases {
        if release
            .get("draft")
            .and_then(Value::as_bool)
            .unwrap_or(true)
        {
            continue;
        }
        if release
            .get("prerelease")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            != want_prerelease
        {
            continue;
        }
        if want_prerelease {
            let release_channel = release
                .get("tag_name")
                .and_then(Value::as_str)
                .and_then(|tag| tag.trim_start_matches('v').split_once('-'))
                .map(|(_, prerelease)| prerelease.split('.').next().unwrap_or_default());
            if release_channel != Some(fallback.channel.as_str()) {
                continue;
            }
        }

        let Some(assets) = release.get("assets").and_then(Value::as_array) else {
            continue;
        };
        for asset in assets {
            if asset.get("name").and_then(Value::as_str) == Some(asset_name.as_str())
                && let Some(url) = asset.get("browser_download_url").and_then(Value::as_str)
            {
                return Ok(url.to_string());
            }
        }
    }

    Err(format!(
        "No GitHub desktop update manifest found for {} in {}/{} ({})",
        fallback.dist, fallback.owner, fallback.repo, fallback.channel
    )
    .into())
}

pub fn load_manifest(manifest_url: &str) -> Result<BootstrapperUpdateManifest> {
    let manifest: BootstrapperUpdateManifest = serde_json::from_slice(&read_source(manifest_url)?)?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}
