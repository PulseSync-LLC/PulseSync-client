use crate::{
    core::error::Result,
    domain::manifest::{BootstrapperUpdateManifest, validation::validate_manifest},
};
use serde_json::Value;
use std::{fs, path::PathBuf, time::Duration};

const DEFAULT_GITHUB_OWNER: &str = "PulseSync-LLC";
const DEFAULT_GITHUB_REPO: &str = "PulseSync-client";
const GITHUB_API_BASE_URL: &str = "https://api.github.com";

#[derive(Clone, Debug)]
pub struct GitHubManifestFallback {
    pub channel: String,
    pub dist: String,
    pub health_url: String,
    pub owner: String,
    pub repo: String,
}

impl GitHubManifestFallback {
    pub fn new(channel: impl Into<String>, dist: impl Into<String>, health_url: impl Into<String>) -> Self {
        Self {
            channel: channel.into(),
            dist: dist.into(),
            health_url: health_url.into(),
            owner: DEFAULT_GITHUB_OWNER.to_string(),
            repo: DEFAULT_GITHUB_REPO.to_string(),
        }
    }
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
        let response = ureq::get(source)
            .set("Accept", "application/json")
            .set("Cache-Control", "no-cache")
            .set("Pragma", "no-cache")
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

fn health_check_available(health_url: &str) -> bool {
    if !is_http_source(health_url) {
        return false;
    }

    ureq::get(health_url)
        .set("Accept", "application/json")
        .timeout(Duration::from_secs(3))
        .call()
        .map(|response| (200..300).contains(&response.status()))
        .unwrap_or(false)
}

fn github_manifest_url(fallback: &GitHubManifestFallback) -> Result<String> {
    let api_url = format!(
        "{GITHUB_API_BASE_URL}/repos/{}/{}/releases",
        fallback.owner, fallback.repo
    );
    let response = ureq::get(&api_url)
        .set("Accept", "application/vnd.github+json")
        .set("User-Agent", "PulseSyncBootstrapper")
        .timeout(Duration::from_secs(15))
        .call()?;
    let releases: Value = serde_json::from_reader(response.into_reader())?;
    let releases = releases
        .as_array()
        .ok_or("GitHub releases response must be an array")?;
    let want_prerelease = fallback.channel == "dev";
    let asset_name = format!("desktop-update-{}.json", fallback.dist);

    for release in releases {
        if release.get("draft").and_then(Value::as_bool).unwrap_or(true) {
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

pub fn resolve_manifest_source(
    manifest_url: &str,
    fallback: Option<&GitHubManifestFallback>,
) -> Result<String> {
    let Some(fallback) = fallback else {
        return Ok(manifest_url.to_string());
    };
    if !is_http_source(manifest_url) || health_check_available(&fallback.health_url) {
        return Ok(manifest_url.to_string());
    }

    github_manifest_url(fallback)
}

pub fn load_manifest(manifest_url: &str) -> Result<BootstrapperUpdateManifest> {
    let manifest: BootstrapperUpdateManifest = serde_json::from_slice(&read_source(manifest_url)?)?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}
