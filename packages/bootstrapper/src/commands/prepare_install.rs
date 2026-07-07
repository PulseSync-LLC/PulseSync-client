use crate::{
    cli::args::{Args, arg_value, required_arg},
    core::error::Result,
    domain::transactions::prepare_transaction_file,
};
use serde_json::Value;
use std::path::PathBuf;

pub fn prepare_install(args: &Args) -> Result<Value> {
    let plan_file = PathBuf::from(required_arg(args, "--plan-file")?);
    let transaction_dir = arg_value(args, "--transaction-dir").map(PathBuf::from);
    prepare_transaction_file(&plan_file, transaction_dir)
}
