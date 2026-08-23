use chrono::Utc;
use serde::Serialize;

use super::capabilities::{get_speech_capabilities, SpeechCapabilities};
use super::speaker::{get_speech_detection_diagnostics, SpeechDetectionDiagnostics};
use crate::speech::moonshine_voice::{
    self, MoonshineVoiceArch, MoonshineVoiceModelStatus, MoonshineVoiceSupport,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechDiagnosticBundle {
    pub schema_version: u32,
    pub generated_at: String,
    pub app_version: &'static str,
    pub capabilities: SpeechCapabilities,
    pub detection: SpeechDetectionDiagnostics,
    pub moonshine_voice: MoonshineVoiceSupport,
    pub moonshine_default_model: Option<MoonshineVoiceModelStatus>,
    pub raw_audio_retained: bool,
    pub privacy_note: &'static str,
}

#[tauri::command]
pub fn get_speech_diagnostic_bundle(app: tauri::AppHandle) -> SpeechDiagnosticBundle {
    SpeechDiagnosticBundle {
        schema_version: 2,
        generated_at: Utc::now().to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION"),
        capabilities: get_speech_capabilities(),
        detection: get_speech_detection_diagnostics(),
        moonshine_voice: moonshine_voice::support(),
        moonshine_default_model: moonshine_voice::model_status(&app, MoonshineVoiceArch::default()).ok(),
        raw_audio_retained: false,
        privacy_note: "This diagnostic bundle contains counters, capability metadata, and model-integrity status only; raw audio is not retained by this command.",
    }
}
