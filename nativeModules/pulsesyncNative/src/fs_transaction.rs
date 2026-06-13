use crate::file_ops::{copy_path, delete_path};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub(crate) fn unique_sibling(path: &Path, label: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "artifact".to_owned());
    path.with_file_name(format!("{name}.{label}-{}-{suffix}", std::process::id()))
}

pub(crate) fn retry_io<F>(mut operation: F) -> io::Result<()>
where
    F: FnMut() -> io::Result<()>,
{
    let attempts = if cfg!(windows) { 6 } else { 2 };
    let mut last_error = None;

    for attempt in 1..=attempts {
        match operation() {
            Ok(()) => return Ok(()),
            Err(error) => {
                last_error = Some(error);
                if attempt < attempts {
                    thread::sleep(Duration::from_millis(150 * attempt as u64));
                }
            }
        }
    }

    Err(last_error.unwrap_or_else(|| io::Error::other("Filesystem operation failed")))
}

pub(crate) fn move_with_copy_fallback(source: &Path, destination: &Path) -> io::Result<()> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }

    if retry_io(|| fs::rename(source, destination)).is_ok() {
        return Ok(());
    }

    if destination.exists() {
        delete_path(destination)?;
    }
    if let Err(error) = copy_path(source, destination) {
        let _ = delete_path(destination);
        return Err(error);
    }
    delete_path(source)
}

pub(crate) struct DirectoryTransaction {
    target: PathBuf,
    backup: Option<PathBuf>,
    committed: bool,
}

impl DirectoryTransaction {
    pub(crate) fn begin(target: &Path) -> io::Result<Self> {
        let backup = if target.exists() {
            let backup = unique_sibling(target, "pulsesync-backup");
            retry_io(|| fs::rename(target, &backup))?;
            Some(backup)
        } else {
            None
        };

        Ok(Self {
            target: target.to_path_buf(),
            backup,
            committed: false,
        })
    }

    pub(crate) fn install(&self, source: &Path) -> io::Result<()> {
        move_with_copy_fallback(source, &self.target)
    }

    pub(crate) fn commit(mut self) -> io::Result<Option<PathBuf>> {
        self.committed = true;
        if let Some(backup) = self.backup.take() {
            delete_path(&backup)?;
            return Ok(Some(backup));
        }
        Ok(None)
    }

    pub(crate) fn restore(&mut self) -> io::Result<()> {
        if self.target.exists() {
            delete_path(&self.target)?;
        }
        if let Some(backup) = &self.backup {
            retry_io(|| fs::rename(backup, &self.target))?;
        }
        self.committed = true;
        Ok(())
    }
}

impl Drop for DirectoryTransaction {
    fn drop(&mut self) {
        if self.committed {
            return;
        }
        let _ = self.restore();
    }
}
