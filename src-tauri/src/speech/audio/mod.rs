pub mod capture;
pub mod conditioner;
pub mod metrics;
pub mod platform;

use serde::{Deserialize, Serialize};

pub const SPEECH_SAMPLE_RATE: u32 = 16_000;
pub const DEFAULT_AUDIO_QUEUE_CAPACITY: usize = 96;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioTrackId {
    Mic,
    System,
}

impl AudioTrackId {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mic => "mic",
            Self::System => "system",
        }
    }

    pub fn device_type(self) -> &'static str {
        match self {
            Self::Mic => "input",
            Self::System => "output",
        }
    }
}

#[derive(Debug, Clone)]
pub struct AudioChunk {
    pub track: AudioTrackId,
    pub start_sample: u64,
    pub samples: Vec<f32>,
}

impl AudioChunk {
    pub fn end_sample(&self) -> u64 {
        self.start_sample + self.samples.len() as u64
    }
}
