use crate::core::error::Result;
use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, ErrorKind, Write},
    path::Path,
    process::{Command, Stdio},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const SUCCESSOR_ERROR_LOG_RETENTION: Duration = Duration::from_secs(7 * 24 * 60 * 60);
const SUCCESSOR_ERROR_LOG_HEADER: &str = "# PulseSync successor errors since ";

fn successor_error_log_needs_reset(log_path: &Path, now: SystemTime) -> Result<bool> {
    let file = match File::open(log_path) {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(true),
        Err(error) => return Err(error.into()),
    };
    let mut header = String::new();
    BufReader::new(file).read_line(&mut header)?;
    let Some(started_at) = header
        .trim_end()
        .strip_prefix(SUCCESSOR_ERROR_LOG_HEADER)
        .and_then(|value| value.parse::<u64>().ok())
        .and_then(|seconds| UNIX_EPOCH.checked_add(Duration::from_secs(seconds)))
    else {
        return Ok(true);
    };
    Ok(now.duration_since(started_at).unwrap_or_default() >= SUCCESSOR_ERROR_LOG_RETENTION)
}

fn open_successor_error_log(log_path: &Path) -> Result<File> {
    let now = SystemTime::now();
    let reset = successor_error_log_needs_reset(log_path, now)?;
    let mut log = OpenOptions::new()
        .create(true)
        .write(true)
        .append(true)
        .truncate(reset)
        .open(log_path)?;
    if reset {
        let started_at = now.duration_since(UNIX_EPOCH)?.as_secs();
        writeln!(log, "{SUCCESSOR_ERROR_LOG_HEADER}{started_at}")?;
    }
    Ok(log)
}

pub fn launch_app(
    app_executable: &Path,
    args: &[OsString],
    working_directory: Option<&Path>,
) -> Result<u32> {
    launch_app_with_env(app_executable, args, &[], working_directory)
}

pub fn launch_app_with_env(
    app_executable: &Path,
    args: &[OsString],
    env: &[(OsString, OsString)],
    working_directory: Option<&Path>,
) -> Result<u32> {
    let mut command = Command::new(app_executable);
    if let Some(working_directory) = working_directory {
        command.current_dir(working_directory);
    }
    command
        .args(args)
        .envs(env.iter().cloned())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let child = command.spawn()?;
    Ok(child.id())
}

pub fn launch_app_with_env_and_log(
    app_executable: &Path,
    args: &[OsString],
    env: &[(OsString, OsString)],
    log_path: &Path,
    error_log_path: &Path,
    working_directory: &Path,
) -> Result<u32> {
    if let Some(parent) = log_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let stdout = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(log_path)?;
    let stderr = open_successor_error_log(error_log_path)?;
    let mut command = Command::new(app_executable);
    command
        .current_dir(working_directory)
        .args(args)
        .envs(env.iter().cloned())
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let child = command.spawn()?;
    Ok(child.id())
}
