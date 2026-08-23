use std::time::Instant;

use crate::speech::audio::SPEECH_SAMPLE_RATE;
use crate::transcription::filter::transcript_is_acceptable;

use super::{EngineTranscript, SpeechEngine};

pub struct MoonshineLegacyEngine {
    recognizer: sherpa_rs::moonshine::MoonshineRecognizer,
    model_id: String,
}

#[cfg(windows)]
fn prepare_onnxruntime_debug_crt() {
    extern "system" {
        fn LoadLibraryA(name: *const u8) -> isize;
        fn GetProcAddress(module: isize, name: *const u8) -> *const ();
    }

    unsafe {
        let _ = LoadLibraryA(b"onnxruntime.dll\0".as_ptr());
        type SetModeFn = unsafe extern "C" fn(i32, i32) -> i32;
        for dll in [
            b"ucrtbased.dll\0" as &[u8],
            b"msvcr120d.dll\0",
            b"msvcr140d.dll\0",
            b"ucrtbase.dll\0",
        ] {
            let module = LoadLibraryA(dll.as_ptr());
            if module == 0 {
                continue;
            }
            let proc = GetProcAddress(module, b"_CrtSetReportMode\0".as_ptr());
            if proc.is_null() {
                continue;
            }
            let set_mode: SetModeFn = std::mem::transmute(proc);
            set_mode(0, 2);
            set_mode(1, 2);
            set_mode(2, 2);
        }
    }
}

#[cfg(not(windows))]
fn prepare_onnxruntime_debug_crt() {}

impl MoonshineLegacyEngine {
    pub fn new(app: &tauri::AppHandle) -> Result<Self, String> {
        prepare_onnxruntime_debug_crt();
        let model_dir = crate::transcription::model_manager::resolve_moonshine_model_dir(app)?;
        let config = sherpa_rs::moonshine::MoonshineConfig {
            preprocessor: model_dir.join("preprocess.onnx").to_string_lossy().to_string(),
            encoder: model_dir.join("encode.int8.onnx").to_string_lossy().to_string(),
            uncached_decoder: model_dir
                .join("uncached_decode.int8.onnx")
                .to_string_lossy()
                .to_string(),
            cached_decoder: model_dir
                .join("cached_decode.int8.onnx")
                .to_string_lossy()
                .to_string(),
            tokens: model_dir.join("tokens.txt").to_string_lossy().to_string(),
            num_threads: Some(2),
            ..Default::default()
        };
        let recognizer = sherpa_rs::moonshine::MoonshineRecognizer::new(config)
            .map_err(|e| format!("Failed to initialize legacy Moonshine/sherpa engine: {e}"))?;
        log::info!("Legacy Moonshine/sherpa speech engine ready: {}", model_dir.display());
        Ok(Self {
            recognizer,
            model_id: "base-en-int8-sherpa".to_string(),
        })
    }
}

impl SpeechEngine for MoonshineLegacyEngine {
    fn engine_id(&self) -> &'static str {
        "moonshine-sherpa"
    }

    fn model_id(&self) -> &str {
        &self.model_id
    }

    fn transcribe(&mut self, audio: &[f32], track_label: &str) -> Option<EngineTranscript> {
        if audio.is_empty() {
            return None;
        }
        let started = Instant::now();
        let result = self.recognizer.transcribe(SPEECH_SAMPLE_RATE, audio);
        let text = result.text.trim().to_string();
        if !transcript_is_acceptable(&text) {
            log::debug!("[{track_label}] Moonshine transcript rejected by conservative filter");
            return None;
        }
        let latency_ms = started.elapsed().as_millis() as u64;
        log::debug!(
            "[{track_label}] Moonshine/sherpa result latency={}ms text='{}'",
            latency_ms,
            text.chars().take(80).collect::<String>()
        );
        Some(EngineTranscript { text, latency_ms })
    }
}
