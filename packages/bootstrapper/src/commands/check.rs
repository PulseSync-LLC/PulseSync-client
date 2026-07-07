use crate::{
    cli::args::{Args, required_arg},
    core::error::Result,
    domain::manifest::{decide_update, load_manifest},
};
use serde_json::{Value, to_value};

pub fn check_update(args: &Args) -> Result<Value> {
    let manifest_url = required_arg(args, "--manifest-url")?;
    let manifest = load_manifest(&manifest_url)?;
    let dist = required_arg(args, "--dist")?;
    let installed_version = required_arg(args, "--installed-version")?;
    let mut value = to_value(decide_update(&manifest, &installed_version, &dist))?;
    value["manifestUrl"] = Value::String(manifest_url);
    Ok(value)
}
