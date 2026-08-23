use std::sync::Arc;

use serde::Serialize;
use tauri::State;
use tokio::sync::Mutex;

use crate::speech::moonshine_quality::{
    self, MoonshineQualityOption, MoonshineQualityProfile, MoonshineQualityResolution,
};
use crate::speech::moonshine_voice::{
    self, MoonshineVoiceArch, MoonshineVoiceModelStatus, MoonshineVoiceSupport,
};
use crate::speech::stream::{LocalSpeechConfig, SpeechStreamManager};
use crate::transcription::transcript::TranscriptBuffer;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechActivity {
    pub running: bool,
    pub input_level: f32,
    pub output_level: f32,
    pub input_muted: bool,
    pub output_muted: bool,
}

#[tauri::command]
pub async fn start_speech_transcription(
    app: tauri::AppHandle,
    speech: State<'_, Arc<Mutex<SpeechStreamManager>>>,
    transcript: State<'_, Arc<Mutex<TranscriptBuffer>>>,
    config: LocalSpeechConfig,
) -> Result<(), String> {
    let mut manager = speech.lock().await;
    manager.start(app, config, transcript.inner().clone())
}

#[tauri::command]
pub async fn stop_speech_transcription(
    speech: State<'_, Arc<Mutex<SpeechStreamManager>>>,
) -> Result<(), String> {
    let mut manager = speech.lock().await;
    manager.stop();
    Ok(())
}

#[tauri::command]
pub async fn set_speech_mute(
    speech: State<'_, Arc<Mutex<SpeechStreamManager>>>,
    channel: String,
    muted: bool,
) -> Result<(), String> {
    if channel != "input" && channel != "output" {
        return Err("Speech channel must be 'input' or 'output'".to_string());
    }
    let manager = speech.lock().await;
    manager.set_mute(&channel, muted);
    Ok(())
}

#[tauri::command]
pub async fn set_speech_context(
    speech: State<'_, Arc<Mutex<SpeechStreamManager>>>,
    text: String,
    max_terms: Option<u32>,
) -> Result<(), String> {
    let manager = speech.lock().await;
    manager.set_context(text, max_terms.unwrap_or(200))
}

#[tauri::command]
pub async fn set_speech_keyterms(
    speech: State<'_, Arc<Mutex<SpeechStreamManager>>>,
    keyterms: Vec<String>,
) -> Result<(), String> {
    let manager = speech.lock().await;
    manager.set_keyterms(keyterms)
}

#[tauri::command]
pub async fn get_speech_activity(
    speech: State<'_, Arc<Mutex<SpeechStreamManager>>>,
) -> Result<SpeechActivity, String> {
    let manager = speech.lock().await;
    Ok(SpeechActivity {
        running: manager.is_running(),
        input_level: manager.input_level(),
        output_level: manager.output_level(),
        input_muted: manager.input_muted(),
        output_muted: manager.output_muted(),
    })
}

#[tauri::command]
pub fn get_moonshine_voice_support() -> MoonshineVoiceSupport {
    moonshine_voice::support()
}

#[tauri::command]
pub fn get_moonshine_quality_profiles() -> Vec<MoonshineQualityOption> {
    moonshine_quality::options()
}

#[tauri::command]
pub fn resolve_moonshine_quality_profile(
    profile: MoonshineQualityProfile,
) -> MoonshineQualityResolution {
    moonshine_quality::resolve(profile)
}

#[tauri::command]
pub fn get_moonshine_voice_model_status(
    app: tauri::AppHandle,
    arch: MoonshineVoiceArch,
) -> Result<MoonshineVoiceModelStatus, String> {
    moonshine_voice::model_status(&app, arch)
}

#[tauri::command]
pub fn verify_moonshine_voice_model(
    app: tauri::AppHandle,
    arch: MoonshineVoiceArch,
) -> Result<MoonshineVoiceModelStatus, String> {
    crate::speech::moonshine_verify::verify_model(&app, arch)
}

#[tauri::command]
pub async fn install_moonshine_voice_model(
    app: tauri::AppHandle,
    arch: MoonshineVoiceArch,
) -> Result<MoonshineVoiceModelStatus, String> {
    moonshine_voice::install_model(&app, arch).await
}

#[tauri::command]
pub async fn install_moonshine_quality_profile(
    app: tauri::AppHandle,
    profile: MoonshineQualityProfile,
) -> Result<MoonshineVoiceModelStatus, String> {
    let resolved = moonshine_quality::resolve(profile);
    moonshine_voice::install_model(&app, resolved.arch).await
}

#[tauri::command]
pub fn is_moonshine_model_installed(app: tauri::AppHandle) -> Result<bool, String> {
    if cfg!(feature = "moonshine-voice") {
        let resolved = moonshine_quality::resolve(MoonshineQualityProfile::Auto);
        return Ok(moonshine_voice::model_status(&app, resolved.arch)?.installed);
    }
    Ok(crate::transcription::model_manager::is_moonshine_installed(&app))
}

#[tauri::command]
pub async fn download_moonshine_model(app: tauri::AppHandle) -> Result<(), String> {
    if cfg!(feature = "moonshine-voice") {
        let resolved = moonshine_quality::resolve(MoonshineQualityProfile::Auto);
        moonshine_voice::install_model(&app, resolved.arch).await?;
        return Ok(());
    }
    crate::commands::download_moonshine_model(app).await
}
