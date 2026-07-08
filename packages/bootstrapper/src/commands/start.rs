use crate::{
    cli::args::{Args, arg_value, usize_arg},
    commands::install_ui::run_install_ui,
    core::{
        error::Result,
        layout::{
            DEFAULT_RETAIN_APP_VERSIONS, Layout, normalize_retain_app_versions, resolve_layout,
        },
    },
    domain::{
        install_workflow::{
            InstallWorkflowOptions, default_staging_root,
            events::{NoopInstallProgressReporter, StderrJsonInstallProgressReporter},
            run_install_workflow,
        },
        manifest::GitHubManifestFallback,
        launcher::launch_app,
        startup_config::{BootstrapperStartupConfig, load_startup_config},
        transactions::{
            apply_transaction_file, newest_transaction, rollback_transaction_file,
            transaction_artifacts,
        },
    },
};
use serde_json::{Value, json};
use std::{
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

fn infer_install_root() -> Result<PathBuf> {
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

fn current_dist() -> String {
    let platform = if cfg!(windows) {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        env::consts::OS
    };
    let arch = match env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        value => value,
    };
    format!("{platform}-{arch}")
}

fn option_from_arg_or_config(
    args: &Args,
    arg_name: &str,
    config_value: Option<String>,
) -> Option<String> {
    arg_value(args, arg_name).or(config_value)
}

fn read_transaction_file(transaction_file: &Path) -> Result<Value> {
    Ok(serde_json::from_slice(&fs::read(transaction_file)?)?)
}

fn prepared_bootstrapper_path(transaction_file: &Path) -> Result<Option<PathBuf>> {
    let transaction = read_transaction_file(transaction_file)?;
    for artifact in transaction_artifacts(&transaction)? {
        if artifact.key == "bootstrapper" {
            return Ok(Some(artifact.prepared_path));
        }
    }
    Ok(None)
}

fn launch_self_update_handoff(
    prepared_bootstrapper: &Path,
    transaction_file: &Path,
    install_root: Option<&Path>,
    app_executable_name: Option<&str>,
    app_executable: &Path,
    passthrough_args: &[OsString],
) -> Result<u32> {
    let mut command = Command::new(prepared_bootstrapper);
    command
        .arg("complete-self-update")
        .arg("--transaction-file")
        .arg(transaction_file)
        .arg("--app-executable")
        .arg(app_executable);
    if let Some(install_root) = install_root {
        command.arg("--install-root").arg(install_root);
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
    Ok(child.id())
}

fn resolve_current_app_executable(
    install_root: Option<&PathBuf>,
    app_executable_name: Option<String>,
    fallback: &Path,
) -> Result<PathBuf> {
    if let Some(install_root) = install_root {
        return Ok(resolve_layout(install_root.clone(), app_executable_name)?.app_executable);
    }

    Ok(fallback.to_path_buf())
}

fn ensure_app_executable(app_executable: &Path) -> Result<()> {
    if !app_executable.is_file() {
        return Err(format!(
            "app executable path is not a file: {}",
            app_executable.display()
        )
        .into());
    }

    Ok(())
}

fn ensure_first_run_install(
    args: &Args,
    layout: &Layout,
    config: Option<&BootstrapperStartupConfig>,
) -> Result<Option<Value>> {
    if layout.app_executable.is_file() {
        return Ok(None);
    }

    let manifest_url = option_from_arg_or_config(
        args,
        "--manifest-url",
        config.and_then(BootstrapperStartupConfig::manifest_url),
    )
    .ok_or("app executable is missing and bootstrapper manifestUrl is not configured")?;
    let dist = option_from_arg_or_config(
        args,
        "--dist",
        config.and_then(BootstrapperStartupConfig::dist),
    )
    .unwrap_or_else(current_dist);
    let server_health_url = option_from_arg_or_config(
        args,
        "--server-health-url",
        config.and_then(BootstrapperStartupConfig::server_health_url),
    );
    let github_channel = option_from_arg_or_config(
        args,
        "--github-channel",
        config.and_then(BootstrapperStartupConfig::github_channel),
    );
    let github_owner = option_from_arg_or_config(
        args,
        "--github-owner",
        config.and_then(BootstrapperStartupConfig::github_owner),
    );
    let github_repo = option_from_arg_or_config(
        args,
        "--github-repo",
        config.and_then(BootstrapperStartupConfig::github_repo),
    );
    let installed_version = option_from_arg_or_config(
        args,
        "--installed-version",
        config.and_then(BootstrapperStartupConfig::installed_version),
    )
    .unwrap_or_else(|| "0.0.0".to_string());
    let retain_app_versions = normalize_retain_app_versions(
        usize_arg(args, "--retain-app-versions")?
            .or_else(|| config.and_then(BootstrapperStartupConfig::retain_app_versions))
            .unwrap_or(DEFAULT_RETAIN_APP_VERSIONS),
    );
    let staging_root = arg_value(args, "--staging-dir")
        .map(PathBuf::from)
        .unwrap_or_else(|| default_staging_root(layout));
    let github_fallback = server_health_url.map(|health_url| {
        let mut fallback = GitHubManifestFallback::new(
            github_channel.unwrap_or_else(|| "beta".to_string()),
            dist.clone(),
            health_url,
        );
        if let Some(owner) = github_owner {
            fallback.owner = owner;
        }
        if let Some(repo) = github_repo {
            fallback.repo = repo;
        }
        fallback
    });
    let options = InstallWorkflowOptions {
        dist,
        install_root: layout.install_root.clone(),
        installed_version,
        github_fallback,
        layout: layout.clone(),
        manifest_url,
        retain_app_versions,
        staging_root,
    };

    if !args.json && !args.progress_json && !args.no_install_ui {
        return run_install_ui(&options).map(Some).map_err(Into::into);
    }

    if args.progress_json {
        Ok(Some(run_install_workflow(
            &options,
            &StderrJsonInstallProgressReporter,
        )?))
    } else {
        Ok(Some(run_install_workflow(
            &options,
            &NoopInstallProgressReporter,
        )?))
    }
}

pub fn start(args: &Args) -> Result<Value> {
    let install_root = arg_value(args, "--install-root")
        .map(PathBuf::from)
        .or_else(|| infer_install_root().ok());
    let startup_config = install_root
        .as_deref()
        .map(load_startup_config)
        .transpose()?
        .flatten();
    let app_executable_name = arg_value(args, "--app-executable-name").or_else(|| {
        startup_config
            .as_ref()
            .and_then(BootstrapperStartupConfig::app_executable_name)
    });
    let mut layout = install_root
        .as_ref()
        .map(|install_root| resolve_layout(install_root.clone(), app_executable_name.clone()))
        .transpose()?;
    let transaction_root = arg_value(args, "--transaction-root")
        .map(PathBuf::from)
        .or_else(|| layout.as_ref().map(|value| value.transaction_root.clone()))
        .ok_or("--install-root or --transaction-root is required")?;
    let first_run_install = match layout.as_ref() {
        Some(layout) => ensure_first_run_install(args, layout, startup_config.as_ref())?,
        None => None,
    };

    if first_run_install.is_some() {
        layout = install_root
            .as_ref()
            .map(|install_root| resolve_layout(install_root.clone(), app_executable_name.clone()))
            .transpose()?;
    }

    let app_executable = arg_value(args, "--app-executable")
        .map(PathBuf::from)
        .or_else(|| layout.as_ref().map(|value| value.app_executable.clone()))
        .ok_or("--install-root or --app-executable is required")?;

    let passthrough_args = args
        .passthrough
        .iter()
        .map(OsString::from)
        .collect::<Vec<_>>();
    let selected = newest_transaction(&transaction_root)?;
    if let Some(selected) = selected {
        match selected.state.as_str() {
            "prepared" => {
                if let Some(prepared_bootstrapper) = prepared_bootstrapper_path(&selected.path)? {
                    let pid = launch_self_update_handoff(
                        &prepared_bootstrapper,
                        &selected.path,
                        install_root.as_deref(),
                        app_executable_name.as_deref(),
                        &app_executable,
                        &passthrough_args,
                    )?;
                    return Ok(json!({
                        "state": "handoff",
                        "launched": false,
                        "handoffPid": pid,
                        "appExecutable": app_executable,
                        "transactionRoot": transaction_root,
                        "transactionAction": "self-update-handoff",
                        "firstRunInstall": first_run_install,
                        "selectedTransactionFile": selected.path,
                        "preparedBootstrapper": prepared_bootstrapper,
                        "transactionStateBefore": selected.state,
                        "reason": "Prepared transaction includes bootstrapper; launched prepared bootstrapper to apply it"
                    }));
                }
                let applied = apply_transaction_file(&selected.path)?;
                if applied.get("state").and_then(Value::as_str) != Some("applied") {
                    return Ok(json!({
                        "state": "blocked",
                        "launched": false,
                        "appExecutable": app_executable,
                        "transactionRoot": transaction_root,
                        "transactionAction": "apply",
                        "firstRunInstall": first_run_install,
                        "selectedTransactionFile": selected.path,
                        "transactionStateBefore": selected.state,
                        "transactionStateAfter": applied.get("state").and_then(Value::as_str).unwrap_or("failed"),
                        "reason": "Prepared transaction did not apply cleanly"
                    }));
                }
                let launch_executable = resolve_current_app_executable(
                    install_root.as_ref(),
                    app_executable_name.clone(),
                    &app_executable,
                )?;
                ensure_app_executable(&launch_executable)?;
                let pid = launch_app(&launch_executable, &passthrough_args)?;
                return Ok(json!({
                    "state": "launched",
                    "launched": true,
                    "pid": pid,
                    "appExecutable": launch_executable,
                    "transactionRoot": transaction_root,
                    "transactionAction": "apply",
                    "selectedTransactionFile": selected.path,
                    "transactionStateBefore": selected.state,
                    "transactionStateAfter": "applied",
                    "reason": "Prepared transaction applied before launch"
                }));
            }
            "failed" => {
                let rolled_back = rollback_transaction_file(&selected.path)?;
                if rolled_back.get("state").and_then(Value::as_str) != Some("rolled-back") {
                    return Ok(json!({
                        "state": "blocked",
                        "launched": false,
                        "appExecutable": app_executable,
                        "transactionRoot": transaction_root,
                        "transactionAction": "rollback",
                        "firstRunInstall": first_run_install,
                        "selectedTransactionFile": selected.path,
                        "transactionStateBefore": selected.state,
                        "transactionStateAfter": rolled_back.get("state").and_then(Value::as_str).unwrap_or("failed"),
                        "reason": "Failed transaction did not roll back cleanly"
                    }));
                }
                ensure_app_executable(&app_executable)?;
                let pid = launch_app(&app_executable, &passthrough_args)?;
                return Ok(json!({
                    "state": "launched",
                    "launched": true,
                    "pid": pid,
                    "appExecutable": app_executable,
                    "transactionRoot": transaction_root,
                    "transactionAction": "rollback",
                    "selectedTransactionFile": selected.path,
                    "transactionStateBefore": selected.state,
                    "transactionStateAfter": "rolled-back",
                    "reason": "Failed transaction rolled back before launch"
                }));
            }
            "applied" | "rolled-back" => {
                ensure_app_executable(&app_executable)?;
                let pid = launch_app(&app_executable, &passthrough_args)?;
                return Ok(json!({
                    "state": "launched",
                    "launched": true,
                    "pid": pid,
                    "appExecutable": app_executable,
                    "transactionRoot": transaction_root,
                    "transactionAction": "skip",
                    "firstRunInstall": first_run_install,
                    "selectedTransactionFile": selected.path,
                    "transactionStateBefore": selected.state,
                    "transactionStateAfter": selected.state,
                    "reason": format!("Transaction is already in safe terminal state: {}", selected.state)
                }));
            }
            "blocked" | "rollback-blocked" => {
                return Ok(json!({
                    "state": "blocked",
                    "launched": false,
                    "appExecutable": app_executable,
                    "transactionRoot": transaction_root,
                    "transactionAction": "block",
                    "selectedTransactionFile": selected.path,
                    "transactionStateBefore": selected.state,
                    "transactionStateAfter": selected.state,
                    "reason": format!("Transaction state blocks launch: {}", selected.state)
                }));
            }
            _ => {}
        }
    }

    ensure_app_executable(&app_executable)?;
    let pid = launch_app(&app_executable, &passthrough_args)?;
    Ok(json!({
        "state": "launched",
        "launched": true,
        "pid": pid,
        "appExecutable": app_executable,
        "transactionRoot": transaction_root,
        "transactionAction": "none",
        "firstRunInstall": first_run_install,
        "reason": "No pending transaction was found"
    }))
}
