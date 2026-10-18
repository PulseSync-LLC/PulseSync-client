use serde_json::{Value, json};
use std::{
    error::Error,
    fmt, io,
    path::{Path, PathBuf},
};

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

#[derive(Debug)]
pub struct IoOperationError {
    operation: &'static str,
    path: Option<PathBuf>,
    destination: Option<PathBuf>,
    pid: Option<u32>,
    working_directory: Option<PathBuf>,
    source: io::Error,
}

impl IoOperationError {
    pub fn path(operation: &'static str, path: &Path, source: io::Error) -> Self {
        Self {
            operation,
            path: Some(path.to_path_buf()),
            destination: None,
            pid: None,
            working_directory: None,
            source,
        }
    }

    pub fn process(operation: &'static str, pid: u32, source: io::Error) -> Self {
        Self {
            operation,
            path: None,
            destination: None,
            pid: Some(pid),
            working_directory: None,
            source,
        }
    }

    pub fn with_destination(mut self, destination: &Path) -> Self {
        self.destination = Some(destination.to_path_buf());
        self
    }

    pub fn with_working_directory(mut self, working_directory: &Path) -> Self {
        self.working_directory = Some(working_directory.to_path_buf());
        self
    }

    pub fn diagnostic(&self) -> Value {
        json!({
            "operation": self.operation,
            "path": self.path,
            "destination": self.destination,
            "pid": self.pid,
            "workingDirectory": self.working_directory,
            "osCode": self.source.raw_os_error(),
            "errorKind": format!("{:?}", self.source.kind()),
        })
    }
}

impl fmt::Display for IoOperationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.operation)?;
        if let Some(path) = self.path.as_ref() {
            write!(formatter, " path={}", path.display())?;
        }
        if let Some(destination) = self.destination.as_ref() {
            write!(formatter, " destination={}", destination.display())?;
        }
        if let Some(pid) = self.pid {
            write!(formatter, " pid={pid}")?;
        }
        if let Some(directory) = self.working_directory.as_ref() {
            write!(formatter, " workingDirectory={}", directory.display())?;
        }
        write!(formatter, ": {}", self.source)
    }
}

impl Error for IoOperationError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        Some(&self.source)
    }
}
