mod moonshine_legacy;
mod whisper;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum LocalSpeechEngine {
    #[default]
    Whisper,
    MoonshineLegacy,
}

impl LocalSpeechEngine {
    pub fn id(self) -> &'static str {
        match self {
            Self::Whisper => "whisper",
            Self::MoonshineLegacy => "moonshine-sherpa",
        }
    }
}

#[derive(Debug, Clone)]
pub struct EngineTranscript {
    pub text: String,
    pub latency_ms: u64,
}

pub trait SpeechEngine: Send {
    fn engine_id(&self) -> &'static str;
    fn model_id(&self) -> &str;
    fn transcribe(&mut self, audio: &[f32], track_label: &str) -> Option<EngineTranscript>;
}

pub fn build_engine(
    app: &tauri::AppHandle,
    engine: LocalSpeechEngine,
    whisper_model_id: Option<&str>,
    prefer_gpu: bool,
) -> Result<Box<dyn SpeechEngine>, String> {
    match engine {
        LocalSpeechEngine::Whisper => Ok(Box::new(whisper::WhisperEngine::new(
            app,
            whisper_model_id,
            prefer_gpu,
        )?)),
        LocalSpeechEngine::MoonshineLegacy => {
            Ok(Box::new(moonshine_legacy::MoonshineLegacyEngine::new(app)?))
        }
    }
}
