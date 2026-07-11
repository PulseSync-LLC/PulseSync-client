use crate::core::error::Result;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Read},
    path::Path,
};
use zip::ZipArchive;

#[cfg(unix)]
fn apply_zip_unix_mode(path: &Path, mode: Option<u32>) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    if let Some(mode) = mode {
        fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn apply_zip_unix_mode(_path: &Path, _mode: Option<u32>) -> Result<()> {
    Ok(())
}

#[cfg(unix)]
pub fn ensure_executable(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let metadata = fs::metadata(path)?;
    let mode = metadata.permissions().mode() | 0o755;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    Ok(())
}

#[cfg(not(unix))]
pub fn ensure_executable(_path: &Path) -> Result<()> {
    Ok(())
}

pub fn sha256_file(path: &Path) -> Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

pub fn sha256_directory(path: &Path) -> Result<String> {
    fn collect(root: &Path, current: &Path, files: &mut Vec<std::path::PathBuf>) -> Result<()> {
        for entry in fs::read_dir(current)? {
            let entry = entry?;
            let entry_path = entry.path();
            if entry_path.is_dir() {
                collect(root, &entry_path, files)?;
            } else if entry_path.is_file() {
                files.push(entry_path.strip_prefix(root)?.to_path_buf());
            }
        }
        Ok(())
    }

    let mut files = Vec::new();
    collect(path, path, &mut files)?;
    files.sort_by(|left, right| left.to_string_lossy().cmp(&right.to_string_lossy()));
    let mut hasher = Sha256::new();
    for relative in files {
        hasher.update(relative.to_string_lossy().replace('\\', "/").as_bytes());
        hasher.update([0]);
        let mut file = fs::File::open(path.join(&relative))?;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        hasher.update([0]);
    }
    Ok(hex::encode(hasher.finalize()))
}

pub fn file_size(path: &Path) -> Result<u64> {
    Ok(fs::metadata(path)?.len())
}

fn zip_entry_is_safe(name: &str) -> bool {
    let normalized = name.replace('\\', "/");
    !normalized.is_empty()
        && !normalized.starts_with('/')
        && !normalized.contains("../")
        && normalized != ".."
        && !normalized.starts_with("..")
        && !Path::new(&normalized).is_absolute()
}

pub fn extract_zip_to(source: &Path, target: &Path) -> Result<()> {
    let file = fs::File::open(source)?;
    let mut archive = ZipArchive::new(file)?;
    fs::create_dir_all(target)?;
    for index in 0..archive.len() {
        let mut file = archive.by_index(index)?;
        let name = file.name().to_string();
        if !zip_entry_is_safe(&name) {
            return Err(format!("archive contains unsafe entry path: {name}").into());
        }
        let out_path = target.join(name);
        if file.is_dir() {
            fs::create_dir_all(&out_path)?;
            apply_zip_unix_mode(&out_path, file.unix_mode())?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut out = fs::File::create(&out_path)?;
        io::copy(&mut file, &mut out)?;
        apply_zip_unix_mode(&out_path, file.unix_mode())?;
    }
    Ok(())
}
