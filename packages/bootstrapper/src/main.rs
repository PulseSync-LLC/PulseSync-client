#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

mod cli;
mod commands;
mod core;
mod domain;

use crate::{
    cli::args::{Args, parse_args, required_arg},
    commands::{
        check::check_update,
        claim_active_app::claim_active_app,
        complete_self_update::complete_self_update,
        discard_prepared_update::discard_prepared_update_command,
        download::download_artifacts,
        install::ensure_installed,
        install_workflow::install_workflow,
        launch_inbox::{ack_launch_request, claim_launch_requests, enqueue_launch_request},
        plan_install::plan_install,
        prepare_install::prepare_install,
        prepare_update::prepare_update_command,
        recover_update::recover_update,
        start::start,
    },
    core::{
        error::Result,
        layout::canonical_install_root,
        operation_lock::UpdateLock,
        self_update::{SelfUpdateMutationGate, reconcile_self_update_mutation},
        session_lock::SessionLock,
    },
    domain::transactions::{apply_transaction_file, rollback_transaction_file},
    domain::update_workflow::UpdateWorkflowError,
};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};

fn generic_error_envelope(command: &str, error: &dyn std::error::Error) -> Value {
    let message = error.to_string();
    let lower = message.to_ascii_lowercase();
    let is_lock = lower.contains("lock is busy") || lower.contains("lock is busy after");
    let is_timeout = lower.contains("timeout") || lower.contains("timed out");
    let is_input = (message.starts_with("--")
        && (lower.contains(" is required")
            || lower.contains(" must ")
            || lower.contains(" does not accept")))
        || lower.contains("unknown argument");
    let phase = if is_lock {
        "lock"
    } else if is_input {
        "validate-input"
    } else {
        match command {
            "discard-prepared-update" => "discard",
            "claim-active-app"
            | "enqueue-launch-request"
            | "claim-launch-requests"
            | "ack-launch-request"
            | "start"
            | "complete-self-update" => "handoff",
            _ => "validate-input",
        }
    };
    UpdateWorkflowError::new(
        command.to_string(),
        if is_lock {
            "lock-busy"
        } else if is_timeout {
            "command-timeout"
        } else if is_input {
            "invalid-argument"
        } else {
            "command-failed"
        },
        phase,
        message,
        is_lock || is_timeout,
        false,
    )
    .envelope()
}

fn raw_command_name() -> String {
    std::env::args()
        .nth(1)
        .filter(|value| !value.starts_with("--"))
        .unwrap_or_else(|| "start".to_string())
}

fn install_root_from_updates_path(path: &Path) -> Result<PathBuf> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    };
    let updates_dir = absolute
        .ancestors()
        .find(|ancestor| {
            ancestor
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("updates"))
        })
        .ok_or("mutation path must stay inside the install-root updates directory")?;
    let install_root = updates_dir
        .parent()
        .ok_or("updates directory has no install root parent")?;
    canonical_install_root(install_root)
}

fn run_guarded_mutation(
    install_root: PathBuf,
    operation: impl FnOnce() -> Result<Value>,
) -> Result<Value> {
    let install_root = canonical_install_root(&install_root)?;
    let _update_lock = UpdateLock::acquire(&install_root, Duration::from_secs(30))?;
    let session_lock = SessionLock::acquire(&install_root, Duration::from_secs(10))?;
    match reconcile_self_update_mutation(&install_root)? {
        SelfUpdateMutationGate::Busy(result) => {
            return Ok(json!({
                "schemaVersion": 1,
                "state": "busy",
                "selfUpdate": result,
                "block": {
                    "code": "self-update-busy",
                    "retryable": true,
                    "safeToContinue": false,
                }
            }));
        }
        SelfUpdateMutationGate::Clear => {}
    }
    drop(session_lock);
    operation()
}

fn run(args: &Args) -> Result<Value> {
    match args.command.as_str() {
        "claim-active-app" => claim_active_app(args),
        "enqueue-launch-request" => enqueue_launch_request(args),
        "claim-launch-requests" => claim_launch_requests(args),
        "ack-launch-request" => ack_launch_request(args),
        "prepare-update" => prepare_update_command(args),
        "recover-update" => recover_update(args),
        "discard-prepared-update" => discard_prepared_update_command(args),
        "check" => check_update(args),
        "download" => {
            let root = install_root_from_updates_path(&PathBuf::from(required_arg(
                args,
                "--staging-dir",
            )?))?;
            run_guarded_mutation(root, || download_artifacts(args))
        }
        "plan-install" => {
            run_guarded_mutation(PathBuf::from(required_arg(args, "--install-dir")?), || {
                plan_install(args)
            })
        }
        "prepare-install" => {
            let root =
                install_root_from_updates_path(&PathBuf::from(required_arg(args, "--plan-file")?))?;
            run_guarded_mutation(root, || prepare_install(args))
        }
        "ensure-installed" => {
            run_guarded_mutation(PathBuf::from(required_arg(args, "--install-root")?), || {
                ensure_installed(args)
            })
        }
        "install-workflow" => {
            run_guarded_mutation(PathBuf::from(required_arg(args, "--install-root")?), || {
                install_workflow(args)
            })
        }
        "start" => start(args),
        "complete-self-update" => complete_self_update(args),
        "apply-install" => {
            let transaction_file = PathBuf::from(required_arg(args, "--transaction-file")?);
            let root = install_root_from_updates_path(&transaction_file)?;
            run_guarded_mutation(root, || apply_transaction_file(&transaction_file))
        }
        "rollback-install" => {
            let transaction_file = PathBuf::from(required_arg(args, "--transaction-file")?);
            let root = install_root_from_updates_path(&transaction_file)?;
            run_guarded_mutation(root, || rollback_transaction_file(&transaction_file))
        }
        _ => Err(format!("unknown command: {}", args.command).into()),
    }
}

fn print_result(args: &Args, value: Value) -> Result<()> {
    if args.json {
        println!("{}", serde_json::to_string_pretty(&value)?);
    } else {
        println!(
            "{}",
            value.get("state").and_then(Value::as_str).unwrap_or("ok")
        );
    }
    Ok(())
}

fn main() {
    let args = match parse_args() {
        Ok(args) => args,
        Err(error) => {
            if std::env::args().any(|value| value == "--json") {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&generic_error_envelope(
                        &raw_command_name(),
                        error.as_ref(),
                    ))
                    .unwrap_or_else(|_| {
                        "{\"schemaVersion\":1,\"state\":\"error\"}".to_string()
                    })
                );
            } else {
                eprintln!("{error}");
            }
            std::process::exit(1);
        }
    };

    match run(&args).and_then(|value| print_result(&args, value)) {
        Ok(()) => {}
        Err(error) => {
            if args.json {
                let payload = error
                    .downcast_ref::<UpdateWorkflowError>()
                    .map(UpdateWorkflowError::envelope)
                    .unwrap_or_else(|| generic_error_envelope(&args.command, error.as_ref()));
                println!(
                    "{}",
                    serde_json::to_string_pretty(&payload)
                        .unwrap_or_else(|_| "{\"state\":\"error\"}".to_string())
                );
            } else {
                eprintln!("{error}");
            }
            std::process::exit(1);
        }
    }
}
