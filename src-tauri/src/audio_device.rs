//! cpal 0.18 replaced `Device::name()` with a structured description.
use cpal::traits::DeviceTrait;

/// Human-readable device name (the same friendly name older builds saved in
/// settings, e.g. "Microphone (Realtek Audio)").
pub fn device_name(device: &cpal::Device) -> Option<String> {
    device.description().ok().map(|d| d.name().to_owned())
}
