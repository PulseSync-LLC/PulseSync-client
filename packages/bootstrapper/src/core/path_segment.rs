use crate::core::error::Result;

pub fn sanitize_path_segment(value: &str) -> Result<String> {
    let sanitized = value
        .chars()
        .map(|value| {
            if value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-') {
                value
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim_matches('_')
        .to_string();

    if sanitized.is_empty() || sanitized == "." || sanitized == ".." {
        return Err(format!("invalid path segment: {value}").into());
    }

    Ok(sanitized)
}

pub(crate) fn macos_component_container(
    disk_name: &str,
    host_version: &str,
    revision: u64,
) -> Result<String> {
    node_semver::Version::parse(host_version)
        .map_err(|error| format!("invalid component host version: {error}"))?;
    if revision == 0 {
        return Err("component revision must be positive".into());
    }
    Ok(format!(
        "{}-{}-{revision}",
        sanitize_path_segment(disk_name)?,
        sanitize_path_segment(host_version)?
    ))
}
