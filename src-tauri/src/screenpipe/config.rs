use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ScreenpipeConfig {
    pub binary_path: Option<String>,
    pub port: u16,
    pub audio_device: Option<String>,
    pub output_device: Option<String>,
    pub realtime_audio_device: Option<String>,
    pub enable_realtime: bool,
    pub transcription_engine: TranscriptionEngine,
    pub deepgram_api_key: Option<String>,
    pub vad_sensitivity: VadSensitivity,
    pub disable_vision: bool,
    pub audio_chunk_duration: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TranscriptionEngine {
    WhisperTiny,
    WhisperLargeV3TurboQuantized,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VadSensitivity {
    Low,
    Medium,
    High,
}

impl Default for ScreenpipeConfig {
    fn default() -> Self {
        Self {
            binary_path: None,
            port: 3030,
            audio_device: None,
            output_device: None,
            realtime_audio_device: None,
            enable_realtime: false,
            transcription_engine: TranscriptionEngine::WhisperLargeV3TurboQuantized,
            deepgram_api_key: None,
            vad_sensitivity: VadSensitivity::High,
            disable_vision: true,
            audio_chunk_duration: 5,
        }
    }
}

impl ScreenpipeConfig {
    pub fn base_url(&self) -> String {
        format!("http://localhost:{}", self.port)
    }

    pub fn ws_url(&self) -> String {
        format!("ws://localhost:{}/ws/events?images=false", self.port)
    }

    pub fn to_args(&self) -> Vec<String> {
        let mut args = Vec::new();

        if let Some(ref device) = self.audio_device {
            args.push("--audio-device".to_string());
            args.push(device.clone());
        }

        if let Some(ref device) = self.output_device {
            args.push("--audio-device".to_string());
            args.push(device.clone());
        }

        if self.enable_realtime {
            args.push("--enable-realtime-audio-transcription".to_string());

            if let Some(device) = self.realtime_audio_device.as_ref().or(self.audio_device.as_ref()) {
                args.push("--realtime-audio-device".to_string());
                args.push(device.to_string());
            }
        }

        args.push("--audio-transcription-engine".to_string());
        args.push(match self.transcription_engine {
            TranscriptionEngine::WhisperTiny => "whisper-tiny".to_string(),
            TranscriptionEngine::WhisperLargeV3TurboQuantized => {
                "whisper-large-v3-turbo-quantized".to_string()
            }
        });

        if let Some(ref key) = self.deepgram_api_key {
            args.push("--deepgram-api-key".to_string());
            args.push(key.clone());
        }

        args.push("--vad-sensitivity".to_string());
        args.push(match self.vad_sensitivity {
            VadSensitivity::Low => "low".to_string(),
            VadSensitivity::Medium => "medium".to_string(),
            VadSensitivity::High => "high".to_string(),
        });

        if self.disable_vision {
            args.push("--disable-vision".to_string());
        }

        args.push("--audio-chunk-duration".to_string());
        args.push(self.audio_chunk_duration.to_string());

        args
    }
}
