use crate::core::error::Result;
use std::{
    ffi::OsString,
    path::Path,
    process::{Command, Stdio},
};

pub fn launch_app(app_executable: &Path, args: &[OsString]) -> Result<u32> {
    let mut command = Command::new(app_executable);
    command
        .args(args)
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
