use crate::{
    core::error::Result,
    domain::manifest::{BootstrapperUpdateManifest, validation::validate_manifest},
};
use std::{fs, path::PathBuf};

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

pub fn load_manifest(manifest_url: &str) -> Result<BootstrapperUpdateManifest> {
    let manifest: BootstrapperUpdateManifest = serde_json::from_slice(&read_source(manifest_url)?)?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}
