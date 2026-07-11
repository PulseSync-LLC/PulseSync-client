fn main() {
    println!("cargo:rerun-if-changed=../../icons/icon.ico");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    embed_windows_resources();
}

#[cfg(windows)]
fn embed_windows_resources() {
    let mut resource = winresource::WindowsResource::new();
    resource.set_icon("../../icons/icon.ico");
    resource.set("ProductName", "PulseSync");
    resource.set("FileDescription", "PulseSync Bootstrapper");
    resource.set("CompanyName", "PulseSync");
    resource.set("LegalCopyright", "PulseSync");
    resource
        .compile()
        .expect("failed to embed PulseSync bootstrapper Windows resources");
}

#[cfg(not(windows))]
fn embed_windows_resources() {}
