mod artifact;
mod file_ops;
mod fs_transaction;
mod watcher;

use napi_derive::napi;

pub use artifact::{hash_file, install_unpacked_artifact, prepare_asar_artifact};
pub use file_ops::{copy_file, delete_file, file_exists, move_file, read_file, rename_file};
pub use watcher::watch;

#[napi]
pub fn native_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
