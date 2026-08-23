//! Compatibility bridge for older command names.
//!
//! The shipping implementation lives under `crate::speech`; this module keeps
//! the existing Tauri command surface source-compatible while the frontend IPC
//! migrates from Whisper-specific naming to the neutral speech API.

use serde::{Deserialize, Serialize};

pub use crate::speech::stream::SpeechStreamManager as WhisperStreamManager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalWhisperConfig {
    pub input_device_name: Option<String>,
    pub output_device_name: Option<String>,
    pub whisper_model_id: Option<String>,
    pub prefer_gpu: bool,
    #[serde(default)]
    pub use_moonshine: bool,
    #[serde(default)]
    pub mute_input: bool,
    #[serde(default)]
    pub mute_output: bool,
    pub inference_interval_ms: u64,
}

impl Default for LocalWhisperConfig {
    fn default() -> Self {
        Self {
            input_device_name: None,
            output_device_name: None,
            whisper_model_id: None,
            prefer_gpu: false,
            use_moonshine: false,
            mute_input: false,
            mute_output: false,
            inference_interval_ms: 300,
        }
    }
}

impl From<LocalWhisperConfig> for crate::speech::stream::LocalSpeechConfig {
    fn from(value: LocalWhisperConfig) -> Self {
        Self {
            input_device_name: value.input_device_name,
            output_device_name: value.output_device_name,
            whisper_model_id: value.whisper_model_id,
            prefer_gpu: value.prefer_gpu,
            engine: if value.use_moonshine {
                crate::speech::engines::LocalSpeechEngine::MoonshineSherpa
            } else {
                crate::speech::engines::LocalSpeechEngine::Whisper
            },
            mute_input: value.mute_input,
            mute_output: value.mute_output,
            ..Default::default()
        }
    }
}
