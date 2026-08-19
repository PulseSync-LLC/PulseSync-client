use super::handoff::{HandoffContext, reload_handoff_context};
use crate::{
    core::{
        active_app::{ProcessIdentity, current_process_identity, inspect_process_with_retry},
        error::Result,
        layout::assert_inside,
        self_update::{
            new_self_update_reservation, read_self_update_reservation,
            remove_self_update_reservation, reservation_child_is_live,
            write_self_update_reservation, write_self_update_result,
        },
        session_lock::SessionLock,
    },
    domain::{launcher::launch_app, macos_bundle, transactions::transaction_artifacts},
};
use serde_json::{Value, json};
use std::{
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};
use uuid::Uuid;

pub(super) fn infer_install_root() -> Result<PathBuf> {
    let executable = env::current_exe()?;
    let executable_dir = executable
        .parent()
        .ok_or("bootstrapper executable has no parent directory")?;

    if executable_dir.file_name().and_then(|value| value.to_str()) == Some("bootstrapper") {
        return Ok(executable_dir
            .parent()
            .ok_or("bootstrapper directory has no install root parent")?
            .to_path_buf());
    }

    Ok(executable_dir.to_path_buf())
}

pub(super) fn read_transaction_file(transaction_file: &Path) -> Result<Value> {
    Ok(serde_json::from_slice(&fs::read(transaction_file)?)?)
}

pub(super) fn prepared_bootstrapper_path(transaction_file: &Path) -> Result<Option<PathBuf>> {
    let transaction = read_transaction_file(transaction_file)?;
    for artifact in transaction_artifacts(&transaction)? {
        if artifact.key == "bootstrapper" {
            return Ok(Some(artifact.prepared_path));
        }
    }
    Ok(None)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn launch_self_update_handoff(
    prepared_bootstrapper: &Path,
    transaction_file: &Path,
    install_root: &Path,
    host_bundle: Option<&Path>,
    app_executable_name: Option<&str>,
    app_executable: &Path,
    passthrough_args: &[OsString],
    context: Option<&mut HandoffContext>,
    parent_override: Option<&ProcessIdentity>,
) -> Result<Value> {
    let transaction_value: Value = serde_json::from_slice(&fs::read(transaction_file)?)?;
    let is_macos_bundle_transaction = macos_bundle::is_macos_transaction(&transaction_value);
    let _session_lock = SessionLock::acquire(install_root, Duration::from_secs(10))?;
    let (app_handoff_id, active_lease_id, inbox_id, inbox_generation, transfer_state) =
        if let Some(context) = context {
            *context = reload_handoff_context(install_root, context)?;
            (
                Some(context.transfer.handoff_id.clone()),
                Some(context.predecessor.lease_id.clone()),
                Some(context.predecessor.inbox_id.clone()),
                Some(context.predecessor.inbox_generation),
                Some("armed".to_string()),
            )
        } else {
            (None, None, None, None, None)
        };
    if let Some(existing) = read_self_update_reservation(install_root)? {
        if reservation_child_is_live(&existing)? {
            let result = write_self_update_result(install_root, "busy", &existing)?;
            return Ok(json!({
                "schemaVersion": 1,
                "state": "busy",
                "launched": false,
                "selfUpdate": result,
            }));
        }
        write_self_update_result(install_root, "stale-cleaned", &existing)?;
        remove_self_update_reservation(install_root)?;
    }
    let transaction_dir = transaction_file
        .parent()
        .ok_or("self-update transaction file has no parent")?;
    assert_inside(
        transaction_dir,
        prepared_bootstrapper,
        "prepared bootstrapper",
    )?;
    if !prepared_bootstrapper.is_file() {
        return Err("prepared bootstrapper is missing".into());
    }
    let reservation_id = Uuid::new_v4().to_string();
    let parent = parent_override
        .cloned()
        .unwrap_or(current_process_identity()?);
    let mut command = Command::new(prepared_bootstrapper);
    command
        .current_dir(install_root)
        .arg("complete-self-update")
        .arg("--json")
        .arg("--transaction-file")
        .arg(transaction_file)
        .arg("--app-executable")
        .arg(app_executable)
        .arg("--state-root")
        .arg(install_root)
        .env("PULSESYNC_SELF_UPDATE_HANDOFF_ID", &reservation_id);
    if let Some(host_bundle) = host_bundle {
        command.arg("--host-bundle").arg(host_bundle);
    }
    if let Some(app_executable_name) = app_executable_name {
        command
            .arg("--app-executable-name")
            .arg(app_executable_name);
    }
    command
        .arg("--")
        .args(passthrough_args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let child = command.spawn()?;
    let child_identity =
        inspect_process_with_retry(child.id(), prepared_bootstrapper, Duration::from_secs(5))?;
    let reservation = new_self_update_reservation(
        install_root,
        reservation_id,
        &parent,
        &child_identity,
        app_handoff_id.clone(),
        active_lease_id,
        inbox_id,
        inbox_generation,
        transfer_state,
    )?;
    write_self_update_reservation(install_root, &reservation)?;
    if is_macos_bundle_transaction
        && host_bundle.is_some()
        && let Err(error) = (|| -> Result<()> {
            macos_bundle::bind_app_handoff(transaction_file, app_handoff_id.as_deref())?;
            macos_bundle::register_recovery_agent(
                transaction_file,
                prepared_bootstrapper,
                child_identity.pid,
                &child_identity.process_start_id,
            )
        })()
    {
        let _ = macos_bundle::signal_process(child_identity.pid, false);
        let _ = remove_self_update_reservation(install_root);
        let _ = macos_bundle::recover_transaction(transaction_file);
        let _ = launch_app(app_executable, &[], Some(install_root));
        return Err(error);
    }
    let result = write_self_update_result(install_root, "reserved", &reservation)?;
    Ok(json!({
        "schemaVersion": 1,
        "state": "reserved",
        "launched": false,
        "handoffPid": child_identity.pid,
        "handoffId": app_handoff_id,
        "selfUpdate": result,
    }))
}
