use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use tokio::sync::Mutex;

use crate::speech::audio::metrics::AudioPipelineSnapshot;
use crate::speech::stream::SpeechStreamManager;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechAudioDiagnostics {
    pub backend: String,
    pub system_capture_supported: bool,
    pub system_capture_detail: String,
    pub pipeline: AudioPipelineSnapshot,
}

#[tauri::command]
pub async fn get_audio_pipeline_diagnostics(
    speech: State<'_, Arc<Mutex<SpeechStreamManager>>>,
) -> Result<SpeechAudioDiagnostics, String> {
    let manager = speech.lock().await;
    Ok(SpeechAudioDiagnostics {
        backend: crate::speech::audio::platform::backend_name().to_string(),
        system_capture_supported: crate::speech::audio::platform::supports_system_capture(),
        system_capture_detail: crate::speech::audio::platform::system_capture_detail().to_string(),
        pipeline: manager.audio_metrics(),
    })
}
