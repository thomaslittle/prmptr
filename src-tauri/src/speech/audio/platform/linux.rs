pub fn backend_name() -> &'static str {
    "pipewire-pulse-cpal"
}

pub fn supports_system_capture() -> bool {
    false
}

pub fn system_capture_detail() -> &'static str {
    "Microphone capture uses the active CPAL backend. PipeWire/Pulse monitor system-audio capture is not implemented yet."
}
