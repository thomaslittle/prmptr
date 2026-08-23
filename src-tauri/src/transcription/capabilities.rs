use serde::Serialize;

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
}

#[cfg(target_os = "windows")]
fn platform_capabilities() -> SpeechCapabilities {
    SpeechCapabilities {
        platform: "windows",
        microphone_capture: CaptureCapability {
            available: true,
            backend: "cpal/wasapi",
            status: "implemented",
            detail: "Microphone capture uses the native CPAL/WASAPI path.",
        },
        system_capture: CaptureCapability {
            available: true,
            backend: "wasapi-loopback",
            status: "implemented",
            detail: "System output is captured through the current WASAPI loopback path.",
        },
        diarization_available: true,
        local_engines: vec!["whisper", "moonshine-sherpa"],
    }
}

#[cfg(target_os = "macos")]
fn platform_capabilities() -> SpeechCapabilities {
    SpeechCapabilities {
        platform: "macos",
        microphone_capture: CaptureCapability {
            available: true,
            backend: "cpal/coreaudio",
            status: "implemented",
            detail: "Microphone capture uses CPAL/CoreAudio when permission is granted.",
        },
        system_capture: CaptureCapability {
            available: false,
            backend: "none",
            status: "not_implemented",
            detail: "System-output capture requires the planned ScreenCaptureKit/CoreAudio implementation and is not silently emulated.",
        },
        diarization_available: true,
        local_engines: vec!["whisper", "moonshine-sherpa"],
    }
}

#[cfg(target_os = "linux")]
fn platform_capabilities() -> SpeechCapabilities {
    SpeechCapabilities {
        platform: "linux",
        microphone_capture: CaptureCapability {
            available: true,
            backend: "cpal",
            status: "implemented",
            detail: "Microphone capture uses the current CPAL host backend.",
        },
        system_capture: CaptureCapability {
            available: false,
            backend: "none",
            status: "not_implemented",
            detail: "PipeWire/Pulse monitor capture is planned but not implemented; output capture is reported unavailable.",
        },
        diarization_available: true,
        local_engines: vec!["whisper", "moonshine-sherpa"],
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn platform_capabilities() -> SpeechCapabilities {
    SpeechCapabilities {
        platform: "unsupported",
        microphone_capture: CaptureCapability {
            available: false,
            backend: "none",
            status: "unsupported",
            detail: "Native speech capture is not implemented for this platform.",
        },
        system_capture: CaptureCapability {
            available: false,
            backend: "none",
            status: "unsupported",
            detail: "Native system-output capture is not implemented for this platform.",
        },
        diarization_available: false,
        local_engines: Vec::new(),
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
    fn capabilities_never_claim_unknown_system_capture() {
        let caps = platform_capabilities();
        if caps.system_capture.available {
            assert_eq!(caps.system_capture.status, "implemented");
            assert_ne!(caps.system_capture.backend, "none");
        } else {
            assert_ne!(caps.system_capture.status, "implemented");
        }
    }
}
