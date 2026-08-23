use cpal::traits::HostTrait;

pub fn backend_name() -> &'static str {
    "wasapi-cpal"
}

pub fn supports_system_capture() -> bool {
    true
}

pub fn system_capture_detail() -> &'static str {
    "System output uses WASAPI loopback through CPAL."
}

pub fn resolve_system_device(host: &cpal::Host, requested: Option<&str>) -> Option<cpal::Device> {
    if let Some(name) = requested {
        if let Ok(mut devices) = host.output_devices() {
            if let Some(device) = devices.find(|device| super::device_matches(device, name)) {
                return Some(device);
            }
        }
    }
    host.default_output_device()
}

pub fn system_capture_uses_input_config() -> bool {
    false
}
