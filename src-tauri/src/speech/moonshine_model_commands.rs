use std::sync::Arc;

use tauri::State;
use tokio::sync::Mutex;

use crate::speech::moonshine_models::MoonshineModelCatalogEntry;
use crate::speech::moonshine_voice::{MoonshineVoiceArch, MoonshineVoiceModelStatus};
use crate::speech::stream::SpeechStreamManager;

#[tauri::command]
pub fn list_moonshine_voice_models(
    app: tauri::AppHandle,
) -> Result<Vec<MoonshineModelCatalogEntry>, String> {
    crate::speech::moonshine_models::catalog(&app)
}

#[tauri::command]
pub async fn delete_moonshine_voice_model(
    app: tauri::AppHandle,
    speech: State<'_, Arc<Mutex<SpeechStreamManager>>>,
    arch: MoonshineVoiceArch,
) -> Result<MoonshineVoiceModelStatus, String> {
    if speech.lock().await.is_running() {
        return Err("Stop local speech transcription before deleting a Moonshine model.".to_string());
    }
    crate::speech::moonshine_models::delete_model(&app, arch)
}

#[tauri::command]
pub async fn prune_moonshine_voice_models(
    app: tauri::AppHandle,
    speech: State<'_, Arc<Mutex<SpeechStreamManager>>>,
    keep: MoonshineVoiceArch,
) -> Result<Vec<MoonshineModelCatalogEntry>, String> {
    if speech.lock().await.is_running() {
        return Err("Stop local speech transcription before pruning Moonshine models.".to_string());
    }
    crate::speech::moonshine_models::prune_except(&app, keep)
}
