use crate::core::error::Result;
use std::env;

#[derive(Clone, Debug)]
pub struct Args {
    pub command: String,
    pub passthrough: Vec<String>,
    pub values: Vec<(String, String)>,
    pub json: bool,
    pub keep_install_ui_open: bool,
    pub no_install_ui: bool,
    pub progress_json: bool,
    pub allow_unreserved_recovery: bool,
}

fn is_command(value: &str) -> bool {
    matches!(
        value,
        "claim-active-app"
            | "ack-launch-request"
            | "claim-launch-requests"
            | "check"
            | "download"
            | "discard-prepared-update"
            | "complete-self-update"
            | "plan-install"
            | "prepare-install"
            | "prepare-update"
            | "ensure-installed"
            | "enqueue-launch-request"
            | "install-ui"
            | "install-workflow"
            | "start"
            | "apply-install"
            | "rollback-install"
    )
}

pub fn parse_args() -> Result<Args> {
    let raw = env::args().skip(1).collect::<Vec<_>>();
    let (command, values_start) = raw
        .first()
        .filter(|value| is_command(value))
        .map(|value| (value.clone(), 1))
        .unwrap_or_else(|| ("start".to_string(), 0));
    let mut values = Vec::new();
    let mut passthrough = Vec::new();
    let mut json = false;
    let mut keep_install_ui_open = false;
    let mut no_install_ui = false;
    let mut progress_json = false;
    let mut allow_unreserved_recovery = false;
    let mut index = values_start;

    while let Some(arg) = raw.get(index).cloned() {
        if arg == "--" {
            if command != "start" && command != "complete-self-update" {
                return Err(format!("{command} does not accept passthrough arguments").into());
            }
            passthrough.extend(raw.iter().skip(index + 1).cloned());
            break;
        }
        if arg == "--json" {
            json = true;
            index += 1;
            continue;
        }
        if arg == "--keep-install-ui-open" {
            keep_install_ui_open = true;
            index += 1;
            continue;
        }
        if arg == "--no-install-ui" {
            no_install_ui = true;
            index += 1;
            continue;
        }
        if arg == "--progress-json" {
            progress_json = true;
            index += 1;
            continue;
        }
        if arg == "--allow-unreserved-recovery" {
            allow_unreserved_recovery = true;
            index += 1;
            continue;
        }
        if !arg.starts_with("--") {
            if command == "start" || command == "complete-self-update" {
                passthrough.push(arg);
                index += 1;
                continue;
            }
            return Err(format!("unknown argument: {arg}").into());
        }
        let value = raw
            .get(index + 1)
            .cloned()
            .ok_or_else(|| format!("{arg} requires a value"))?;
        values.push((arg, value));
        index += 2;
    }

    Ok(Args {
        command,
        passthrough,
        values,
        json,
        keep_install_ui_open,
        no_install_ui,
        progress_json,
        allow_unreserved_recovery,
    })
}

pub fn arg_value(args: &Args, name: &str) -> Option<String> {
    args.values
        .iter()
        .find_map(|(key, value)| (key == name).then(|| value.clone()))
}

pub fn required_arg(args: &Args, name: &str) -> Result<String> {
    arg_value(args, name).ok_or_else(|| format!("{name} is required").into())
}

pub fn usize_arg(args: &Args, name: &str) -> Result<Option<usize>> {
    let Some(value) = arg_value(args, name) else {
        return Ok(None);
    };
    let parsed = value
        .parse::<usize>()
        .map_err(|_| format!("{name} must be a positive integer, got {value}"))?;
    if parsed == 0 {
        return Err(format!("{name} must be greater than 0").into());
    }
    Ok(Some(parsed))
}
