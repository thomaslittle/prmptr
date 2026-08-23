use std::sync::Once;
use std::time::Instant;

use crate::speech::audio::SPEECH_SAMPLE_RATE;
use crate::transcription::filter::transcript_is_acceptable;

use super::{EngineTranscript, SpeechEngine};

static WHISPER_LOG_SILENCE_ONCE: Once = Once::new();

unsafe extern "C" fn whisper_noop_log(
    _level: whisper_rs_sys::ggml_log_level,
    _text: *const std::os::raw::c_char,
    _user_data: *mut std::ffi::c_void,
) {
}

fn silence_whisper_internal_logs() {
    WHISPER_LOG_SILENCE_ONCE.call_once(|| unsafe {
        whisper_rs::set_log_callback(Some(whisper_noop_log), std::ptr::null_mut());
    });
}

fn cuda_backend_available() -> bool {
    unsafe {
        let ptr = whisper_rs_sys::whisper_print_system_info();
        if ptr.is_null() {
            return false;
        }
        let info = std::ffi::CStr::from_ptr(ptr).to_string_lossy().to_lowercase();
        info.split('|').any(|segment| segment.trim().starts_with("cuda"))
    }
}

pub struct WhisperEngine {
    context: whisper_rs::WhisperContext,
    model_id: String,
}

impl WhisperEngine {
    pub fn new(
        app: &tauri::AppHandle,
        requested_model_id: Option<&str>,
        prefer_gpu: bool,
    ) -> Result<Self, String> {
        silence_whisper_internal_logs();
        let model_path = crate::transcription::model_manager::resolve_model_path(app, requested_model_id)?;
        let model_id = requested_model_id
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| crate::transcription::model_manager::get_selected_whisper_model_id(app));
        let model_bytes = std::fs::read(&model_path)
            .map_err(|e| format!("Failed to read Whisper model '{}': {e}", model_path.display()))?;

        let force_gpu = std::env::var("PRMPTR_FORCE_GPU")
            .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
            .unwrap_or(false);
        let mut params = whisper_rs::WhisperContextParameters::default();
        if prefer_gpu || force_gpu {
            if cuda_backend_available() {
                params.use_gpu(true).flash_attn(true).gpu_device(0);
                log::info!("Whisper GPU inference enabled");
            } else {
                log::warn!("Whisper GPU requested but CUDA backend is unavailable; using CPU");
            }
        }

        let context = whisper_rs::WhisperContext::new_from_buffer_with_params(&model_bytes, params)
            .map_err(|e| format!("Failed to initialize Whisper model: {e}"))?;
        log::info!("Whisper speech engine ready: model={model_id}");
        Ok(Self { context, model_id })
    }
}

impl SpeechEngine for WhisperEngine {
    fn engine_id(&self) -> &'static str {
        "whisper"
    }

    fn model_id(&self) -> &str {
        &self.model_id
    }

    fn transcribe(&mut self, audio: &[f32], track_label: &str) -> Option<EngineTranscript> {
        if audio.is_empty() {
            return None;
        }
        let started = Instant::now();
        let mut state = match self.context.create_state() {
            Ok(state) => state,
            Err(error) => {
                log::error!("[{track_label}] failed to create Whisper state: {error}");
                return None;
            }
        };
        let mut params = whisper_rs::FullParams::new(
            whisper_rs::SamplingStrategy::Greedy { best_of: 1 },
        );
        params.set_language(Some("en"));
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_no_context(true);
        params.set_single_segment(true);

        if let Err(error) = state.full(params, audio) {
            log::error!("[{track_label}] Whisper inference failed: {error}");
            return None;
        }

        let mut text = String::new();
        for index in 0..state.full_n_segments() {
            let Some(segment) = state.get_segment(index) else {
                continue;
            };
            let Ok(value) = segment.to_str() else {
                continue;
            };
            let value = value.trim();
            if value.is_empty() {
                continue;
            }
            if !text.is_empty() {
                text.push(' ');
            }
            text.push_str(value);
        }
        let text = text.trim().to_string();
        if !transcript_is_acceptable(&text) {
            log::debug!("[{track_label}] Whisper transcript rejected by conservative filter");
            return None;
        }

        let latency_ms = started.elapsed().as_millis() as u64;
        log::debug!(
            "[{track_label}] Whisper {}Hz result latency={}ms text='{}'",
            SPEECH_SAMPLE_RATE,
            latency_ms,
            text.chars().take(80).collect::<String>()
        );
        Some(EngineTranscript { text, latency_ms })
    }
}
