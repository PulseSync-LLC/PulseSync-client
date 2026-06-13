use napi_derive::napi;

#[napi]
pub fn native_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
