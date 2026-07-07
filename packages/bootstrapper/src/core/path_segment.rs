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
