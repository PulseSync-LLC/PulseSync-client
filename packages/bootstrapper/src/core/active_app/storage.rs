use crate::core::{error::Result, layout::assert_inside};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const ACTIVE_APP_FILE: &str = "runtime/active-app.json";
const LAUNCH_RESERVATION_FILE: &str = "runtime/launch-reservation.json";
const HANDOFF_ROOT: &str = "runtime/handoffs";

pub fn active_app_path(install_root: &Path) -> PathBuf {
    install_root.join(ACTIVE_APP_FILE)
}

pub fn launch_reservation_path(install_root: &Path) -> PathBuf {
    install_root.join(LAUNCH_RESERVATION_FILE)
}

pub fn handoff_transfer_path(install_root: &Path, handoff_id: &str) -> Result<PathBuf> {
    let handoff_id = Uuid::parse_str(handoff_id)
        .map_err(|_| "handoff id must be a UUID")?
        .to_string();
    let root = install_root.join(HANDOFF_ROOT);
    let path = root.join(format!("{handoff_id}.json"));
    assert_inside(&root, &path, "handoff transfer")?;
    Ok(path)
}

pub(super) fn read_json_if_exists<T>(path: &Path) -> Result<Option<T>>
where
    T: for<'de> Deserialize<'de>,
{
    if !path.is_file() {
        return Ok(None);
    }
    Ok(Some(serde_json::from_slice(&fs::read(path)?)?))
}

pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension(format!("tmp-{}-{}", std::process::id(), Uuid::new_v4()));
    let write_result = (|| -> Result<()> {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)?;
        file.write_all(format!("{}\n", serde_json::to_string_pretty(value)?).as_bytes())?;
        file.sync_all()?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    if let Err(error) = replace_file(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    sync_parent_directory(path)?;
    Ok(())
}

#[cfg(unix)]
fn sync_parent_directory(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn sync_parent_directory(_path: &Path) -> Result<()> {
    Ok(())
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let target = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    if unsafe {
        MoveFileExW(
            source.as_ptr(),
            target.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    } == 0
    {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> Result<()> {
    fs::rename(source, target)?;
    Ok(())
}

pub(super) fn remove_if_exists(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

pub(super) fn canonical_or_owned(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

pub(super) fn same_path(left: &Path, right: &Path) -> bool {
    let left = canonical_or_owned(left).to_string_lossy().to_string();
    let right = canonical_or_owned(right).to_string_lossy().to_string();
    if cfg!(windows) {
        left.replace('/', "\\")
            .eq_ignore_ascii_case(&right.replace('/', "\\"))
    } else {
        left == right
    }
}

pub(super) fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}
