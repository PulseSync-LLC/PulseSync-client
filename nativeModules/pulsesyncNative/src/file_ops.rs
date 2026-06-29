use napi::bindgen_prelude::Buffer;
use napi::{Error, Result};
use napi_derive::napi;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

fn error_with_path(action: &str, path: &Path, error: io::Error) -> Error {
    Error::from_reason(format!("{action} '{}': {error}", path.to_string_lossy()))
}

fn remove_existing(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

pub(crate) fn copy_path(source: &Path, destination: &Path) -> io::Result<()> {
    if source == destination {
        fs::symlink_metadata(source)?;
        return Ok(());
    }
    if let (Ok(source), Ok(destination)) = (source.canonicalize(), destination.canonicalize()) {
        if source == destination {
            fs::symlink_metadata(source)?;
            return Ok(());
        }
    }

    let metadata = fs::symlink_metadata(source)?;
    if metadata.is_dir() {
        fs::create_dir_all(destination)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_path(&entry.path(), &destination.join(entry.file_name()))?;
        }
        return Ok(());
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(source, destination)?;
    fs::set_permissions(destination, metadata.permissions())?;
    Ok(())
}

pub(crate) fn delete_path(path: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

pub(crate) fn replace_rename(source: &Path, destination: &Path) -> io::Result<()> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    remove_existing(destination)?;
    fs::rename(source, destination)
}

#[napi]
pub fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[napi]
pub fn read_file(path: String) -> Result<Buffer> {
    let path = PathBuf::from(path);
    fs::read(&path)
        .map(Buffer::from)
        .map_err(|error| error_with_path("Failed to read", &path, error))
}

#[napi]
pub fn delete_file(path: String) -> Result<()> {
    let path = PathBuf::from(path);
    delete_path(&path).map_err(|error| error_with_path("Failed to delete", &path, error))
}

#[napi]
pub fn rename_file(source: String, destination: String) -> Result<()> {
    let source = PathBuf::from(source);
    let destination = PathBuf::from(destination);
    replace_rename(&source, &destination).map_err(|error| {
        Error::from_reason(format!(
            "Failed to rename '{}' to '{}': {error}",
            source.to_string_lossy(),
            destination.to_string_lossy()
        ))
    })
}

#[napi]
pub fn move_file(source: String, destination: String) -> Result<()> {
    let source = PathBuf::from(source);
    let destination = PathBuf::from(destination);

    if replace_rename(&source, &destination).is_ok() {
        return Ok(());
    }

    copy_path(&source, &destination).map_err(|error| {
        Error::from_reason(format!(
            "Failed to move '{}' to '{}' during copy: {error}",
            source.to_string_lossy(),
            destination.to_string_lossy()
        ))
    })?;
    delete_path(&source)
        .map_err(|error| error_with_path("Failed to remove source after move", &source, error))
}

#[napi]
pub fn copy_file(source: String, destination: String) -> Result<()> {
    let source = PathBuf::from(source);
    let destination = PathBuf::from(destination);
    copy_path(&source, &destination).map_err(|error| {
        Error::from_reason(format!(
            "Failed to copy '{}' to '{}': {error}",
            source.to_string_lossy(),
            destination.to_string_lossy()
        ))
    })
}
