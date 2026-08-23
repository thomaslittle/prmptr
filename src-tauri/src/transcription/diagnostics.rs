use std::sync::Arc;

use chrono::Utc;
use serde::Serialize;
use tauri::State;
use tokio::sync::Mutex;

use crate::speech::audio::metrics::AudioPipelineSnapshot;
use crate::speech::deepgram::DirectDeepgramStreamManager;
use crate::speech::moonshine_voice::{
    self, MoonshineVoiceArch, MoonshineVoiceModelStatus, MoonshineVoiceSupport,
};
use crate::speech::stream::SpeechStreamManager;

use super::capabilities::{get_speech_capabilities, SpeechCapabilities};
use super::speaker::{get_speech_detection_diagnostics, SpeechDetectionDiagnostics};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAudioDiagnostics {
    pub running: bool,
    pub pipeline: AudioPipelineSnapshot,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechDiagnosticBundle {
    pub schema_version: u32,
    pub generated_at: String,
    pub app_version: &'static str,
    pub capabilities: SpeechCapabilities,
    pub detection: SpeechDetectionDiagnostics,
    pub local_audio: RuntimeAudioDiagnostics,
    pub deepgram_audio: RuntimeAudioDiagnostics,
    pub moonshine_voice: MoonshineVoiceSupport,
    pub moonshine_default_model: Option<MoonshineVoiceModelStatus>,
    pub raw_audio_retained: bool,
    pub privacy_note: &'static str,
}

fn build_bundle(
    local_running: bool,
    local_pipeline: AudioPipelineSnapshot,
    deepgram_running: bool,
    deepgram_pipeline: AudioPipelineSnapshot,
    moonshine_default_model: Option<MoonshineVoiceModelStatus>,
) -> SpeechDiagnosticBundle {
    SpeechDiagnosticBundle {
        schema_version: 3,
        generated_at: Utc::now().to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION"),
        capabilities: get_speech_capabilities(),
        detection: get_speech_detection_diagnostics(),
        local_audio: RuntimeAudioDiagnostics {
            running: local_running,
            pipeline: local_pipeline,
        },
        deepgram_audio: RuntimeAudioDiagnostics {
            running: deepgram_running,
            pipeline: deepgram_pipeline,
        },
        moonshine_voice: moonshine_voice::support(),
        moonshine_default_model,
        raw_audio_retained: false,
        privacy_note: "This diagnostic bundle contains counters, capability metadata, and model-integrity status only; raw audio is not retained by this command.",
    }
}

#[tauri::command]
pub async fn get_speech_diagnostic_bundle(
    app: tauri::AppHandle,
    speech: State<'_, Arc<Mutex<SpeechStreamManager>>>,
    deepgram: State<'_, Arc<Mutex<DirectDeepgramStreamManager>>>,
) -> SpeechDiagnosticBundle {
    let speech = speech.lock().await;
    let deepgram = deepgram.lock().await;
    build_bundle(
        speech.is_running(),
        speech.audio_metrics(),
        deepgram.is_running(),
        deepgram.audio_metrics(),
        moonshine_voice::model_status(&app, MoonshineVoiceArch::default()).ok(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_bundle_remains_metadata_only_and_preserves_pipeline_evidence() {
        let bundle = build_bundle(
            true,
            AudioPipelineSnapshot::default(),
            false,
            AudioPipelineSnapshot::default(),
            None,
        );
        assert_eq!(bundle.schema_version, 3);
        assert!(bundle.local_audio.running);
        assert!(!bundle.deepgram_audio.running);
        assert!(!bundle.raw_audio_retained);
        assert!(!bundle.app_version.is_empty());
    }
}
