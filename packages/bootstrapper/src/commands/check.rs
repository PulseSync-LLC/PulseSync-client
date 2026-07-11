use crate::{
    cli::args::{Args, arg_value, required_arg},
    core::{error::Result, install_state::read_install_state},
    domain::manifest::{decide_component_update, decide_update, load_manifest},
};
use serde_json::{Value, to_value};

pub fn check_update(args: &Args) -> Result<Value> {
    let manifest_url = required_arg(args, "--manifest-url")?;
    let manifest = load_manifest(&manifest_url)?;
    let dist = required_arg(args, "--dist")?;
    let decision = if let Some(state_root) = arg_value(args, "--state-root") {
        decide_component_update(
            &manifest,
            &read_install_state(std::path::Path::new(&state_root))?,
            &dist,
        )
    } else {
        decide_update(
            &manifest,
            &required_arg(args, "--installed-version")?,
            &dist,
        )
    };
    let mut value = to_value(decision)?;
    value["manifestUrl"] = Value::String(manifest_url);
    Ok(value)
}
