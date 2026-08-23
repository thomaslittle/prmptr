use super::AudioTrackId;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::*;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::*;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::*;

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn backend_name() -> &'static str {
    "unsupported"
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn supports_system_capture() -> bool {
    false
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
pub fn system_capture_detail() -> &'static str {
    "System capture is not implemented for this operating system."
}

pub fn validate_track(track: AudioTrackId) -> Result<(), String> {
    if track == AudioTrackId::System && !supports_system_capture() {
        return Err(system_capture_detail().to_string());
    }
    Ok(())
}
