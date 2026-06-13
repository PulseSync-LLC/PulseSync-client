use napi::bindgen_prelude::{FnArgs, Function};
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi::{Result, Status};
use napi_derive::napi;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime};

type Snapshot = HashMap<PathBuf, SystemTime>;

fn is_watched_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("js") || extension.eq_ignore_ascii_case("css")
        })
}

fn visit_directory(path: &Path, snapshot: &mut Snapshot) {
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };

    for entry in entries.flatten() {
        let entry_path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            visit_directory(&entry_path, snapshot);
        } else if metadata.is_file() && is_watched_file(&entry_path) {
            if let Ok(modified) = metadata.modified() {
                snapshot.insert(entry_path, modified);
            }
        }
    }
}

fn snapshot_directory(root: &Path) -> Snapshot {
    let mut snapshot = Snapshot::new();
    visit_directory(root, &mut snapshot);
    snapshot
}

#[napi]
pub fn watch(
    path: String,
    interval_ms: u32,
    callback: Function<'_, FnArgs<(String, String)>, ()>,
) -> Result<()> {
    let callback = callback
        .build_threadsafe_function()
        .weak::<true>()
        .build()?;
    let root = PathBuf::from(path);
    let interval = Duration::from_millis(u64::from(interval_ms.max(50)));

    thread::spawn(move || {
        let mut previous = snapshot_directory(&root);
        loop {
            thread::sleep(interval);
            let current = snapshot_directory(&root);

            for (path, modified) in &current {
                let event = match previous.get(path) {
                    None => Some("add"),
                    Some(previous_modified) if previous_modified != modified => Some("change"),
                    _ => None,
                };
                if let Some(event) = event {
                    let status = callback.call(
                        FnArgs::from((event.to_owned(), path.to_string_lossy().into_owned())),
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );
                    if status == Status::Closing {
                        return;
                    }
                }
            }

            for path in previous.keys() {
                if !current.contains_key(path) {
                    let status = callback.call(
                        FnArgs::from(("unlink".to_owned(), path.to_string_lossy().into_owned())),
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );
                    if status == Status::Closing {
                        return;
                    }
                }
            }

            previous = current;
        }
    });

    Ok(())
}
