use crate::core::error::Result;
use std::{
    ffi::OsString,
    fs::{self, OpenOptions},
    path::Path,
    process::{Command, Stdio},
};

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
    let stderr = stdout.try_clone()?;
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
