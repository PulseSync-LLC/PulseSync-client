use super::{effective_user_id, is_macos_transaction, read_transaction, required_path};
use crate::core::{active_app::write_json_atomic, error::Result};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub fn register_recovery_agent(
    transaction_file: &Path,
    helper: &Path,
    supervised_pid: u32,
    supervised_start_id: &str,
) -> Result<()> {
    let mut transaction = read_transaction(transaction_file)?;
    if !is_macos_transaction(&transaction) {
        return Err("recovery agent requires a macOS bundle transaction".into());
    }
    if cfg!(debug_assertions) && std::env::var_os("PULSESYNC_DISABLE_LAUNCH_AGENT").is_some() {
        transaction["recoveryAgentReady"] = json!(true);
        transaction["recoveryAgentMode"] = json!("disabled-debug");
        write_json_atomic(transaction_file, &transaction)?;
        return Ok(());
    }
    let id = transaction
        .get("transactionId")
        .and_then(Value::as_str)
        .ok_or("macOS transaction id is missing")?;
    let label = format!("app.pulsesync.update.{id}");
    let home = std::env::var_os("HOME").ok_or("HOME is required to register recovery agent")?;
    let plist = PathBuf::from(home)
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{label}.plist"));
    let transaction_dir = required_path(&transaction, "transactionDir")?;
    let stdout_log = transaction_dir.join("recovery-agent.stdout.log");
    let stderr_log = transaction_dir.join("recovery-agent.stderr.log");
    transaction["recoveryAgentLabel"] = json!(label);
    transaction["recoveryAgentPlist"] = json!(plist);
    transaction["recoveryAgentStdout"] = json!(stdout_log);
    transaction["recoveryAgentStderr"] = json!(stderr_log);
    write_json_atomic(transaction_file, &transaction)?;
    fs::create_dir_all(plist.parent().expect("LaunchAgents parent"))?;
    let args = [
        helper.to_string_lossy().to_string(),
        "recover-update".to_string(),
        "--transaction-file".to_string(),
        transaction_file.to_string_lossy().to_string(),
        "--supervise-pid".to_string(),
        supervised_pid.to_string(),
        "--supervise-start-id".to_string(),
        supervised_start_id.to_string(),
    ];
    let arguments = args
        .iter()
        .map(|arg| format!("        <string>{}</string>", xml_escape(arg)))
        .collect::<Vec<_>>()
        .join("\n");
    let payload = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\">\n<dict>\n    <key>Label</key>\n    <string>{}</string>\n    <key>ProgramArguments</key>\n    <array>\n{}\n    </array>\n    <key>EnvironmentVariables</key>\n    <dict><key>PULSESYNC_RECOVERY_AGENT</key><string>1</string></dict>\n    <key>RunAtLoad</key>\n    <true/>\n    <key>KeepAlive</key>\n    <dict><key>SuccessfulExit</key><false/></dict>\n    <key>ThrottleInterval</key>\n    <integer>5</integer>\n    <key>StandardOutPath</key>\n    <string>{}</string>\n    <key>StandardErrorPath</key>\n    <string>{}</string>\n    <key>ProcessType</key>\n    <string>Background</string>\n</dict>\n</plist>\n",
        xml_escape(&label),
        arguments,
        xml_escape(&stdout_log.to_string_lossy()),
        xml_escape(&stderr_log.to_string_lossy()),
    );
    fs::write(&plist, payload)?;
    let domain = format!("gui/{}", effective_user_id()?);
    let output = Command::new("/bin/launchctl")
        .args(["bootstrap", &domain])
        .arg(&plist)
        .output()?;
    if !output.status.success() {
        let _ = fs::remove_file(&plist);
        return Err(format!(
            "launchctl bootstrap failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )
        .into());
    }
    transaction["recoveryAgentReady"] = json!(true);
    transaction["recoveryAgentMode"] = json!("launch-agent");
    write_json_atomic(transaction_file, &transaction)?;
    Ok(())
}

pub fn remove_recovery_agent(transaction_file: &Path) -> Result<()> {
    let mut transaction = read_transaction(transaction_file)?;
    let label = transaction
        .get("recoveryAgentLabel")
        .and_then(Value::as_str)
        .map(str::to_string);
    let plist = transaction
        .get("recoveryAgentPlist")
        .and_then(Value::as_str)
        .map(PathBuf::from);
    if let Some(plist) = plist {
        match fs::remove_file(&plist) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        if let Some(label) = label.as_deref() {
            let service = format!("gui/{}/{}", effective_user_id()?, label);
            transaction["recoveryAgentCleanup"] = json!("bootout-requested");
            write_json_atomic(transaction_file, &transaction)?;
            let output = Command::new("/bin/launchctl")
                .args(["bootout", &service])
                .output()?;
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !output.status.success()
                && !stderr.contains("Could not find service")
                && !stderr.contains("No such process")
            {
                return Err(format!("launchctl bootout failed: {}", stderr.trim()).into());
            }
        }
        transaction["recoveryAgentPlist"] = Value::Null;
        transaction["recoveryAgentLabel"] = Value::Null;
        transaction["recoveryAgentCleanup"] = json!("complete");
        write_json_atomic(transaction_file, &transaction)?;
    }
    Ok(())
}
