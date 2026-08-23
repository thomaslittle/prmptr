use serde::Serialize;

use crate::speech::audio::{platform, SPEECH_SAMPLE_RATE};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureCapability {
    pub available: bool,
    pub backend: &'static str,
    pub status: &'static str,
    pub detail: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechCapabilities {
    pub platform: &'static str,
    pub microphone_capture: CaptureCapability,
    pub system_capture: CaptureCapability,
    pub diarization_available: bool,
    pub local_engines: Vec<&'static str>,
    pub canonical_transcript_event: bool,
    pub bounded_audio_queue: bool,
    pub conditioned_sample_rate_hz: u32,
}

#[cfg(target_os = "windows")]
fn platform_name() -> &'static str { "windows" }
#[cfg(target_os = "windows")]
fn microphone_backend() -> &'static str { "wasapi-cpal" }
#[cfg(target_os = "windows")]
fn microphone_detail() -> &'static str { "Microphone capture uses the native CPAL/WASAPI path." }

#[cfg(target_os = "macos")]
fn platform_name() -> &'static str { "macos" }
#[cfg(target_os = "macos")]
fn microphone_backend() -> &'static str { "coreaudio-cpal" }
#[cfg(target_os = "macos")]
fn microphone_detail() -> &'static str { "Microphone capture uses CPAL/CoreAudio when permission is granted." }

#[cfg(target_os = "linux")]
fn platform_name() -> &'static str { "linux" }
#[cfg(target_os = "linux")]
fn microphone_backend() -> &'static str { "cpal-pipewire-pulse" }
#[cfg(target_os = "linux")]
fn microphone_detail() -> &'static str { "Microphone capture uses CPAL through the active PipeWire/PulseAudio backend." }

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn platform_name() -> &'static str { "unsupported" }
#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn microphone_backend() -> &'static str { "none" }
#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn microphone_detail() -> &'static str { "Native speech capture is not implemented for this platform." }

fn platform_capabilities() -> SpeechCapabilities {
    let supported_platform = matches!(platform_name(), "windows" | "macos" | "linux");
    let system_available = platform::supports_system_capture();
    SpeechCapabilities {
        platform: platform_name(),
        microphone_capture: CaptureCapability {
            available: supported_platform,
            backend: microphone_backend(),
            status: if supported_platform { "implemented" } else { "unsupported" },
            detail: microphone_detail(),
        },
        system_capture: CaptureCapability {
            available: system_available,
            backend: if system_available { platform::backend_name() } else { "none" },
            status: if system_available {
                "implemented"
            } else if supported_platform {
                "not_implemented"
            } else {
                "unsupported"
            },
            detail: platform::system_capture_detail(),
        },
        diarization_available: supported_platform,
        local_engines: if supported_platform {
            vec!["whisper", "moonshine-sherpa"]
        } else {
            Vec::new()
        },
        canonical_transcript_event: true,
        bounded_audio_queue: true,
        conditioned_sample_rate_hz: SPEECH_SAMPLE_RATE,
    }
}

#[tauri::command]
pub fn get_speech_capabilities() -> SpeechCapabilities {
    platform_capabilities()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_never_claim_an_unavailable_system_backend_is_implemented() {
        let caps = platform_capabilities();
        if caps.system_capture.available {
            assert_eq!(caps.system_capture.status, "implemented");
            assert_ne!(caps.system_capture.backend, "none");
        } else {
            assert_ne!(caps.system_capture.status, "implemented");
        }
    }

    #[test]
    fn canonical_contract_reports_the_conditioned_rate() {
        let caps = platform_capabilities();
        assert!(caps.canonical_transcript_event);
        assert!(caps.bounded_audio_queue);
        assert_eq!(caps.conditioned_sample_rate_hz, 16_000);
    }
}
