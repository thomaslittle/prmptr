use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use chrono::Utc;
use std::sync::Once;

use crate::transcription::transcript::{TranscriptBuffer, TranscriptEntry};
use crate::transcription::speaker::{SpeechDetector, SpeakerTracker};

/// Small shared live-value cell for the per-channel audio-activity level.
type AtomicMutex<T> = StdMutex<T>;

// ──────────────────────────── STT Engine Abstraction ────────────────────────────

/// Inference engine used for local transcription. Both variants consume
/// 16 kHz mono f32 samples and produce text for a VAD-delimited utterance.
pub enum SttEngine {
    Whisper(whisper_rs::WhisperContext),
    Moonshine(sherpa_rs::moonshine::MoonshineRecognizer),
}

impl SttEngine {
    fn transcribe(&mut self, audio: &[f32], device_label: &str) -> Option<String> {
        match self {
            SttEngine::Whisper(ctx) => run_whisper(ctx, audio, device_label),
            SttEngine::Moonshine(rec) => run_moonshine(rec, audio, device_label),
        }
    }
}

/// Run Moonshine on audio samples, return the transcribed text (or None).
fn run_moonshine(
    recognizer: &mut sherpa_rs::moonshine::MoonshineRecognizer,
    audio: &[f32],
    device_label: &str,
) -> Option<String> {
    let audio_secs = audio.len() as f32 / SAMPLE_RATE as f32;
    log::debug!("[{device_label}] Running moonshine on {audio_secs:.1}s of audio ({} samples)", audio.len());

    let result = recognizer.transcribe(SAMPLE_RATE as u32, audio);
    let text = result.text.trim().to_string();
    log::debug!("[{device_label}] Moonshine result: '{}'", text.chars().take(80).collect::<String>());

    if text.len() < 2 {
        return None;
    }

    let lower = text.to_lowercase();
    if lower.contains("[blank_audio]")
        || lower.contains("(blank audio)")
        || lower == "you"
        || lower == "the"
        || lower == "thank you."
        || (lower.starts_with('[') && lower.ends_with(']'))
    {
        return None;
    }

    Some(text)
}

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

// ──────────────────────────── Audio Ring Buffer ────────────────────────────

const SAMPLE_RATE: usize = 16_000;
const BUFFER_SECS: usize = 30;
const BUFFER_CAPACITY: usize = SAMPLE_RATE * BUFFER_SECS; // 480,000 samples

pub struct AudioRingBuffer {
    data: Vec<f32>,
    write_pos: usize,
    len: usize,
    /// Monotonic count of samples ever pushed (watermark base for drains).
    total_written: u64,
}

impl AudioRingBuffer {
    pub fn new() -> Self {
        Self {
            data: vec![0.0; BUFFER_CAPACITY],
            write_pos: 0,
            len: 0,
            total_written: 0,
        }
    }

    pub fn push_samples(&mut self, samples: &[f32]) {
        for &s in samples {
            self.data[self.write_pos] = s;
            self.write_pos = (self.write_pos + 1) % BUFFER_CAPACITY;
            if self.len < BUFFER_CAPACITY {
                self.len += 1;
            }
        }
        self.total_written += samples.len() as u64;
    }

    /// Current watermark: pass to `read_new_since` later to get everything since.
    pub fn total_written(&self) -> u64 {
        self.total_written
    }

    /// Read ALL samples pushed since `watermark` (oldest first), capped to
    /// buffer capacity, plus the new watermark for the next call. Unlike a
    /// fixed trailing window, nothing is lost between consumer cycles.
    pub fn read_new_since(&self, watermark: u64) -> (Vec<f32>, u64) {
        let newest = self.total_written;
        if newest <= watermark {
            return (Vec::new(), newest);
        }
        let available = (newest - watermark) as usize;
        let count = available.min(self.len.min(BUFFER_CAPACITY));
        // Oldest retrievable sample's absolute index
        let start_abs = newest - count as u64;
        let mut out = Vec::with_capacity(count);
        for i in 0..count {
            let abs = start_abs + i as u64;
            let idx = (abs as usize) % BUFFER_CAPACITY;
            out.push(self.data[idx]);
        }
        (out, newest)
    }

    /// Read the last N samples in chronological order
    pub fn read_last_n(&self, n: usize) -> Vec<f32> {
        let n = n.min(self.len);
        if n == 0 {
            return Vec::new();
        }
        let mut out = Vec::with_capacity(n);
        let start = if self.write_pos >= n {
            self.write_pos - n
        } else {
            BUFFER_CAPACITY - (n - self.write_pos)
        };
        for i in 0..n {
            out.push(self.data[(start + i) % BUFFER_CAPACITY]);
        }
        out
    }
}

// ──────────────────────────── Config ────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalWhisperConfig {
    pub input_device_name: Option<String>,
    pub output_device_name: Option<String>,
    pub whisper_model_id: Option<String>,
    pub prefer_gpu: bool,
    /// When true, use Moonshine (sherpa-onnx) instead of Whisper for inference.
    #[serde(default)]
    pub use_moonshine: bool,
    /// Mute the microphone (input/"You") channel — no audio is captured, so
    /// nothing from it reaches the transcript/feed.
    #[serde(default)]
    pub mute_input: bool,
    /// Mute the system loopback (output/"Them") channel.
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
            // Short interval: VAD sees audio quickly and finalize latency stays
            // low. Drain-based reads make interval length loss-free regardless.
            inference_interval_ms: 300,
        }
    }
}

// ──────────────────────────── Transcription Result ────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct TranscriptionResult {
    pub id: String,
    pub text: String,
    pub is_final: bool,
    pub timestamp: String,
    pub device_type: String, // "input" or "output"
    pub speaker_id: Option<i32>,
    pub speaker_label: Option<String>,
}

// ──────────────────────────── Linear Resampler ────────────────────────────

fn resample_linear(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate {
        return input.to_vec();
    }
    let ratio = from_rate as f64 / to_rate as f64;
    let out_len = (input.len() as f64 / ratio) as usize;
    let mut output = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src_idx = i as f64 * ratio;
        let idx0 = src_idx as usize;
        let frac = (src_idx - idx0 as f64) as f32;
        let idx1 = (idx0 + 1).min(input.len().saturating_sub(1));
        output.push(input[idx0] * (1.0 - frac) + input[idx1] * frac);
    }
    output
}

/// Average stereo (interleaved) samples to mono
fn stereo_to_mono(input: &[f32]) -> Vec<f32> {
    input
        .chunks(2)
        .map(|pair| {
            if pair.len() == 2 {
                (pair[0] + pair[1]) * 0.5
            } else {
                pair[0]
            }
        })
        .collect()
}

/// RMS audio level of a mono buffer, normalized roughly to 0..1. Used purely
/// for the UI "active" indicator on the You/Them buttons.
fn rms_level(input: &[f32]) -> f32 {
    if input.is_empty() {
        return 0.0;
    }
    let sum: f64 = input.iter().map(|&s| (s as f64) * (s as f64)).sum();
    let rms = (sum / input.len() as f64).sqrt();
    // Clamp into a 0..1 range; typical speech sits well below 1.0.
    (rms as f32).min(1.0)
}

// ──────────────────────────── Audio Capture ────────────────────────────

/// Spawn a capture thread for a given device. For output devices, this uses
/// WASAPI loopback on Windows.
fn spawn_capture_thread(
    device_name: Option<String>,
    is_output: bool,
    ring_buffer: Arc<StdMutex<AudioRingBuffer>>,
    running: Arc<AtomicBool>,
    mute_flag: Arc<AtomicBool>,
    level_flag: Arc<AtomicMutex<f32>>,
    label: &'static str,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

        let host = cpal::default_host();

        // Strip the "(input)" / "(output)" suffix we add during enumeration
        let clean_name = device_name.as_ref().map(|n| {
            n.trim()
                .trim_end_matches(" (input)")
                .trim_end_matches(" (output)")
                .trim()
                .to_string()
        });

        // Output-device loopback capture is a Windows WASAPI feature.
        // On Linux/macOS, system-audio capture requires PulseAudio monitor
        // sources or similar — gracefully skip for now.
        if is_output && !cfg!(target_os = "windows") {
            log::warn!(
                "[{label}] System-audio (loopback) capture is not yet supported on this platform. \
                 Only microphone input will be transcribed."
            );
            return;
        }

        let matches_device = |dev_name: &str, wanted: &str| {
            let a = dev_name.trim();
            let b = wanted.trim();
            a == b || a.eq_ignore_ascii_case(b)
        };

        let device = if is_output {
            // For output (loopback): find among output devices
            if let Some(ref name) = clean_name {
                host.output_devices()
                    .ok()
                    .and_then(|mut devs| {
                        devs.find(|d| d.name().map(|n| matches_device(&n, name)).unwrap_or(false))
                    })
                    .or_else(|| {
                        log::warn!("[{label}] Output device '{name}' not found, using default");
                        host.default_output_device()
                    })
            } else {
                host.default_output_device()
            }
        } else {
            // For input: find among input devices
            if let Some(ref name) = clean_name {
                host.input_devices()
                    .ok()
                    .and_then(|mut devs| {
                        devs.find(|d| d.name().map(|n| matches_device(&n, name)).unwrap_or(false))
                    })
                    .or_else(|| {
                        log::warn!("[{label}] Input device '{name}' not found, using default");
                        host.default_input_device()
                    })
            } else {
                host.default_input_device()
            }
        };

        let device = match device {
            Some(d) => d,
            None => {
                log::error!("[{label}] No audio device available");
                return;
            }
        };

        let dev_name = device.name().unwrap_or_default();
        log::info!("[{label}] Using device '{dev_name}'");

        // For output/loopback, we use the default output config; for input, default input config.
        let supported_config = if is_output {
            match device.default_output_config() {
                Ok(c) => c,
                Err(e) => {
                    log::error!("[{label}] Failed to get default output config: {e}");
                    return;
                }
            }
        } else {
            match device.default_input_config() {
                Ok(c) => c,
                Err(e) => {
                    log::error!("[{label}] Failed to get default input config: {e}");
                    return;
                }
            }
        };

        let native_rate = supported_config.sample_rate().0;
        let native_channels = supported_config.channels() as usize;
        log::info!("[{label}] Config: {native_rate}Hz, {native_channels}ch");

        let ring_buf = ring_buffer;
        let running_cb = running.clone();
        let mute_cb = mute_flag.clone();
        let level_cb = level_flag.clone();

        let stream_config: cpal::StreamConfig = supported_config.into();

        // Build the stream. For output devices on Windows (WASAPI), build_input_stream
        // on an output device creates a loopback capture stream.
        let stream = device.build_input_stream(
            &stream_config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if !running_cb.load(Ordering::Relaxed) {
                    return;
                }
                // Soft-mute: a muted channel silently drops its samples so it
                // never reaches the transcript — the engine keeps running.
                if mute_cb.load(Ordering::Relaxed) {
                    if let Ok(mut lv) = level_cb.lock() {
                        *lv = 0.0;
                    }
                    return;
                }
                let mono = if native_channels > 1 {
                    stereo_to_mono(data)
                } else {
                    data.to_vec()
                };
                // Publish the live audio level for the UI activity indicator.
                if let Ok(mut lv) = level_cb.lock() {
                    *lv = rms_level(&mono);
                }
                let resampled = resample_linear(&mono, native_rate, SAMPLE_RATE as u32);
                if let Ok(mut buf) = ring_buf.lock() {
                    buf.push_samples(&resampled);
                }
            },
            move |err| {
                log::error!("[{label}] Audio capture error: {err}");
            },
            None,
        );

        let stream = match stream {
            Ok(s) => s,
            Err(e) => {
                log::error!("[{label}] Failed to build stream: {e}");
                return;
            }
        };

        if let Err(e) = stream.play() {
            log::error!("[{label}] Failed to start stream: {e}");
            return;
        }

        while running.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        drop(stream);
        log::info!("[{label}] Capture thread stopped");
    })
}

// ──────────────────────────── Per-Device Inference State ────────────────────────────

/// Rolling audio history kept so VAD segment onsets can always be padded
/// retroactively. Must exceed max utterance length (10s) + lead-in margin —
/// a short trailing window can't reach back to the START of a long
/// utterance, which is exactly how first words used to vanish.
const HISTORY_SECS: usize = 15;
const HISTORY_SAMPLES: usize = HISTORY_SECS * SAMPLE_RATE;

/// Pre-speech audio seeded when a fresh utterance starts (fallback path).
const PREROLL_SAMPLES: usize = 400 * SAMPLE_RATE / 1000;

/// Lead-in prepended before each Silero VAD segment onset (600ms) — Silero
/// trims at its probability trigger, which clips soft sentence starts.
const LEAD_IN_SAMPLES: usize = 600 * SAMPLE_RATE / 1000;

/// Prepend exactly the audio between [start - LEAD_IN, start) from
/// the rolling history window onto a popped VAD segment. Works regardless
/// of utterance length because history spans 15s.
fn combine_segment_with_lead_in(
    state: &mut DeviceInferState,
    segment_start_raw: i32,
    segment_samples: &[f32],
) -> Vec<f32> {
    let seg_start = (segment_start_raw.max(0) as u64).min(state.vad_fed_total);
    let lead_wanted = seg_start.saturating_sub(LEAD_IN_SAMPLES as u64);
    let history_len = state.recent_history.len() as u64;
    let history_starts_at = state.vad_fed_total.saturating_sub(history_len);
    let from = lead_wanted.max(history_starts_at);
    let to = seg_start;
    let mut combined =
        Vec::with_capacity(segment_samples.len() + LEAD_IN_SAMPLES);
    if to > from {
        let s = (from - history_starts_at) as usize;
        let e = (to - history_starts_at) as usize;
        combined.extend_from_slice(&state.recent_history[s..e]);
    }
    combined.extend_from_slice(segment_samples);
    if combined.len() > segment_samples.len() {
        log::debug!(
            "[vad] Prepended {}ms of lead-in before segment onset",
            (combined.len() - segment_samples.len()) * 1000 / SAMPLE_RATE
        );
    }
    combined
}

/// Emit an interim partial every N speech cycles so the UI shows progress
const PARTIAL_EMIT_INTERVAL: u32 = 2;
const EMIT_PARTIAL_EVENTS: bool = false;

/// Silence duration (time-based, not cycle-based) before finalizing an
/// utterance via the fallback path.
const SILENCE_FINALIZE_MS: u32 = 900;
const MAX_UTTERANCE_SECS: usize = 9; // force split very long utterances
const MIN_FALLBACK_FINALIZE_SECS: usize = 1; // avoid tiny accidental finalize

struct DeviceInferState {
    vad: SpeechDetector,
    speaker_tracker: SpeakerTracker,
    /// Accumulated audio for partial emissions during ongoing speech
    speech_accumulator: Vec<f32>,
    /// Rolling 15s window of ALL fed audio (speech or silence) used for
    /// retroactive VAD onset padding and utterance preroll seeding
    recent_history: Vec<f32>,
    /// Ring-buffer watermark: everything before this was already consumed
    read_watermark: u64,
    /// Total samples fed to the VAD — matches Silero's segment.start basis
    vad_fed_total: u64,
    current_partial_id: String,
    speech_started_at: Option<String>,
    speech_cycle_count: u32,
    silence_ms: u32,
    in_speech: bool,
}

impl DeviceInferState {
    fn new(
        vad: SpeechDetector,
        speaker_tracker: SpeakerTracker,
        initial_watermark: u64,
    ) -> Self {
        Self {
            vad,
            speaker_tracker,
            speech_accumulator: Vec::new(),
            recent_history: Vec::with_capacity(HISTORY_SAMPLES + SAMPLE_RATE),
            read_watermark: initial_watermark,
            vad_fed_total: 0,
            current_partial_id: uuid::Uuid::new_v4().to_string(),
            speech_started_at: None,
            speech_cycle_count: 0,
            silence_ms: 0,
            in_speech: false,
        }
    }

    fn reset_speech(&mut self) {
        self.speech_accumulator.clear();
        self.current_partial_id = uuid::Uuid::new_v4().to_string();
        self.speech_started_at = None;
        self.speech_cycle_count = 0;
        self.silence_ms = 0;
        self.in_speech = false;
    }
}

/// Run whisper on audio samples, return the transcribed text (or None).
fn run_whisper(ctx: &whisper_rs::WhisperContext, audio: &[f32], device_label: &str) -> Option<String> {
    let mut state = match ctx.create_state() {
        Ok(s) => s,
        Err(e) => {
            log::error!("[{device_label}] Failed to create whisper state: {e}");
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

    let audio_secs = audio.len() as f32 / SAMPLE_RATE as f32;
    log::debug!("[{device_label}] Running whisper on {audio_secs:.1}s of audio ({} samples)", audio.len());

    if let Err(e) = state.full(params, audio) {
        log::error!("[{device_label}] Whisper inference failed: {e}");
        return None;
    }

    let n_segments = state.full_n_segments();
    log::debug!("[{device_label}] Whisper returned {n_segments} segments");
    let mut text = String::new();
    for i in 0..n_segments {
        let Some(segment) = state.get_segment(i) else {
            continue;
        };
        let Ok(seg) = segment.to_str() else {
            continue;
        };
        let seg = seg.trim();
        if !seg.is_empty() {
            if !text.is_empty() {
                text.push(' ');
            }
            text.push_str(seg);
        }
    }

    let text = text.trim().to_string();
    log::debug!("[{device_label}] Whisper result ({n_segments} segments): '{}'", text.chars().take(80).collect::<String>());

    if text.len() < 2 {
        return None;
    }

    // Filter common whisper artifacts
    let lower = text.to_lowercase();
    if lower.contains("[blank_audio]")
        || lower.contains("(blank audio)")
        || lower == "you"
        || lower == "the"
        || lower == "thank you."
        || (lower.starts_with('[') && lower.ends_with(']'))
    {
        return None;
    }

    Some(text)
}

fn whisper_cuda_backend_available() -> bool {
    unsafe {
        let ptr = whisper_rs_sys::whisper_print_system_info();
        if ptr.is_null() {
            return false;
        }
        let info = std::ffi::CStr::from_ptr(ptr).to_string_lossy().to_lowercase();
        info.contains("cuda = 1") || info.contains("cuda: 1")
    }
}

// ──────────────────────────── Whisper Stream Manager ────────────────────────────

pub struct WhisperStreamManager {
    running: Arc<AtomicBool>,
    threads: Vec<std::thread::JoinHandle<()>>,
    /// Live per-channel mute flags shared with the audio capture callbacks so a
    /// muted channel silently stops feeding audio without restarting the engine.
    mute_input: Arc<AtomicBool>,
    mute_output: Arc<AtomicBool>,
    /// Live per-channel audio-activity level (RMS, 0..1) so the UI can show a
    /// channel as actively receiving audio, independent of transcription finality.
    input_level: Arc<AtomicMutex<f32>>,
    output_level: Arc<AtomicMutex<f32>>,
}

impl WhisperStreamManager {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            threads: Vec::new(),
            mute_input: Arc::new(AtomicBool::new(false)),
            mute_output: Arc::new(AtomicBool::new(false)),
            input_level: Arc::new(AtomicMutex::new(0.0)),
            output_level: Arc::new(AtomicMutex::new(0.0)),
        }
    }

    pub fn set_mute(&self, channel: &str, muted: bool) {
        match channel {
            "input" => self.mute_input.store(muted, Ordering::Relaxed),
            "output" => self.mute_output.store(muted, Ordering::Relaxed),
            _ => {}
        }
    }

    pub fn input_level(&self) -> f32 {
        match self.input_level.lock() {
            Ok(g) => *g,
            Err(_) => 0.0,
        }
    }

    pub fn output_level(&self) -> f32 {
        match self.output_level.lock() {
            Ok(g) => *g,
            Err(_) => 0.0,
        }
    }

    pub fn input_muted(&self) -> bool {
        self.mute_input.load(Ordering::Relaxed)
    }

    pub fn output_muted(&self) -> bool {
        self.mute_output.load(Ordering::Relaxed)
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    pub fn start(
        &mut self,
        app: tauri::AppHandle,
        config: LocalWhisperConfig,
        transcript_buffer: Arc<tokio::sync::Mutex<TranscriptBuffer>>,
    ) -> Result<(), String> {
        if self.is_running() {
            return Err("Local transcription already running".to_string());
        }

        // Per-channel mute is a *live* soft-mute: the capture threads stay
        // running but a muted channel's samples are dropped before they reach
        // the transcript. This lets mute toggles take effect without a restart.
        self.mute_input.store(config.mute_input, Ordering::Relaxed);
        self.mute_output.store(config.mute_output, Ordering::Relaxed);

        // At least one capture device must be configured. Both channels can be
        // muted at start and unmuted live (mute is a soft-mute, not a restart).
        let has_input = config.input_device_name.is_some();
        let has_output = config.output_device_name.is_some();
        if !has_input && !has_output {
            return Err(
                "At least one of input or output must be configured for local capture.".to_string()
            );
        }

        // Silence verbose whisper.cpp token-by-token stderr output.
        silence_whisper_internal_logs();

        // Resolve engine models: Moonshine dir OR bundled/downloaded Whisper model
        let moonshine_dir = if config.use_moonshine {
            Some(crate::transcription::model_manager::resolve_moonshine_model_dir(&app)?)
        } else {
            None
        };
        let model_path_str = if config.use_moonshine {
            String::new() // unused on the Moonshine path
        } else {
            crate::transcription::model_manager::resolve_model_path(
                &app,
                config.whisper_model_id.as_deref(),
            )?
            .to_string_lossy()
            .to_string()
        };

        let vad_model_path = crate::transcription::model_manager::resolve_vad_model_path(&app)?;
        let vad_model_path_str = vad_model_path.to_string_lossy().to_string();

        let speaker_model_path = crate::transcription::model_manager::resolve_speaker_model_path(&app)?;
        let speaker_model_path_str = speaker_model_path.to_string_lossy().to_string();

        let running = Arc::new(AtomicBool::new(true));
        self.running = running.clone();

        // Ring buffers for input and output
        let input_ring = Arc::new(StdMutex::new(AudioRingBuffer::new()));
        let output_ring = Arc::new(StdMutex::new(AudioRingBuffer::new()));

        // Channel for inference results → coordinator
        let (tx, rx) = std::sync::mpsc::channel::<TranscriptionResult>();

        // ─── Audio Capture Threads ───
        // Both channels are always captured (when a device is configured); the
        // per-channel mute flag is checked live in the audio callback so a muted
        // channel stays silent without tearing down the engine.

        let input_mute_flag = self.mute_input.clone();
        let input_level_flag = self.input_level.clone();
        let input_thread = config.input_device_name.as_ref().map(|_| {
            spawn_capture_thread(
                config.input_device_name.clone(),
                false,
                input_ring.clone(),
                running.clone(),
                input_mute_flag,
                input_level_flag,
                "input",
            )
        });

        let output_mute_flag = self.mute_output.clone();
        let output_level_flag = self.output_level.clone();
        let output_thread = config.output_device_name.as_ref().map(|_| {
            spawn_capture_thread(
                config.output_device_name.clone(),
                true,
                output_ring.clone(),
                running.clone(),
                output_mute_flag,
                output_level_flag,
                "output",
            )
        });

        // ─── Inference Thread (VAD-gated utterance accumulation) ───
        let running_infer = running.clone();
        let interval_ms = config.inference_interval_ms;
        // Whether output audio is transcribed, after applying mute. Input audio
        // is always processed (its ring simply stays empty when muted).
        let has_output = has_output;

        let inference_thread = std::thread::spawn(move || {
            // ─── Build the STT engine (Moonshine or Whisper) ───
            let mut engine: SttEngine = if let Some(ref moon_dir) = moonshine_dir {
                // Moonshine (sherpa-onnx, int8): tiny footprint, very low latency.
                let cfg = sherpa_rs::moonshine::MoonshineConfig {
                    preprocessor: moon_dir.join("preprocess.onnx").to_string_lossy().to_string(),
                    encoder: moon_dir.join("encode.int8.onnx").to_string_lossy().to_string(),
                    uncached_decoder: moon_dir.join("uncached_decode.int8.onnx").to_string_lossy().to_string(),
                    cached_decoder: moon_dir.join("cached_decode.int8.onnx").to_string_lossy().to_string(),
                    tokens: moon_dir.join("tokens.txt").to_string_lossy().to_string(),
                    num_threads: Some(2),
                    ..Default::default()
                };
                match sherpa_rs::moonshine::MoonshineRecognizer::new(cfg) {
                    Ok(rec) => {
                        log::info!("Moonshine model loaded: {}", moon_dir.display());
                        SttEngine::Moonshine(rec)
                    }
                    Err(e) => {
                        log::error!("Failed to load Moonshine model from '{}': {e}", moon_dir.display());
                        return;
                    }
                }
            } else {
                // Load model bytes in Rust and initialize whisper from memory.
                // This avoids CRT file-descriptor issues in Windows debug GUI runs.
                let model_bytes = match std::fs::read(&model_path_str) {
                    Ok(bytes) => bytes,
                    Err(e) => {
                        log::error!("Failed to read whisper model file '{model_path_str}': {e}");
                        return;
                    }
                };

                let mut ctx_params = whisper_rs::WhisperContextParameters::default();
                let force_gpu = std::env::var("PRMPTR_FORCE_GPU")
                    .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
                    .unwrap_or(false);
                let request_gpu = config.prefer_gpu || force_gpu;
                if request_gpu {
                    if whisper_cuda_backend_available() {
                        ctx_params.use_gpu(true).flash_attn(true).gpu_device(0);
                        log::info!("Local whisper: GPU mode enabled");
                    } else {
                        log::warn!("Local whisper GPU requested, but CUDA backend unavailable; using CPU");
                    }
                }

                match whisper_rs::WhisperContext::new_from_buffer_with_params(
                    &model_bytes,
                    ctx_params,
                ) {
                    Ok(c) => {
                        log::info!("Whisper model loaded: {model_path_str}");
                        SttEngine::Whisper(c)
                    }
                    Err(e) => {
                        log::error!("Failed to load whisper model: {e}");
                        return;
                    }
                }
            };

            // Suppress CRT debug assertions from onnxruntime.dll before first sherpa call.
            // Pre-load onnxruntime so its CRT initializes with valid std handles (set by main),
            // then load debug-CRT DLLs to find and suppress their assertion popups.
            // This runs AFTER whisper model loading, so the debug CRT won't interfere with it.
            #[cfg(windows)]
            {
                extern "system" {
                    fn LoadLibraryA(name: *const u8) -> isize;
                    fn GetProcAddress(module: isize, name: *const u8) -> *const ();
                }

                unsafe {
                    // Force-load onnxruntime so its CRT initializes (with valid std handles set by main)
                    let ort = LoadLibraryA(b"onnxruntime.dll\0".as_ptr());
                    log::info!("Pre-load onnxruntime.dll: handle={ort}");

                    // Load debug-CRT DLLs and suppress their assertion dialogs.
                    // Using LoadLibraryA here is safe because whisper model is already loaded above.
                    type SetModeFn = unsafe extern "C" fn(i32, i32) -> i32;
                    for dll in [
                        b"ucrtbased.dll\0" as &[u8],
                        b"msvcr120d.dll\0",
                        b"msvcr140d.dll\0",
                        b"ucrtbase.dll\0",
                    ] {
                        let module = LoadLibraryA(dll.as_ptr());
                        if module == 0 { continue; }
                        let proc = GetProcAddress(module, b"_CrtSetReportMode\0".as_ptr());
                        if proc.is_null() { continue; }
                        let set_mode: SetModeFn = std::mem::transmute(proc);
                        set_mode(0, 2); // _CRT_WARN -> OutputDebugString
                        set_mode(1, 2); // _CRT_ERROR -> OutputDebugString
                        set_mode(2, 2); // _CRT_ASSERT -> OutputDebugString
                        log::info!("Suppressed CRT assertions on {:?}", std::str::from_utf8(dll));
                    }
                }
            }



            // Create per-device VAD + speaker tracker
            let input_vad = match SpeechDetector::new(&vad_model_path_str) {
                Ok(v) => v,
                Err(e) => {
                    log::error!("Failed to create input VAD: {e}");
                    return;
                }
            };
            let input_speaker = match SpeakerTracker::new(&speaker_model_path_str) {
                Ok(s) => s,
                Err(e) => {
                    log::error!("Failed to create input speaker tracker: {e}");
                    return;
                }
            };
            let mut input_state = DeviceInferState::new(input_vad, input_speaker, input_ring.lock().map(|b| b.total_written()).unwrap_or(0));

            let mut output_state = if has_output {
                let output_vad = match SpeechDetector::new(&vad_model_path_str) {
                    Ok(v) => v,
                    Err(e) => {
                        log::error!("Failed to create output VAD: {e}");
                        return;
                    }
                };
                let output_speaker = match SpeakerTracker::new(&speaker_model_path_str) {
                    Ok(s) => s,
                    Err(e) => {
                        log::error!("Failed to create output speaker tracker: {e}");
                        return;
                    }
                };
                Some(DeviceInferState::new(
                    output_vad,
                    output_speaker,
                    output_ring.lock().map(|b| b.total_written()).unwrap_or(0),
                ))
            } else {
                None
            };

            log::info!("VAD and speaker models loaded");

            let mut cycle_count: u64 = 0;

            // Helper: process one device for one cycle
            fn process_device(
                device_type: &str,
                ring: &Arc<StdMutex<AudioRingBuffer>>,
                state: &mut DeviceInferState,
                engine: &mut SttEngine,
                tx: &std::sync::mpsc::Sender<TranscriptionResult>,
                interval_ms: u64,
                cycle_count: u64,
            ) {
                // 1. Drain ALL audio that arrived since the last cycle.
                //    A fixed trailing window would silently drop samples
                //    whenever inference takes longer than the interval —
                //    which is exactly how sentence onsets used to vanish.
                let chunk = {
                    let buf = match ring.lock() {
                        Ok(b) => b,
                        Err(_) => return,
                    };
                    let (samples, watermark) = buf.read_new_since(state.read_watermark);
                    state.read_watermark = watermark;
                    samples
                };

                // 2. Maintain the rolling history (pre-chunk snapshot so the
                //    current chunk isn't double-counted when seeding).
                let preroll_snapshot: Vec<f32> = {
                    state.recent_history.extend_from_slice(&chunk);
                    let keep_from = state.recent_history.len().saturating_sub(HISTORY_SAMPLES);
                    if keep_from > 0 {
                        state.recent_history.drain(..keep_from);
                    }
                    // Audio older than the current chunk, if any survived
                    // the capacity cap.
                    let snapshot_end = state.recent_history.len().saturating_sub(chunk.len());
                    let snapshot = state.recent_history[..snapshot_end].to_vec();
                    // Utterance seeding only needs the last ~400ms
                    let tail = snapshot.len().saturating_sub(PREROLL_SAMPLES);
                    snapshot[tail..].to_vec()
                };

                if chunk.is_empty() {
                    if cycle_count % 20 == 0 {
                        log::debug!("[{device_type}] Ring buffer empty (cycle {cycle_count})");
                    }
                    return;
                }

                // 3. Feed to VAD
                state.vad.accept_waveform(&chunk);
                state.vad_fed_total += chunk.len() as u64;
                let is_speech = state.vad.is_speech();

                // Track speech state transitions
                if is_speech && !state.in_speech {
                    // Resume same utterance across short pauses; start new one after long silence.
                    if state.speech_accumulator.is_empty()
                        || state.silence_ms >= SILENCE_FINALIZE_MS
                    {
                        state.speech_started_at = Some(Utc::now().to_rfc3339());
                        state.current_partial_id = uuid::Uuid::new_v4().to_string();
                        state.speech_cycle_count = 0;
                        state.speech_accumulator.clear();
                        // Seed with pre-speech audio so first words survive
                        // VAD trigger lag.
                        state.speech_accumulator.extend_from_slice(&preroll_snapshot);
                        log::debug!("[{device_type}] Speech started (VAD) +{}ms preroll", preroll_snapshot.len() * 1000 / SAMPLE_RATE);
                    } else {
                        log::debug!("[{device_type}] Speech resumed after brief pause");
                    }
                    state.in_speech = true;
                    state.silence_ms = 0;
                }

                if is_speech {
                    state.speech_accumulator.extend_from_slice(&chunk);
                    state.speech_cycle_count += 1;
                    state.silence_ms = 0;
                }

                if !is_speech {
                    if state.in_speech {
                        state.in_speech = false;
                    }
                    if !state.speech_accumulator.is_empty() {
                        state.silence_ms += interval_ms as u32;
                    }
                }

                // Heartbeat every 10 cycles
                if cycle_count % 10 == 0 {
                    log::debug!(
                        "[{device_type}] Heartbeat cycle={cycle_count} speech={is_speech} in_speech={} cycles={} silence_ms={}",
                        state.in_speech,
                        state.speech_cycle_count,
                        state.silence_ms,
                    );
                }

                // 3. Process complete VAD segments. Silero trims segments at
                // its probability trigger, clipping soft sentence onsets —
                // prepend exact lead-in audio from the preroll window.
                while state.vad.has_segment() {
                    let segment = state.vad.pop_segment();
                    let audio_secs = segment.samples.len() as f32 / SAMPLE_RATE as f32;
                    log::debug!("[{device_type}] VAD segment: {audio_secs:.1}s ({} samples)", segment.samples.len());
                    let combined_audio =
                        combine_segment_with_lead_in(state, segment.start, &segment.samples);

                    if let Some(text) = engine.transcribe(&combined_audio, device_type) {
                        // Identify speaker on final segments
                        let (speaker_id, speaker_label) = state
                            .speaker_tracker
                            .identify_speaker(&segment.samples, SAMPLE_RATE as u32)
                            .map(|r| {
                                log::debug!(
                                    "[{device_type}] Speaker: {} (new={})",
                                    r.speaker_label, r.is_new_speaker
                                );
                                (Some(r.speaker_id), Some(r.speaker_label))
                            })
                            .unwrap_or((None, None));

                        let timestamp = state.speech_started_at.clone()
                            .unwrap_or_else(|| Utc::now().to_rfc3339());

                        log::debug!("[{device_type}] Emitting final: text='{}'", text.chars().take(60).collect::<String>());

                        let _ = tx.send(TranscriptionResult {
                            id: state.current_partial_id.clone(),
                            text,
                            is_final: true,
                            timestamp,
                            device_type: device_type.to_string(),
                            speaker_id,
                            speaker_label,
                        });
                    }

                    state.reset_speech();
                }

                // 3b. Fallback finalize: if VAD did not emit a segment but we observed
                // sustained silence after speech, emit a final from accumulated audio.
                if !state.in_speech
                    && !state.speech_accumulator.is_empty()
                    && state.silence_ms >= SILENCE_FINALIZE_MS
                {
                    let speech_secs = state.speech_accumulator.len() / SAMPLE_RATE;
                    if speech_secs >= MIN_FALLBACK_FINALIZE_SECS {
                        if let Some(text) = engine.transcribe(&state.speech_accumulator, device_type) {
                            let (speaker_id, speaker_label) = state
                                .speaker_tracker
                                .identify_speaker(&state.speech_accumulator, SAMPLE_RATE as u32)
                                .map(|r| (Some(r.speaker_id), Some(r.speaker_label)))
                                .unwrap_or((None, None));

                            let timestamp = state
                                .speech_started_at
                                .clone()
                                .unwrap_or_else(|| Utc::now().to_rfc3339());

                            let _ = tx.send(TranscriptionResult {
                                id: state.current_partial_id.clone(),
                                text,
                                is_final: true,
                                timestamp,
                                device_type: device_type.to_string(),
                                speaker_id,
                                speaker_label,
                            });
                        }
                    }
                    state.reset_speech();
                }

                // 4. Periodic partial emissions during ongoing speech
                if EMIT_PARTIAL_EVENTS
                    && state.in_speech
                    && state.speech_cycle_count > 0
                    && state.speech_cycle_count % PARTIAL_EMIT_INTERVAL == 0
                    && !state.speech_accumulator.is_empty()
                {
                    if let Some(text) = engine.transcribe(&state.speech_accumulator, device_type) {
                        let timestamp = state.speech_started_at.clone()
                            .unwrap_or_else(|| Utc::now().to_rfc3339());

                        log::debug!("[{device_type}] Emitting partial: text='{}'", text.chars().take(60).collect::<String>());

                        let _ = tx.send(TranscriptionResult {
                            id: state.current_partial_id.clone(),
                            text,
                            is_final: false,
                            timestamp,
                            device_type: device_type.to_string(),
                            speaker_id: None,
                            speaker_label: None,
                        });
                    }
                }

                // 5. Force split very long utterances to avoid over-grouping.
                if state.speech_accumulator.len() >= MAX_UTTERANCE_SECS * SAMPLE_RATE {
                    if let Some(text) = engine.transcribe(&state.speech_accumulator, device_type) {
                        let (speaker_id, speaker_label) = state
                            .speaker_tracker
                            .identify_speaker(&state.speech_accumulator, SAMPLE_RATE as u32)
                            .map(|r| (Some(r.speaker_id), Some(r.speaker_label)))
                            .unwrap_or((None, None));
                        let timestamp = state
                            .speech_started_at
                            .clone()
                            .unwrap_or_else(|| Utc::now().to_rfc3339());
                        let _ = tx.send(TranscriptionResult {
                            id: state.current_partial_id.clone(),
                            text,
                            is_final: true,
                            timestamp,
                            device_type: device_type.to_string(),
                            speaker_id,
                            speaker_label,
                        });
                    }
                    // Start a fresh utterance while capture continues.
                    state.current_partial_id = uuid::Uuid::new_v4().to_string();
                    state.speech_started_at = Some(Utc::now().to_rfc3339());
                    state.speech_cycle_count = 0;
                    state.speech_accumulator.clear();
                    state.silence_ms = 0;
                    state.in_speech = true;
                }
            }

            while running_infer.load(Ordering::Relaxed) {
                std::thread::sleep(std::time::Duration::from_millis(interval_ms));

                if !running_infer.load(Ordering::Relaxed) {
                    break;
                }

                cycle_count += 1;

                // Process input device
                process_device("input", &input_ring, &mut input_state, &mut engine, &tx, interval_ms, cycle_count);

                // Process output device
                if let Some(ref mut out_state) = output_state {
                    process_device("output", &output_ring, out_state, &mut engine, &tx, interval_ms, cycle_count);
                }
            }

            // Finalize: flush VADs and process remaining segments
            for (device_type, state) in std::iter::once(("input", &mut input_state))
                .chain(output_state.as_mut().map(|s| ("output", s)))
            {
                state.vad.flush();
                while state.vad.has_segment() {
                    let segment = state.vad.pop_segment();
                    let combined_audio =
                        combine_segment_with_lead_in(state, segment.start, &segment.samples);
                    if let Some(text) = engine.transcribe(&combined_audio, device_type) {
                        let (speaker_id, speaker_label) = state
                            .speaker_tracker
                            .identify_speaker(&segment.samples, SAMPLE_RATE as u32)
                            .map(|r| (Some(r.speaker_id), Some(r.speaker_label)))
                            .unwrap_or((None, None));
                        let timestamp = state.speech_started_at.clone()
                            .unwrap_or_else(|| Utc::now().to_rfc3339());
                        let _ = tx.send(TranscriptionResult {
                            id: state.current_partial_id.clone(),
                            text,
                            is_final: true,
                            timestamp,
                            device_type: device_type.to_string(),
                            speaker_id,
                            speaker_label,
                        });
                    }
                }
            }

            log::info!("Inference thread stopped");
        });

        // ─── Activity Emitter (tokio) ───
        // Publish live per-channel audio levels so the UI can show "active"
        // while real audio is flowing (independent of transcription finality).
        let app_activity = app.clone();
        let running_activity = running.clone();
        let input_level_activity = self.input_level.clone();
        let output_level_activity = self.output_level.clone();
        let input_mute_activity = self.mute_input.clone();
        let output_mute_activity = self.mute_output.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                if !running_activity.load(Ordering::Relaxed) {
                    break;
                }
                let input_level = match input_level_activity.lock() {
                    Ok(g) => *g,
                    Err(_) => 0.0,
                };
                let output_level = match output_level_activity.lock() {
                    Ok(g) => *g,
                    Err(_) => 0.0,
                };
                let payload = serde_json::json!({
                    "input_level": input_level,
                    "output_level": output_level,
                    "input_muted": input_mute_activity.load(Ordering::Relaxed),
                    "output_muted": output_mute_activity.load(Ordering::Relaxed),
                });
                let _ = app_activity.emit("local-transcription-activity", &payload);
                tokio::time::sleep(std::time::Duration::from_millis(120)).await;
            }
        });

        // ─── Coordinator Task (tokio) ───
        let app_handle = app.clone();
        let running_coord = running.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                if !running_coord.load(Ordering::Relaxed) {
                    break;
                }

                match rx.recv_timeout(std::time::Duration::from_millis(100)) {
                    Ok(result) => {
                        let one_line = result.text.replace('\n', " ");
                        log::info!(
                            "[rt-local-transcription] id={} final={} device={} ts={} text=\"{}\"",
                            result.id,
                            result.is_final,
                            result.device_type,
                            result.timestamp,
                            one_line
                        );
                        let _ = app_handle.emit("local-transcription", &result);

                        if result.is_final {
                            let entry = TranscriptEntry {
                                id: result.id,
                                text: result.text,
                                timestamp: Utc::now(),
                                source: "local-whisper".to_string(),
                                speaker: result.speaker_id,
                                is_final: true,
                            };
                            let mut buf = transcript_buffer.lock().await;
                            buf.push(entry);
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        // Worker threads died unexpectedly — surface it to the
                        // UI instead of leaving "running" state stuck on.
                        if running_coord.load(Ordering::Relaxed) {
                            let _ = app_handle.emit(
                                "local-transcription-status",
                                serde_json::json!({
                                    "mode": "local-whisper",
                                    "running": false,
                                    "error": "Local transcription worker stopped unexpectedly",
                                }),
                            );
                        }
                        break;
                    }
                }
            }
            log::info!("Coordinator task stopped");
        });

        if let Some(t) = input_thread {
            self.threads.push(t);
        }
        if let Some(t) = output_thread {
            self.threads.push(t);
        }
        self.threads.push(inference_thread);

        log::info!("Local whisper transcription started");
        Ok(())
    }

    pub fn stop(&mut self) {
        if !self.is_running() {
            return;
        }

        self.running.store(false, Ordering::Relaxed);

        for t in self.threads.drain(..) {
            let _ = t.join();
        }

        log::info!("Local whisper transcription stopped");
    }
}


