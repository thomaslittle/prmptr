use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Instant;

use serde::Serialize;
use sherpa_rs::embedding_manager::EmbeddingManager;
use sherpa_rs::silero_vad::{SileroVad, SileroVadConfig, SpeechSegment};
use sherpa_rs::speaker_id::{EmbeddingExtractor, ExtractorConfig, DEFAULT_SIMILARITY_THRESHOLD};

/// Diarization is intentionally on by default. The flag is process-wide so a
/// preference change can take effect on already-running local transcription
/// streams without tearing down audio capture or STT inference.
static SPEAKER_DIARIZATION_ENABLED: AtomicBool = AtomicBool::new(true);

static VAD_SAMPLES_ACCEPTED: AtomicU64 = AtomicU64::new(0);
static VAD_SEGMENTS_POPPED: AtomicU64 = AtomicU64::new(0);
static DIARIZATION_CALLS: AtomicU64 = AtomicU64::new(0);
static DIARIZATION_SKIPPED_DISABLED: AtomicU64 = AtomicU64::new(0);
static DIARIZATION_FAILURES: AtomicU64 = AtomicU64::new(0);
static DIARIZATION_TOTAL_MICROS: AtomicU64 = AtomicU64::new(0);
static DIARIZATION_NEW_SPEAKERS: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechDetectionDiagnostics {
    pub diarization_enabled: bool,
    pub vad_samples_accepted: u64,
    pub vad_segments_popped: u64,
    pub diarization_calls: u64,
    pub diarization_skipped_disabled: u64,
    pub diarization_failures: u64,
    pub diarization_total_ms: f64,
    pub diarization_average_ms: Option<f64>,
    pub diarization_new_speakers: u64,
}

fn record_diarization_duration(started: Instant) {
    let micros = started.elapsed().as_micros().min(u64::MAX as u128) as u64;
    DIARIZATION_TOTAL_MICROS.fetch_add(micros, Ordering::Relaxed);
}

#[tauri::command]
pub fn get_speaker_diarization_enabled() -> bool {
    SPEAKER_DIARIZATION_ENABLED.load(Ordering::Relaxed)
}

#[tauri::command]
pub fn set_speaker_diarization_enabled(enabled: bool) -> bool {
    SPEAKER_DIARIZATION_ENABLED.store(enabled, Ordering::Relaxed);
    log::info!("Speaker diarization {}", if enabled { "enabled" } else { "disabled" });
    enabled
}

#[tauri::command]
pub fn get_speech_detection_diagnostics() -> SpeechDetectionDiagnostics {
    let calls = DIARIZATION_CALLS.load(Ordering::Relaxed);
    let total_micros = DIARIZATION_TOTAL_MICROS.load(Ordering::Relaxed);
    SpeechDetectionDiagnostics {
        diarization_enabled: SPEAKER_DIARIZATION_ENABLED.load(Ordering::Relaxed),
        vad_samples_accepted: VAD_SAMPLES_ACCEPTED.load(Ordering::Relaxed),
        vad_segments_popped: VAD_SEGMENTS_POPPED.load(Ordering::Relaxed),
        diarization_calls: calls,
        diarization_skipped_disabled: DIARIZATION_SKIPPED_DISABLED.load(Ordering::Relaxed),
        diarization_failures: DIARIZATION_FAILURES.load(Ordering::Relaxed),
        diarization_total_ms: total_micros as f64 / 1_000.0,
        diarization_average_ms: if calls == 0 {
            None
        } else {
            Some(total_micros as f64 / calls as f64 / 1_000.0)
        },
        diarization_new_speakers: DIARIZATION_NEW_SPEAKERS.load(Ordering::Relaxed),
    }
}

#[tauri::command]
pub fn reset_speech_detection_diagnostics() -> SpeechDetectionDiagnostics {
    VAD_SAMPLES_ACCEPTED.store(0, Ordering::Relaxed);
    VAD_SEGMENTS_POPPED.store(0, Ordering::Relaxed);
    DIARIZATION_CALLS.store(0, Ordering::Relaxed);
    DIARIZATION_SKIPPED_DISABLED.store(0, Ordering::Relaxed);
    DIARIZATION_FAILURES.store(0, Ordering::Relaxed);
    DIARIZATION_TOTAL_MICROS.store(0, Ordering::Relaxed);
    DIARIZATION_NEW_SPEAKERS.store(0, Ordering::Relaxed);
    get_speech_detection_diagnostics()
}

/// Wraps Silero VAD for streaming speech detection.
pub struct SpeechDetector {
    vad: SileroVad,
}

impl SpeechDetector {
    pub fn new(model_path: &str) -> Result<Self, String> {
        let config = SileroVadConfig {
            model: model_path.to_string(),
            threshold: 0.45,
            min_silence_duration: 0.3,
            min_speech_duration: 0.2,
            max_speech_duration: 10.0,
            sample_rate: 16000,
            window_size: 512,
            ..Default::default()
        };
        let vad = SileroVad::new(config, 30.0)
            .map_err(|e| format!("Failed to create SileroVad: {e}"))?;
        Ok(Self { vad })
    }

    /// Feed 16kHz mono audio samples to the VAD.
    pub fn accept_waveform(&mut self, samples: &[f32]) {
        VAD_SAMPLES_ACCEPTED.fetch_add(samples.len() as u64, Ordering::Relaxed);
        self.vad.accept_waveform(samples.to_vec());
    }

    pub fn is_speech(&mut self) -> bool {
        self.vad.is_speech()
    }

    pub fn has_segment(&mut self) -> bool {
        !self.vad.is_empty()
    }

    pub fn pop_segment(&mut self) -> SpeechSegment {
        let seg = self.vad.front();
        self.vad.pop();
        VAD_SEGMENTS_POPPED.fetch_add(1, Ordering::Relaxed);
        seg
    }

    pub fn flush(&mut self) {
        self.vad.flush();
    }
}

pub struct SpeakerResult {
    pub speaker_id: i32,
    pub speaker_label: String,
    pub is_new_speaker: bool,
}

/// Tracks speakers by extracting voice embeddings and matching against known speakers.
/// One instance per device (input/output) so speakers are tracked independently.
pub struct SpeakerTracker {
    extractor: EmbeddingExtractor,
    manager: EmbeddingManager,
    next_speaker_id: i32,
}

impl SpeakerTracker {
    pub fn new(model_path: &str) -> Result<Self, String> {
        let config = ExtractorConfig {
            model: model_path.to_string(),
            ..Default::default()
        };
        let extractor = EmbeddingExtractor::new(config)
            .map_err(|e| format!("Failed to create EmbeddingExtractor: {e}"))?;
        let dim = extractor.embedding_size as i32;
        let manager = EmbeddingManager::new(dim);
        Ok(Self {
            extractor,
            manager,
            next_speaker_id: 1,
        })
    }

    pub fn identify_speaker(&mut self, audio: &[f32], sample_rate: u32) -> Option<SpeakerResult> {
        if !SPEAKER_DIARIZATION_ENABLED.load(Ordering::Relaxed) {
            DIARIZATION_SKIPPED_DISABLED.fetch_add(1, Ordering::Relaxed);
            return None;
        }

        DIARIZATION_CALLS.fetch_add(1, Ordering::Relaxed);
        let started = Instant::now();
        let mut embedding = match self
            .extractor
            .compute_speaker_embedding(audio.to_vec(), sample_rate)
        {
            Ok(e) => e,
            Err(e) => {
                record_diarization_duration(started);
                DIARIZATION_FAILURES.fetch_add(1, Ordering::Relaxed);
                log::warn!("Speaker embedding extraction failed: {e}");
                return None;
            }
        };

        if let Some(name) = self.manager.search(&embedding, DEFAULT_SIMILARITY_THRESHOLD) {
            let id = name
                .strip_prefix("Speaker ")
                .and_then(|n| n.parse::<i32>().ok())
                .unwrap_or(0);
            record_diarization_duration(started);
            return Some(SpeakerResult {
                speaker_id: id,
                speaker_label: name,
                is_new_speaker: false,
            });
        }

        let id = self.next_speaker_id;
        let label = format!("Speaker {id}");
        if let Err(e) = self.manager.add(label.clone(), &mut embedding) {
            record_diarization_duration(started);
            DIARIZATION_FAILURES.fetch_add(1, Ordering::Relaxed);
            log::warn!("Failed to register speaker: {e}");
            return None;
        }
        self.next_speaker_id += 1;
        DIARIZATION_NEW_SPEAKERS.fetch_add(1, Ordering::Relaxed);
        record_diarization_duration(started);

        Some(SpeakerResult {
            speaker_id: id,
            speaker_label: label,
            is_new_speaker: true,
        })
    }

    pub fn reset(&mut self) {
        let dim = self.extractor.embedding_size as i32;
        self.manager = EmbeddingManager::new(dim);
        self.next_speaker_id = 1;
    }
}
