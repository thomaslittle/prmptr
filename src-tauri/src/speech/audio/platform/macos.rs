pub fn backend_name() -> &'static str {
    "coreaudio-cpal"
}

pub fn supports_system_capture() -> bool {
    false
}

pub fn system_capture_detail() -> &'static str {
    "Microphone capture uses CoreAudio/CPAL. Native ScreenCaptureKit system-audio capture is the remaining macOS capture gap."
}

pub fn resolve_system_device(_host: &cpal::Host, _requested: Option<&str>) -> Option<cpal::Device> {
    None
}

pub fn system_capture_uses_input_config() -> bool {
    false
}
