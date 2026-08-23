use chrono::Utc;
use serde::Serialize;

use super::capabilities::{get_speech_capabilities, SpeechCapabilities};
use super::speaker::{get_speech_detection_diagnostics, SpeechDetectionDiagnostics};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechDiagnosticBundle {
    pub schema_version: u32,
    pub generated_at: String,
    pub app_version: &'static str,
    pub capabilities: SpeechCapabilities,
    pub detection: SpeechDetectionDiagnostics,
    pub raw_audio_retained: bool,
    pub privacy_note: &'static str,
}

#[tauri::command]
pub fn get_speech_diagnostic_bundle() -> SpeechDiagnosticBundle {
    SpeechDiagnosticBundle {
        schema_version: 1,
        generated_at: Utc::now().to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION"),
        capabilities: get_speech_capabilities(),
        detection: get_speech_detection_diagnostics(),
        raw_audio_retained: false,
        privacy_note: "This diagnostic bundle contains counters and capability metadata only; raw audio is not retained by this command.",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_bundle_is_metadata_only_by_default() {
        let bundle = get_speech_diagnostic_bundle();
        assert_eq!(bundle.schema_version, 1);
        assert!(!bundle.raw_audio_retained);
        assert!(!bundle.app_version.is_empty());
    }
}
