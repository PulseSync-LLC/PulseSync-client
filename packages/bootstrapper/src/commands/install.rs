use crate::{
    cli::args::{Args, arg_value, required_arg},
    core::{
        error::Result,
        fs_ops::{copy_dir_if_missing, copy_file_if_needed, extract_zip_to},
        layout::{assert_inside, resolve_layout},
    },
};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
};

fn find_extracted_directory(temp_dir: &Path, target_dir: &Path) -> Result<PathBuf> {
    let target_name = target_dir
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    for entry in fs::read_dir(temp_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() && entry.file_name().to_string_lossy() == target_name {
            return Ok(path);
        }
    }
    Ok(temp_dir.to_path_buf())
}

fn extract_payload_archive(
    source: &Path,
    target: &Path,
    temp_root: &Path,
    label: &str,
) -> Result<&'static str> {
    if target.exists() {
        return Ok("reused");
    }

    let temp_dir = temp_root.join(format!("{label}-extract-{}", std::process::id()));
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)?;
    }
    fs::create_dir_all(&temp_dir)?;

    let result = (|| -> Result<&'static str> {
        extract_zip_to(source, &temp_dir)?;
        let extracted = find_extracted_directory(&temp_dir, target)?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(extracted, target)?;
        Ok("extracted")
    })();
    let _ = fs::remove_dir_all(&temp_dir);
    result
}

pub fn ensure_installed(args: &Args) -> Result<Value> {
    let install_root = PathBuf::from(required_arg(args, "--install-root")?);
    let app_payload = PathBuf::from(required_arg(args, "--app-payload")?);
    let native_payload = arg_value(args, "--native-payload").map(PathBuf::from);
    let layout = resolve_layout(install_root, arg_value(args, "--app-executable-name"))?;
    let mut entries = Vec::new();

    let bootstrapper_action = if layout.bootstrapper_dir.exists() {
        "reused"
    } else {
        "created"
    };
    fs::create_dir_all(&layout.bootstrapper_dir)?;
    entries.push(json!({ "type": "directory", "action": bootstrapper_action, "target": layout.bootstrapper_dir }));

    let updates_action = if layout.updates_dir.exists() {
        "reused"
    } else {
        "created"
    };
    fs::create_dir_all(&layout.updates_dir)?;
    entries.push(
        json!({ "type": "directory", "action": updates_action, "target": layout.updates_dir }),
    );

    if app_payload.is_dir() {
        assert_inside(&layout.install_root, &layout.app_dir, "app target")?;
        let action = copy_dir_if_missing(&app_payload, &layout.app_dir)?;
        entries.push(json!({ "type": "app", "action": action, "source": app_payload, "target": layout.app_dir }));
    } else if app_payload
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
    {
        assert_inside(&layout.install_root, &layout.app_dir, "app target")?;
        let action =
            extract_payload_archive(&app_payload, &layout.app_dir, &layout.updates_dir, "app")?;
        entries.push(json!({ "type": "app", "action": action, "source": app_payload, "target": layout.app_dir }));
    } else {
        assert_inside(&layout.install_root, &layout.app_executable, "app target")?;
        let action = copy_file_if_needed(&app_payload, &layout.app_executable)?;
        entries.push(json!({ "type": "app", "action": action, "source": app_payload, "target": layout.app_executable }));
    }

    if let Some(native_payload) = native_payload {
        assert_inside(&layout.install_root, &layout.modules_dir, "modules target")?;
        let action = if native_payload.is_dir() {
            copy_dir_if_missing(&native_payload, &layout.modules_dir)?
        } else if native_payload
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
        {
            extract_payload_archive(
                &native_payload,
                &layout.modules_dir,
                &layout.updates_dir,
                "modules",
            )?
        } else {
            let target = layout.modules_dir.join(
                native_payload
                    .file_name()
                    .ok_or("native payload is missing file name")?,
            );
            copy_file_if_needed(&native_payload, &target)?
        };
        entries.push(json!({ "type": "modules", "action": action, "source": native_payload, "target": layout.modules_dir }));
    }

    Ok(json!({
        "state": "installed",
        "layout": layout,
        "entries": entries
    }))
}
