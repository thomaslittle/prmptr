pub mod local_ai;
pub mod overlay;
pub mod screenshot;
pub mod audio_device;
pub mod commands;
pub mod errors;
pub mod session;
pub mod transcription;

use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::Manager;

use transcription::transcript::TranscriptBuffer;
use transcription::local_stream::LocalSttManager;
use transcription::deepgram_stream::DirectDeepgramStreamManager;
use session::manager::SessionManager;

/// Windows launches from Explorer have no `HOME`. OriginLM's OpenCode adapter
/// resolves the service descriptor from `HOME` (its discovery already falls
/// back to `USERPROFILE`), so give the process the same home those tools use.
#[cfg(windows)]
fn ensure_home() {
    if std::env::var_os("HOME").is_none() {
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            std::env::set_var("HOME", profile);
        }
    }
}

#[cfg(not(windows))]
fn ensure_home() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    ensure_home();

    let builder = tauri::Builder::default();

    // Expose MCP tooling only in dev/debug runs.
    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_mcp_bridge::init());

    builder
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let transcript = Arc::new(Mutex::new(TranscriptBuffer::new(120)));
            let session = Arc::new(Mutex::new(SessionManager::new()));
            let local_stt = Arc::new(Mutex::new(LocalSttManager::new()));
            let direct_deepgram_stream = Arc::new(Mutex::new(DirectDeepgramStreamManager::new()));

            app.manage(transcript.clone());
            app.manage(session.clone());
            app.manage(local_stt.clone());
            app.manage(direct_deepgram_stream.clone());
            app.manage(local_ai::LocalAi::default());
            app.manage(overlay::OverlayManager::default());

            let handle = app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                transcription::model_manager::cleanup_legacy_models(&handle)
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_session,
            commands::end_session,
            commands::get_session_config,
            commands::get_transcript,
            commands::clear_transcript,
            commands::validate_api_key,
            commands::fetch_lmstudio_models,
            commands::load_templates,
            commands::list_system_audio_devices,
            commands::list_stt_models,
            commands::get_selected_stt_model,
            commands::set_selected_stt_model,
            commands::download_stt_model,
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
            local_ai::local_ai_models,
            local_ai::local_ai_complete,
            local_ai::local_ai_cancel,
            screenshot::capture_screenshot,
            overlay::set_overlay_enabled,
            overlay::apply_overlay_config,
            overlay::toggle_overlay_visibility,
            overlay::hide_overlay,
            overlay::center_overlay,
            overlay::set_overlay_click_through,
            overlay::publish_overlay_content,
            overlay::get_overlay_state,
        ])
        .on_window_event(|window, event| {
            overlay::handle_window_event(window.app_handle(), window.label(), event)
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Stop any AI client process OriginLM started for us.
                local_ai::shutdown(&app.state::<local_ai::LocalAi>());
                // Release audio devices promptly.
                if let Ok(mut stt) = app
                    .state::<Arc<Mutex<LocalSttManager>>>()
                    .try_lock()
                {
                    stt.stop();
                }
            }
        });
}
