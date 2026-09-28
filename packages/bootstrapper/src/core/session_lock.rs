use crate::core::{error::Result, layout::canonical_install_root};
use fs2::FileExt;
use std::{
    fs::{self, File, OpenOptions},
    io,
    path::Path,
    thread,
    time::{Duration, Instant},
};

const SESSION_LOCK_RELATIVE_PATH: &str = "runtime/session.lock";

pub struct SessionLock {
    file: File,
}

impl SessionLock {
    pub fn acquire(install_root: &Path, timeout: Duration) -> Result<Self> {
        let path = canonical_install_root(install_root)?.join(SESSION_LOCK_RELATIVE_PATH);
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
                Ok(()) => return Ok(Self { file }),
                Err(error) if lock_is_contended(&error) => {
                    if started.elapsed() >= timeout {
                        return Err(format!(
                            "session lock is busy after {}ms: {}",
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
}

fn lock_is_contended(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::WouldBlock
        || (cfg!(windows) && matches!(error.raw_os_error(), Some(32 | 33)))
}

impl Drop for SessionLock {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.file);
    }
}
