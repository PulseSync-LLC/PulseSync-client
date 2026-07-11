use super::{
    handoff::repair_handoff_successor_publication,
    model::{ActiveAppLease, ActiveAppLeaseState, AppLaunchReservation, ProcessIdentity},
    storage::{
        active_app_path, canonical_or_owned, launch_reservation_path, read_json_if_exists,
        remove_if_exists, same_path, write_json_atomic,
    },
};
use crate::core::{error::Result, host_contract::assert_runtime_executable};
use std::{
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

pub fn lease_matches_process(lease: &ActiveAppLease, process: &ProcessIdentity) -> bool {
    lease.pid == process.pid
        && lease.process_start_id == process.process_start_id
        && same_path(&lease.executable, &process.executable)
}

pub fn read_active_lease(install_root: &Path) -> Result<Option<ActiveAppLease>> {
    read_json_if_exists(&active_app_path(install_root))
}

pub fn write_active_lease(install_root: &Path, lease: &ActiveAppLease) -> Result<()> {
    if lease.schema_version != 1 || lease.lease_id.trim().is_empty() {
        return Err("invalid active app lease".into());
    }
    assert_runtime_executable(install_root, &lease.executable, "active app executable")?;
    write_json_atomic(&active_app_path(install_root), lease)
}

pub fn read_launch_reservation(install_root: &Path) -> Result<Option<AppLaunchReservation>> {
    read_json_if_exists(&launch_reservation_path(install_root))
}

pub fn write_launch_reservation(
    install_root: &Path,
    reservation: &AppLaunchReservation,
) -> Result<()> {
    assert_runtime_executable(
        install_root,
        &reservation.executable,
        "launch reservation executable",
    )?;
    write_json_atomic(&launch_reservation_path(install_root), reservation)
}

pub fn remove_launch_reservation(install_root: &Path) -> Result<()> {
    remove_if_exists(&launch_reservation_path(install_root))
}

pub fn verified_live_lease(install_root: &Path) -> Result<Option<ActiveAppLease>> {
    let Some(lease) = read_active_lease(install_root)? else {
        return Ok(None);
    };
    if lease.schema_version != 1 {
        return Err(format!(
            "unsupported active app lease schemaVersion {}",
            lease.schema_version
        )
        .into());
    }
    if process_identity_is_live(&lease.process_identity())? {
        repair_handoff_successor_publication(install_root, &lease)?;
        return Ok(Some(lease));
    }
    if lease.state == ActiveAppLeaseState::HandoffArmed && handoff_owner_is_live(&lease)? {
        return Ok(Some(lease));
    }
    Ok(None)
}

pub fn handoff_owner_is_live(lease: &ActiveAppLease) -> Result<bool> {
    let Some(handoff) = lease.handoff.as_ref() else {
        return Ok(false);
    };
    process_start_is_live(handoff.rust_pid, &handoff.rust_process_start_id)
}

pub fn inspect_process_with_retry(
    pid: u32,
    expected_executable: &Path,
    timeout: Duration,
) -> Result<ProcessIdentity> {
    let started = Instant::now();
    loop {
        if let Some(identity) = inspect_process(pid, expected_executable)? {
            return Ok(identity);
        }
        if started.elapsed() >= timeout {
            return Err(format!("process {pid} did not become inspectable").into());
        }
        thread::sleep(Duration::from_millis(25));
    }
}

pub fn process_identity_is_live(identity: &ProcessIdentity) -> Result<bool> {
    let Some(current) = inspect_process(identity.pid, &identity.executable)? else {
        return Ok(false);
    };
    Ok(current.process_start_id == identity.process_start_id
        && same_path(&current.executable, &identity.executable))
}

pub fn process_start_is_live(pid: u32, process_start_id: &str) -> Result<bool> {
    process_start_is_live_platform(pid, process_start_id)
}

#[cfg(windows)]
fn process_start_is_live_platform(pid: u32, process_start_id: &str) -> Result<bool> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, FILETIME, STILL_ACTIVE},
        System::Threading::{
            GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        },
    };

    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        let error = std::io::Error::last_os_error();
        return match error.raw_os_error() {
            Some(87) | Some(1168) => Ok(false),
            _ => Err(error.into()),
        };
    }
    let result = (|| -> Result<bool> {
        let mut exit_code = 0_u32;
        if unsafe { GetExitCodeProcess(handle, &mut exit_code) } == 0
            || exit_code != STILL_ACTIVE as u32
        {
            return Ok(false);
        }
        let mut creation = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        if unsafe { GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }
        let start_id = ((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64;
        Ok(start_id.to_string() == process_start_id)
    })();
    unsafe {
        CloseHandle(handle);
    }
    result
}

#[cfg(all(unix, not(target_os = "macos")))]
fn process_start_is_live_platform(pid: u32, process_start_id: &str) -> Result<bool> {
    if unsafe { libc::kill(pid as i32, 0) } != 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            return Ok(false);
        }
        if error.raw_os_error() != Some(libc::EPERM) {
            return Err(error.into());
        }
    }
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat"))?;
    let start_id = stat
        .rsplit_once(')')
        .map(|(_, rest)| rest.trim())
        .and_then(|rest| rest.split_whitespace().nth(19))
        .ok_or("process stat is missing start time")?;
    Ok(start_id == process_start_id)
}

#[cfg(target_os = "macos")]
fn process_start_is_live_platform(pid: u32, process_start_id: &str) -> Result<bool> {
    use std::mem::MaybeUninit;

    if unsafe { libc::kill(pid as i32, 0) } != 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            return Ok(false);
        }
        if error.raw_os_error() != Some(libc::EPERM) {
            return Err(error.into());
        }
    }
    let mut info = MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let info_size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
    let read = unsafe {
        libc::proc_pidinfo(
            pid as i32,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            info_size,
        )
    };
    if read != info_size {
        return Err(std::io::Error::last_os_error().into());
    }
    let info = unsafe { info.assume_init() };
    Ok(format!("{}.{}", info.pbi_start_tvsec, info.pbi_start_tvusec) == process_start_id)
}

pub fn current_process_identity() -> Result<ProcessIdentity> {
    let executable = std::env::current_exe()?;
    inspect_process_with_retry(std::process::id(), &executable, Duration::from_secs(1))
}

#[cfg(windows)]
fn inspect_process(pid: u32, expected_executable: &Path) -> Result<Option<ProcessIdentity>> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, FILETIME, STILL_ACTIVE},
        System::Threading::{
            GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
            QueryFullProcessImageNameW,
        },
    };

    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        let error = std::io::Error::last_os_error();
        return match error.raw_os_error() {
            Some(87) | Some(1168) => Ok(None),
            _ => Err(error.into()),
        };
    }

    let result = (|| -> Result<Option<ProcessIdentity>> {
        let mut exit_code = 0_u32;
        if unsafe { GetExitCodeProcess(handle, &mut exit_code) } == 0
            || exit_code != STILL_ACTIVE as u32
        {
            return Ok(None);
        }

        let mut creation = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        if unsafe { GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) } == 0
        {
            return Err(std::io::Error::last_os_error().into());
        }

        let mut buffer = vec![0_u16; 32_768];
        let mut length = buffer.len() as u32;
        if unsafe { QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut length) } == 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        buffer.truncate(length as usize);
        let executable = PathBuf::from(String::from_utf16(&buffer)?);
        if !same_path(&executable, expected_executable) {
            return Ok(None);
        }
        let start_id = ((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64;
        Ok(Some(ProcessIdentity {
            pid,
            process_start_id: start_id.to_string(),
            executable: canonical_or_owned(&executable),
        }))
    })();
    unsafe {
        CloseHandle(handle);
    }
    result
}

#[cfg(all(unix, not(target_os = "macos")))]
fn inspect_process(pid: u32, expected_executable: &Path) -> Result<Option<ProcessIdentity>> {
    if unsafe { libc::kill(pid as i32, 0) } != 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            return Ok(None);
        }
    }

    let proc_root = PathBuf::from(format!("/proc/{pid}"));
    let executable = std::fs::read_link(proc_root.join("exe"))
        .unwrap_or_else(|_| canonical_or_owned(expected_executable));
    if !same_path(&executable, expected_executable) {
        return Ok(None);
    }
    let start_id = std::fs::read_to_string(proc_root.join("stat"))
        .ok()
        .and_then(|stat| {
            stat.rsplit_once(')')
                .map(|(_, rest)| rest.trim().to_string())
        })
        .and_then(|rest| rest.split_whitespace().nth(19).map(str::to_string))
        .unwrap_or_else(|| format!("pid-{pid}"));
    Ok(Some(ProcessIdentity {
        pid,
        process_start_id: start_id,
        executable: canonical_or_owned(&executable),
    }))
}

#[cfg(target_os = "macos")]
fn inspect_process(pid: u32, expected_executable: &Path) -> Result<Option<ProcessIdentity>> {
    use std::{ffi::CStr, mem::MaybeUninit};

    if unsafe { libc::kill(pid as i32, 0) } != 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ESRCH) {
            return Ok(None);
        }
        return Err(error.into());
    }

    let mut path_buffer = vec![0_u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    let path_length = unsafe {
        libc::proc_pidpath(
            pid as i32,
            path_buffer.as_mut_ptr().cast(),
            path_buffer.len() as u32,
        )
    };
    if path_length <= 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    let executable = PathBuf::from(
        CStr::from_bytes_until_nul(&path_buffer)
            .map_err(|_| "macOS process path is not null-terminated")?
            .to_string_lossy()
            .to_string(),
    );
    if !same_path(&executable, expected_executable) {
        return Ok(None);
    }

    let mut info = MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let info_size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
    let read = unsafe {
        libc::proc_pidinfo(
            pid as i32,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            info_size,
        )
    };
    if read != info_size {
        return Err(std::io::Error::last_os_error().into());
    }
    let info = unsafe { info.assume_init() };
    Ok(Some(ProcessIdentity {
        pid,
        process_start_id: format!("{}.{}", info.pbi_start_tvsec, info.pbi_start_tvusec),
        executable: canonical_or_owned(&executable),
    }))
}
