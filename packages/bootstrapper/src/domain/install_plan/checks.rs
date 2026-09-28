use crate::domain::install_plan::InstallPlanCheck;
use std::{
    fs,
    path::{Path, PathBuf},
};

pub(crate) fn pass(
    id: &str,
    message: impl Into<String>,
    path: Option<PathBuf>,
) -> InstallPlanCheck {
    InstallPlanCheck {
        id: id.to_string(),
        message: message.into(),
        path,
        status: "pass".to_string(),
    }
}

pub(crate) fn block(
    id: &str,
    message: impl Into<String>,
    path: Option<PathBuf>,
) -> InstallPlanCheck {
    InstallPlanCheck {
        id: id.to_string(),
        message: message.into(),
        path,
        status: "block".to_string(),
    }
}

pub(crate) fn warn(
    id: &str,
    message: impl Into<String>,
    path: Option<PathBuf>,
) -> InstallPlanCheck {
    InstallPlanCheck {
        id: id.to_string(),
        message: message.into(),
        path,
        status: "warn".to_string(),
    }
}

pub(crate) fn check_install_dir(install_dir: &Path) -> InstallPlanCheck {
    match fs::metadata(install_dir) {
        Ok(metadata) if metadata.is_dir() => pass(
            "install-dir-directory",
            "Install directory exists",
            Some(install_dir.to_path_buf()),
        ),
        Ok(_) => block(
            "install-dir-directory",
            "Install path exists but is not a directory",
            Some(install_dir.to_path_buf()),
        ),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => block(
            "install-dir-directory",
            "Install directory does not exist",
            Some(install_dir.to_path_buf()),
        ),
        Err(error) => block(
            "install-dir-directory",
            format!("Install directory cannot be inspected: {error}"),
            Some(install_dir.to_path_buf()),
        ),
    }
}
