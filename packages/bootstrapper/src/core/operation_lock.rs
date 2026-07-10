use crate::core::{error::Result, layout::canonical_install_root};
use fs2::FileExt;
use std::{
    fs::{self, File, OpenOptions},
    io,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

const UPDATE_LOCK_RELATIVE_PATH: &str = "updates/update.lock";

pub struct UpdateLock {
    file: File,
}

impl UpdateLock {
    pub fn acquire(install_root: &Path, timeout: Duration) -> Result<Self> {
        let path = canonical_install_root(install_root)?.join(UPDATE_LOCK_RELATIVE_PATH);
        acquire_lock(path, timeout, "update")
    }
}

impl Drop for UpdateLock {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.file);
    }
}

fn acquire_lock(path: PathBuf, timeout: Duration, label: &str) -> Result<UpdateLock> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let file = OpenOptions::new()
        .create(true)
        .read(true)
        .truncate(false)
        .write(true)
        .open(&path)?;
    let started = Instant::now();

    loop {
        match file.try_lock_exclusive() {
            Ok(()) => return Ok(UpdateLock { file }),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                if started.elapsed() >= timeout {
                    return Err(format!(
                        "{label} lock is busy after {}ms: {}",
                        timeout.as_millis(),
                        path.display()
                    )
                    .into());
                }
                thread::sleep(Duration::from_millis(25));
            }
            Err(error) => return Err(error.into()),
        }
    }
}
