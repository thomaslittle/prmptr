pub mod commands;
pub mod errors;
pub mod screenpipe;
pub mod session;
pub mod state;
pub mod transcription;

use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{Manager, Emitter};

use screenpipe::manager::ScreenpipeManager;
use transcription::transcript::TranscriptBuffer;
use transcription::whisper_stream::WhisperStreamManager;
use transcription::deepgram_stream::DirectDeepgramStreamManager;
use session::manager::SessionManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Expose MCP tooling only in dev/debug runs.
    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            let screenpipe = Arc::new(Mutex::new(ScreenpipeManager::new()));
            let transcript = Arc::new(Mutex::new(TranscriptBuffer::new(120)));
            let session = Arc::new(Mutex::new(SessionManager::new()));
            let whisper_stream = Arc::new(Mutex::new(WhisperStreamManager::new()));
            let direct_deepgram_stream = Arc::new(Mutex::new(DirectDeepgramStreamManager::new()));

            app.manage(screenpipe.clone());
            app.manage(transcript.clone());
            app.manage(session.clone());
            app.manage(whisper_stream.clone());
            app.manage(direct_deepgram_stream.clone());

            // Start health monitoring task
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
            commands::start_screenpipe,
            commands::stop_screenpipe,
            commands::get_screenpipe_status,
            commands::get_audio_devices,
            commands::update_screenpipe_config,
            commands::check_screenpipe_installed,
            commands::install_screenpipe,
            commands::start_session,
            commands::end_session,
            commands::get_session_config,
            commands::get_transcript,
            commands::clear_transcript,
            commands::validate_api_key,
            commands::fetch_lmstudio_models,
            commands::load_templates,
            commands::list_system_audio_devices,
            commands::list_whisper_models,
            commands::get_selected_whisper_model,
            commands::set_selected_whisper_model,
            commands::download_whisper_model,
            commands::is_moonshine_model_installed,
            commands::download_moonshine_model,
            commands::get_local_transcription_gpu_status,
            commands::open_external_url,
            commands::proxy_tts_synthesize,
            commands::proxy_tts_list_voices,
            commands::start_local_transcription,
            commands::stop_local_transcription,
            commands::set_local_mute,
            commands::get_local_activity,
            commands::start_direct_deepgram_transcription,
            commands::update_direct_deepgram_transcription,
            commands::stop_direct_deepgram_transcription,
            commands::set_deepgram_mute,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
