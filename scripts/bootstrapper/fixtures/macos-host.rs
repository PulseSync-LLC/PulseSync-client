use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::Duration,
};

fn bundle_from_executable(executable: &Path) -> PathBuf {
    executable
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .expect("fixture executable must be inside Bundle.app/Contents/MacOS")
        .to_path_buf()
}

fn main() {
    let executable = env::current_exe().expect("current executable");
    let bundle = bundle_from_executable(&executable);
    let resources = bundle.join("Contents").join("Resources");
    let state_root = PathBuf::from(
        fs::read_to_string(resources.join("fixture-state-root.txt"))
            .expect("fixture state root")
            .trim(),
    );
    let version = fs::read_to_string(resources.join("fixture-version.txt"))
        .expect("fixture version")
        .trim()
        .to_string();
    let claim_delay_ms = fs::read_to_string(resources.join("fixture-claim-delay-ms.txt"))
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(0);
    fs::create_dir_all(&state_root).expect("create state root");
    fs::write(
        state_root.join("fixture-process-started-version.txt"),
        format!("{version}\n"),
    )
    .expect("write process started version");
    if claim_delay_ms > 0 {
        thread::sleep(Duration::from_millis(claim_delay_ms));
    }
    let bootstrapper = resources.join("bootstrapper").join("pulsesync-bootstrapper");
    let status = Command::new(&bootstrapper)
        .arg("claim-active-app")
        .arg("--json")
        .arg("--state-root")
        .arg(&state_root)
        .arg("--host-bundle")
        .arg(&bundle)
        .arg("--app-executable")
        .arg(&executable)
        .arg("--pid")
        .arg(std::process::id().to_string())
        .arg("--allow-unreserved-recovery")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("claim-active-app command");
    if !status.success() {
        std::process::exit(20);
    }
    fs::write(
        state_root.join("fixture-launched-version.txt"),
        format!("{version}\n"),
    )
    .expect("write launched version");
    thread::sleep(Duration::from_secs(60));
}
