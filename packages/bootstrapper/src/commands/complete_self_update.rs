use crate::{
    cli::args::{Args, arg_value, required_arg},
    core::{error::Result, layout::resolve_layout},
    domain::{launcher::launch_app, transactions::apply_transaction_file},
};
use serde_json::{Value, json};
use std::{ffi::OsString, path::PathBuf, thread, time::Duration};

pub fn complete_self_update(args: &Args) -> Result<Value> {
    let transaction_file = PathBuf::from(required_arg(args, "--transaction-file")?);
    let app_executable = PathBuf::from(required_arg(args, "--app-executable")?);
    let delay_ms = arg_value(args, "--delay-ms")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(750);

    if delay_ms > 0 {
        thread::sleep(Duration::from_millis(delay_ms));
    }

    let applied = apply_transaction_file(&transaction_file)?;
    if applied.get("state").and_then(Value::as_str) != Some("applied") {
        return Ok(json!({
            "state": "blocked",
            "launched": false,
            "appExecutable": app_executable,
            "transactionFile": transaction_file,
            "applyResult": applied,
            "reason": "Self-update transaction did not apply cleanly"
        }));
    }

    let passthrough_args = args
        .passthrough
        .iter()
        .map(OsString::from)
        .collect::<Vec<_>>();
    let launch_executable = match arg_value(args, "--install-root") {
        Some(install_root) => {
            resolve_layout(
                PathBuf::from(install_root),
                arg_value(args, "--app-executable-name"),
            )?
            .app_executable
        }
        None => app_executable,
    };
    let pid = launch_app(&launch_executable, &passthrough_args)?;
    Ok(json!({
        "state": "launched",
        "launched": true,
        "pid": pid,
        "appExecutable": launch_executable,
        "transactionFile": transaction_file,
        "applyResult": applied,
        "reason": "Self-update transaction applied by prepared bootstrapper before launch"
    }))
}
