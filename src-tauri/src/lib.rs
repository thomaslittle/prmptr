pub mod commands;
pub mod errors;
pub mod overlay;
pub mod screenpipe;
pub mod session;
pub mod speech;
pub mod state;
pub mod transcription;

use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{Emitter, Manager};

use overlay::OverlayManager;
use screenpipe::manager::ScreenpipeManager;
use session::manager::SessionManager;
use speech::deepgram::DirectDeepgramStreamManager;
use speech::stream::SpeechStreamManager;
use transcription::transcript::TranscriptBuffer;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }
    builder
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .on_window_event(|window, event| {
            overlay::handle_window_event(window.app_handle(), window.label(), event);
        })
        .setup(|app| {
            let screenpipe = Arc::new(Mutex::new(ScreenpipeManager::new()));
            let transcript = Arc::new(Mutex::new(TranscriptBuffer::new(120)));
            let session = Arc::new(Mutex::new(SessionManager::new()));
            let speech_stream = Arc::new(Mutex::new(SpeechStreamManager::new()));
            let direct_deepgram_stream = Arc::new(Mutex::new(DirectDeepgramStreamManager::new()));
            app.manage(screenpipe.clone());
            app.manage(transcript.clone());
            app.manage(session.clone());
            app.manage(speech_stream.clone());
            app.manage(direct_deepgram_stream.clone());
            app.manage(OverlayManager::default());
            let screenpipe_clone = screenpipe.clone();
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
                    let mut mgr = screenpipe_clone.lock().await;
                    let status = mgr.check_health().await;
                    let _ = app_handle.emit("screenpipe-status", &status);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_screenpipe, commands::stop_screenpipe, commands::get_screenpipe_status,
            commands::get_audio_devices, commands::update_screenpipe_config, commands::check_screenpipe_installed,
            commands::install_screenpipe, commands::start_session, commands::end_session,
            commands::get_session_config, commands::get_transcript, commands::clear_transcript,
            commands::validate_api_key, commands::fetch_lmstudio_models, commands::load_templates,
            commands::list_system_audio_devices, commands::list_whisper_models,
            commands::get_selected_whisper_model, commands::set_selected_whisper_model,
            commands::download_whisper_model,
            speech::commands::is_moonshine_model_installed, speech::commands::download_moonshine_model,
            commands::get_local_transcription_gpu_status,
            commands::open_external_url, commands::proxy_tts_synthesize, commands::proxy_tts_list_voices,
            commands::start_local_transcription, commands::stop_local_transcription, commands::set_local_mute,
            commands::get_local_activity, commands::start_direct_deepgram_transcription,
            commands::update_direct_deepgram_transcription, commands::stop_direct_deepgram_transcription,
            commands::set_deepgram_mute,
            overlay::set_overlay_enabled, overlay::apply_overlay_config,
            overlay::toggle_overlay_visibility, overlay::hide_overlay, overlay::center_overlay,
            overlay::set_overlay_click_through, overlay::publish_overlay_content,
            overlay::get_overlay_state,
            speech::commands::start_speech_transcription, speech::commands::stop_speech_transcription,
            speech::commands::set_speech_mute, speech::commands::set_speech_context,
            speech::commands::set_speech_keyterms, speech::commands::set_speech_diarization_enabled,
            speech::commands::start_speech_context_sidecar, speech::commands::stop_speech_context_sidecar,
            speech::commands::get_speech_context_sidecar_status, speech::commands::get_speech_activity,
            speech::commands::get_moonshine_voice_support,
            speech::commands::get_moonshine_quality_profiles,
            speech::commands::resolve_moonshine_quality_profile,
            speech::commands::get_moonshine_voice_model_status,
            speech::commands::verify_moonshine_voice_model,
            speech::commands::install_moonshine_voice_model,
            speech::commands::install_moonshine_quality_profile,
            speech::moonshine_model_commands::list_moonshine_voice_models,
            speech::moonshine_model_commands::delete_moonshine_voice_model,
            speech::moonshine_model_commands::prune_moonshine_voice_models,
            transcription::speaker::get_speaker_diarization_enabled,
            transcription::capabilities::get_speech_capabilities,
            transcription::diagnostics::get_speech_diagnostic_bundle,
            speech::diagnostics::get_audio_pipeline_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
