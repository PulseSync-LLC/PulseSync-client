mod file_ops;
mod watcher;

use napi_derive::napi;

pub use file_ops::{copy_file, delete_file, file_exists, move_file, read_file, rename_file};
pub use watcher::watch;

#[napi]
pub fn native_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
