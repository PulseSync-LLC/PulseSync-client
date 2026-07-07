mod cli;
mod commands;
mod core;
mod domain;

use crate::{
    cli::args::{Args, parse_args, required_arg},
    commands::{
        check::check_update, complete_self_update::complete_self_update,
        download::download_artifacts, install::ensure_installed, install_ui::install_ui,
        install_workflow::install_workflow, plan_install::plan_install,
        prepare_install::prepare_install, start::start,
    },
    core::error::Result,
    domain::transactions::{apply_transaction_file, rollback_transaction_file},
};
use serde_json::{Value, json};
use std::path::PathBuf;

fn run(args: &Args) -> Result<Value> {
    match args.command.as_str() {
        "check" => check_update(args),
        "download" => download_artifacts(args),
        "plan-install" => plan_install(args),
        "prepare-install" => prepare_install(args),
        "ensure-installed" => ensure_installed(args),
        "install-ui" => install_ui(args),
        "install-workflow" => install_workflow(args),
        "start" => start(args),
        "complete-self-update" => complete_self_update(args),
        "apply-install" => {
            let transaction_file = PathBuf::from(required_arg(args, "--transaction-file")?);
            apply_transaction_file(&transaction_file)
        }
        "rollback-install" => {
            let transaction_file = PathBuf::from(required_arg(args, "--transaction-file")?);
            rollback_transaction_file(&transaction_file)
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
            eprintln!("{error}");
            std::process::exit(1);
        }
    };

    match run(&args).and_then(|value| print_result(&args, value)) {
        Ok(()) => {}
        Err(error) => {
            if args.json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&json!({
                        "state": "error",
                        "error": error.to_string()
                    }))
                    .unwrap_or_else(|_| "{\"state\":\"error\"}".to_string())
                );
            } else {
                eprintln!("{error}");
            }
            std::process::exit(1);
        }
    }
}
