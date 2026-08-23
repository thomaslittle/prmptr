use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::sync::mpsc;

use crate::speech::audio::capture::{spawn_capture_thread, CaptureSpec};
use crate::speech::audio::metrics::{AudioPipelineMetrics, AudioPipelineSnapshot};
use crate::speech::audio::{
    platform, AudioChunk, AudioTrackId, DEFAULT_AUDIO_QUEUE_CAPACITY, SPEECH_SAMPLE_RATE,
};
use crate::speech::engines::{build_engine, LocalSpeechEngine, SpeechEngine};
use crate::transcription::canonical::{
    SpeakerSpan, TranscriptLine, TranscriptRole, TranscriptTrackId,
};
use crate::transcription::speaker::{SpeakerTracker, SpeechDetector};
use crate::transcription::transcript::{TranscriptBuffer, TranscriptEntry};

const HISTORY_SAMPLES: usize = SPEECH_SAMPLE_RATE as usize * 15;
const LEAD_IN_SAMPLES: usize = SPEECH_SAMPLE_RATE as usize * 600 / 1000;
const ZERO_GAP_BLOCK: usize = SPEECH_SAMPLE_RATE as usize;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalSpeechConfig {
    pub input_device_name: Option<String>,
    pub output_device_name: Option<String>,
    pub whisper_model_id: Option<String>,
    pub prefer_gpu: bool,
    #[serde(default)]
    pub engine: LocalSpeechEngine,
    #[serde(default)]
    pub mute_input: bool,
    #[serde(default)]
    pub mute_output: bool,
    #[serde(default = "default_queue_capacity")]
    pub queue_capacity: usize,
}

fn default_queue_capacity() -> usize {
    DEFAULT_AUDIO_QUEUE_CAPACITY
}

impl Default for LocalSpeechConfig {
    fn default() -> Self {
        Self {
            input_device_name: None,
            output_device_name: None,
            whisper_model_id: None,
            prefer_gpu: false,
            engine: LocalSpeechEngine::Whisper,
            mute_input: false,
            mute_output: false,
            queue_capacity: DEFAULT_AUDIO_QUEUE_CAPACITY,
        }
    }
}

struct TrackInferenceState {
    vad: SpeechDetector,
    speaker: Option<SpeakerTracker>,
    recent_history: Vec<f32>,
    vad_fed_total: u64,
}

impl TrackInferenceState {
    fn new(vad_model: &str, speaker_model: Option<&str>) -> Result<Self, String> {
        Ok(Self {
            vad: SpeechDetector::new(vad_model)?,
            speaker: match speaker_model {
                Some(path) => Some(SpeakerTracker::new(path)?),
                None => None,
            },
            recent_history: Vec::with_capacity(HISTORY_SAMPLES + SPEECH_SAMPLE_RATE as usize),
            vad_fed_total: 0,
        })
    }

    fn feed_samples(&mut self, samples: &[f32]) {
        self.recent_history.extend_from_slice(samples);
        if self.recent_history.len() > HISTORY_SAMPLES {
            let remove = self.recent_history.len() - HISTORY_SAMPLES;
            self.recent_history.drain(..remove);
        }
        self.vad.accept_waveform(samples);
        self.vad_fed_total = self.vad_fed_total.saturating_add(samples.len() as u64);
    }

    /// Preserve the capture sample clock even when bounded-queue backpressure
    /// drops chunks. Missing capture time becomes silence rather than causing
    /// every later transcript timestamp to drift earlier than reality.
    fn feed_chunk(&mut self, chunk: &AudioChunk) {
        let mut gap = chunk.start_sample.saturating_sub(self.vad_fed_total);
        if gap > 0 {
            log::warn!(
                "[{}] inserting {} dropped samples as silence to preserve audio clock",
                chunk.track.as_str(),
                gap
            );
            let zero_block = vec![0.0; ZERO_GAP_BLOCK];
            while gap > 0 {
                let count = (gap as usize).min(ZERO_GAP_BLOCK);
                self.feed_samples(&zero_block[..count]);
                gap -= count as u64;
            }
        }
        self.feed_samples(&chunk.samples);
    }

    fn with_lead_in(&self, segment_start_raw: i32, samples: &[f32]) -> (Vec<f32>, u64) {
        let segment_start = (segment_start_raw.max(0) as u64).min(self.vad_fed_total);
        let wanted_start = segment_start.saturating_sub(LEAD_IN_SAMPLES as u64);
        let history_start = self
            .vad_fed_total
            .saturating_sub(self.recent_history.len() as u64);
        let from = wanted_start.max(history_start);
        let to = segment_start;
        let mut combined = Vec::with_capacity(samples.len() + LEAD_IN_SAMPLES);
        if to > from {
            let start_index = (from - history_start) as usize;
            let end_index = (to - history_start) as usize;
            if end_index <= self.recent_history.len() && start_index <= end_index {
                combined.extend_from_slice(&self.recent_history[start_index..end_index]);
            }
        }
        let actual_start = segment_start.saturating_sub(combined.len() as u64);
        combined.extend_from_slice(samples);
        (combined, actual_start)
    }
}

pub struct SpeechStreamManager {
    running: Arc<AtomicBool>,
    threads: Vec<std::thread::JoinHandle<()>>,
    mute_input: Arc<AtomicBool>,
    mute_output: Arc<AtomicBool>,
    input_level: Arc<StdMutex<f32>>,
    output_level: Arc<StdMutex<f32>>,
    audio_metrics: Arc<AudioPipelineMetrics>,
}

impl SpeechStreamManager {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            threads: Vec::new(),
            mute_input: Arc::new(AtomicBool::new(false)),
            mute_output: Arc::new(AtomicBool::new(false)),
            input_level: Arc::new(StdMutex::new(0.0)),
            output_level: Arc::new(StdMutex::new(0.0)),
            audio_metrics: Arc::new(AudioPipelineMetrics::default()),
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    pub fn set_mute(&self, channel: &str, muted: bool) {
        match channel {
            "input" => self.mute_input.store(muted, Ordering::Relaxed),
            "output" => self.mute_output.store(muted, Ordering::Relaxed),
            _ => {}
        }
    }

    pub fn input_level(&self) -> f32 {
        self.input_level.lock().map(|level| *level).unwrap_or(0.0)
    }

    pub fn output_level(&self) -> f32 {
        self.output_level.lock().map(|level| *level).unwrap_or(0.0)
    }

    pub fn input_muted(&self) -> bool {
        self.mute_input.load(Ordering::Relaxed)
    }

    pub fn output_muted(&self) -> bool {
        self.mute_output.load(Ordering::Relaxed)
    }

    pub fn audio_metrics(&self) -> AudioPipelineSnapshot {
        self.audio_metrics.snapshot()
    }

    pub fn start<C>(
        &mut self,
        app: tauri::AppHandle,
        config: C,
        transcript_buffer: Arc<tokio::sync::Mutex<TranscriptBuffer>>,
    ) -> Result<(), String>
    where
        C: Into<LocalSpeechConfig>,
    {
        if self.is_running() {
            return Err("Local speech transcription is already running".to_string());
        }
        let config = config.into();
        let mic_enabled = config.input_device_name.is_some();
        let system_requested = config.output_device_name.is_some();
        let system_enabled = system_requested && platform::supports_system_capture();
        if system_requested && !system_enabled {
            log::warn!("System capture disabled: {}", platform::system_capture_detail());
        }
        if !mic_enabled && !system_enabled {
            return Err("No supported speech capture track is configured".to_string());
        }

        self.mute_input.store(config.mute_input, Ordering::Relaxed);
        self.mute_output.store(config.mute_output, Ordering::Relaxed);
        self.audio_metrics = Arc::new(AudioPipelineMetrics::default());

        let queue_capacity = config.queue_capacity.clamp(8, 1024);
        let (tx, mut rx) = mpsc::channel::<AudioChunk>(queue_capacity);
        let running = Arc::new(AtomicBool::new(true));
        self.running = running.clone();

        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel::<Result<(), String>>(1);
        let worker_app = app.clone();
        let worker_config = config.clone();
        let worker = std::thread::spawn(move || {
            let vad_path = match crate::transcription::model_manager::resolve_vad_model_path(&worker_app) {
                Ok(path) => path.to_string_lossy().to_string(),
                Err(error) => {
                    let _ = ready_tx.send(Err(error));
                    return;
                }
            };
            let speaker_path = if system_enabled {
                match crate::transcription::model_manager::resolve_speaker_model_path(&worker_app) {
                    Ok(path) => Some(path.to_string_lossy().to_string()),
                    Err(error) => {
                        let _ = ready_tx.send(Err(error));
                        return;
                    }
                }
            } else {
                None
            };
            let mut engine = match build_engine(
                &worker_app,
                worker_config.engine,
                worker_config.whisper_model_id.as_deref(),
                worker_config.prefer_gpu,
            ) {
                Ok(engine) => engine,
                Err(error) => {
                    let _ = ready_tx.send(Err(error));
                    return;
                }
            };
            let mut states = HashMap::new();
            if mic_enabled {
                match TrackInferenceState::new(&vad_path, None) {
                    Ok(state) => {
                        states.insert(AudioTrackId::Mic, state);
                    }
                    Err(error) => {
                        let _ = ready_tx.send(Err(error));
                        return;
                    }
                }
            }
            if system_enabled {
                match TrackInferenceState::new(&vad_path, speaker_path.as_deref()) {
                    Ok(state) => {
                        states.insert(AudioTrackId::System, state);
                    }
                    Err(error) => {
                        let _ = ready_tx.send(Err(error));
                        return;
                    }
                }
            }
            let _ = ready_tx.send(Ok(()));
            log::info!(
                "Speech worker ready: engine={} model={} tracks={} queue_capacity={}",
                engine.engine_id(),
                engine.model_id(),
                states.len(),
                queue_capacity
            );

            while let Some(chunk) = rx.blocking_recv() {
                if let Some(state) = states.get_mut(&chunk.track) {
                    process_chunk(
                        &worker_app,
                        &transcript_buffer,
                        chunk,
                        state,
                        engine.as_mut(),
                    );
                }
            }

            for (track, state) in states.iter_mut() {
                state.vad.flush();
                drain_segments(
                    &worker_app,
                    &transcript_buffer,
                    *track,
                    state,
                    engine.as_mut(),
                );
            }
            log::info!("Speech inference worker stopped");
        });

        match ready_rx.recv_timeout(std::time::Duration::from_secs(60)) {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                running.store(false, Ordering::Relaxed);
                drop(tx);
                let _ = worker.join();
                return Err(error);
            }
            Err(error) => {
                running.store(false, Ordering::Relaxed);
                drop(tx);
                let _ = worker.join();
                return Err(format!("Timed out initializing speech engine: {error}"));
            }
        }

        let mut capture_threads = Vec::new();
        if mic_enabled {
            capture_threads.push(spawn_capture_thread(
                CaptureSpec {
                    track: AudioTrackId::Mic,
                    device_name: config.input_device_name.clone(),
                },
                running.clone(),
                self.mute_input.clone(),
                self.input_level.clone(),
                tx.clone(),
                self.audio_metrics.clone(),
            )?);
        }
        if system_enabled {
            capture_threads.push(spawn_capture_thread(
                CaptureSpec {
                    track: AudioTrackId::System,
                    device_name: config.output_device_name.clone(),
                },
                running.clone(),
                self.mute_output.clone(),
                self.output_level.clone(),
                tx.clone(),
                self.audio_metrics.clone(),
            )?);
        }
        drop(tx);

        let activity_app = app.clone();
        let activity_running = running.clone();
        let input_level = self.input_level.clone();
        let output_level = self.output_level.clone();
        let input_muted = self.mute_input.clone();
        let output_muted = self.mute_output.clone();
        tauri::async_runtime::spawn(async move {
            while activity_running.load(Ordering::Relaxed) {
                let payload = serde_json::json!({
                    "input_level": input_level.lock().map(|value| *value).unwrap_or(0.0),
                    "output_level": output_level.lock().map(|value| *value).unwrap_or(0.0),
                    "input_muted": input_muted.load(Ordering::Relaxed),
                    "output_muted": output_muted.load(Ordering::Relaxed),
                });
                let _ = activity_app.emit("local-transcription-activity", payload);
                tokio::time::sleep(std::time::Duration::from_millis(120)).await;
            }
        });

        self.threads.extend(capture_threads);
        self.threads.push(worker);
        log::info!("Local speech transcription started");
        Ok(())
    }

    pub fn stop(&mut self) {
        if !self.is_running() {
            return;
        }
        self.running.store(false, Ordering::Relaxed);
        for thread in self.threads.drain(..) {
            let _ = thread.join();
        }
        if let Ok(mut level) = self.input_level.lock() {
            *level = 0.0;
        }
        if let Ok(mut level) = self.output_level.lock() {
            *level = 0.0;
        }
        log::info!("Local speech transcription stopped");
    }
}

fn process_chunk(
    app: &tauri::AppHandle,
    transcript_buffer: &Arc<tokio::sync::Mutex<TranscriptBuffer>>,
    chunk: AudioChunk,
    state: &mut TrackInferenceState,
    engine: &mut dyn SpeechEngine,
) {
    state.feed_chunk(&chunk);
    drain_segments(app, transcript_buffer, chunk.track, state, engine);
}

fn drain_segments(
    app: &tauri::AppHandle,
    transcript_buffer: &Arc<tokio::sync::Mutex<TranscriptBuffer>>,
    track: AudioTrackId,
    state: &mut TrackInferenceState,
    engine: &mut dyn SpeechEngine,
) {
    while state.vad.has_segment() {
        let segment = state.vad.pop_segment();
        let (audio, start_sample) = state.with_lead_in(segment.start, &segment.samples);
        let Some(result) = engine.transcribe(&audio, track.as_str()) else {
            continue;
        };
        let segment_start = (segment.start.max(0) as u64).min(state.vad_fed_total);
        let end_sample = segment_start.saturating_add(segment.samples.len() as u64);
        let start_ms = start_sample.saturating_mul(1000) / SPEECH_SAMPLE_RATE as u64;
        let end_ms = end_sample.saturating_mul(1000) / SPEECH_SAMPLE_RATE as u64;

        let speaker_result = if track == AudioTrackId::System {
            state
                .speaker
                .as_mut()
                .and_then(|tracker| tracker.identify_speaker(&segment.samples, SPEECH_SAMPLE_RATE))
        } else {
            None
        };
        let speaker_spans = speaker_result
            .as_ref()
            .map(|speaker| {
                vec![SpeakerSpan {
                    speaker_key: format!("system:{}", speaker.speaker_id),
                    speaker_index: speaker.speaker_id,
                    label: Some(speaker.speaker_label.clone()),
                    start_ms,
                    end_ms,
                    start_char: Some(0),
                    end_char: Some(result.text.len()),
                }]
            })
            .unwrap_or_default();

        let now = Utc::now();
        let line = TranscriptLine {
            id: uuid::Uuid::new_v4().to_string(),
            revision: 0,
            track_id: match track {
                AudioTrackId::Mic => TranscriptTrackId::Mic,
                AudioTrackId::System => TranscriptTrackId::System,
            },
            role: match track {
                AudioTrackId::Mic => TranscriptRole::You,
                AudioTrackId::System => TranscriptRole::Them,
            },
            engine: engine.engine_id().to_string(),
            model: engine.model_id().to_string(),
            model_version: None,
            text: result.text,
            start_ms,
            end_ms,
            is_complete: true,
            words: Vec::new(),
            speaker_spans,
            latency_ms: Some(result.latency_ms),
            created_at: now,
            updated_at: now,
        };

        let _ = app.emit("speech-transcript-line", &line);
        let speaker = line.speaker_spans.first().map(|span| span.speaker_index);
        let entry = TranscriptEntry {
            id: line.id.clone(),
            text: line.text.clone(),
            timestamp: now,
            source: line.engine.clone(),
            speaker,
            is_final: true,
        };
        transcript_buffer.blocking_lock().update_or_push(entry);
        log::info!(
            "[speech] track={} engine={} model={} start={}ms end={}ms latency={}ms text='{}'",
            track.as_str(),
            line.engine,
            line.model,
            line.start_ms,
            line.end_ms,
            line.latency_ms.unwrap_or_default(),
            line.text.chars().take(100).collect::<String>()
        );
    }
}
