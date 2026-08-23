mod moonshine_legacy;
mod whisper;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum LocalSpeechEngine {
    #[default]
    Whisper,
    MoonshineSherpa,
    MoonshineVoice,
}

impl LocalSpeechEngine {
    pub fn id(self) -> &'static str {
        match self {
            Self::Whisper => "whisper",
            Self::MoonshineSherpa => "moonshine-sherpa",
            Self::MoonshineVoice => "moonshine-voice",
        }
    }

    pub fn is_streaming(self) -> bool {
        matches!(self, Self::MoonshineVoice)
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
        LocalSpeechEngine::MoonshineSherpa => {
            Ok(Box::new(moonshine_legacy::MoonshineLegacyEngine::new(app)?))
        }
        LocalSpeechEngine::MoonshineVoice => Err(
            "Moonshine Voice is a native streaming engine and cannot run through the batch SpeechEngine path"
                .to_string(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn engine_ids_are_backend_neutral_and_explicit() {
        assert_eq!(LocalSpeechEngine::Whisper.id(), "whisper");
        assert_eq!(LocalSpeechEngine::MoonshineSherpa.id(), "moonshine-sherpa");
        assert_eq!(LocalSpeechEngine::MoonshineVoice.id(), "moonshine-voice");
        assert!(LocalSpeechEngine::MoonshineVoice.is_streaming());
        assert_eq!(serde_json::to_string(&LocalSpeechEngine::MoonshineVoice).unwrap(), "\"moonshine-voice\"");
    }
}
