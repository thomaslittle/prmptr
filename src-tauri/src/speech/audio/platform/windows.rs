pub fn backend_name() -> &'static str {
    "wasapi-cpal"
}

pub fn supports_system_capture() -> bool {
    true
}

pub fn system_capture_detail() -> &'static str {
    "System output uses WASAPI loopback through CPAL."
}
