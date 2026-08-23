pub fn backend_name() -> &'static str {
    "coreaudio-cpal"
}

pub fn supports_system_capture() -> bool {
    false
}

pub fn system_capture_detail() -> &'static str {
    "Microphone capture uses CoreAudio/CPAL. Native ScreenCaptureKit system-audio capture is not implemented yet."
}
