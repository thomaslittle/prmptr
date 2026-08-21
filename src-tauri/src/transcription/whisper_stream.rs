use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use chrono::Utc;
use std::sync::Once;

use crate::transcription::transcript::{TranscriptBuffer, TranscriptEntry};
use crate::transcription::speaker::{SpeechDetector, SpeakerTracker};

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
}

impl AudioRingBuffer {
    pub fn new() -> Self {
        Self {
            data: vec![0.0; BUFFER_CAPACITY],
            write_pos: 0,
            len: 0,
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
    pub inference_interval_ms: u64,
}

impl Default for LocalWhisperConfig {
    fn default() -> Self {
        Self {
            input_device_name: None,
            output_device_name: None,
            whisper_model_id: None,
            prefer_gpu: false,
            // Reduce CPU churn in local mode.
            inference_interval_ms: 1200,
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

// ──────────────────────────── Audio Capture ────────────────────────────

/// Spawn a capture thread for a given device. For output devices, this uses
/// WASAPI loopback on Windows.
fn spawn_capture_thread(
    device_name: Option<String>,
    is_output: bool,
    ring_buffer: Arc<StdMutex<AudioRingBuffer>>,
    running: Arc<AtomicBool>,
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

        let stream_config: cpal::StreamConfig = supported_config.into();

        // Build the stream. For output devices on Windows (WASAPI), build_input_stream
        // on an output device creates a loopback capture stream.
        let stream = device.build_input_stream(
            &stream_config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                if !running_cb.load(Ordering::Relaxed) {
                    return;
                }
                let mono = if native_channels > 1 {
                    stereo_to_mono(data)
                } else {
                    data.to_vec()
                };
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

/// How many 16kHz samples correspond to one inference cycle (800ms)
const SAMPLES_PER_CYCLE: usize = 800 * SAMPLE_RATE / 1000; // 12,800

/// Emit an interim partial every N speech cycles so the UI shows progress
const PARTIAL_EMIT_INTERVAL: u32 = 2; // ~1.6s
const EMIT_PARTIAL_EVENTS: bool = false;
const SILENCE_FINALIZE_CYCLES: u32 = 2; // ~1.6s of silence fallback finalize
const MAX_UTTERANCE_SECS: usize = 9; // force split very long utterances
const MIN_FALLBACK_FINALIZE_SECS: usize = 1; // avoid tiny accidental finalize

struct DeviceInferState {
    vad: SpeechDetector,
    speaker_tracker: SpeakerTracker,
    /// Accumulated audio for partial emissions during ongoing speech
    speech_accumulator: Vec<f32>,
    current_partial_id: String,
    speech_started_at: Option<String>,
    speech_cycle_count: u32,
    silence_cycle_count: u32,
    in_speech: bool,
}

impl DeviceInferState {
    fn new(vad: SpeechDetector, speaker_tracker: SpeakerTracker) -> Self {
        Self {
            vad,
            speaker_tracker,
            speech_accumulator: Vec::new(),
            current_partial_id: uuid::Uuid::new_v4().to_string(),
            speech_started_at: None,
            speech_cycle_count: 0,
            silence_cycle_count: 0,
            in_speech: false,
        }
    }

    fn reset_speech(&mut self) {
        self.speech_accumulator.clear();
        self.current_partial_id = uuid::Uuid::new_v4().to_string();
        self.speech_started_at = None;
        self.speech_cycle_count = 0;
        self.silence_cycle_count = 0;
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
}

impl WhisperStreamManager {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            threads: Vec::new(),
        }
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

        // Silence verbose whisper.cpp token-by-token stderr output.
        silence_whisper_internal_logs();

        // Resolve bundled models
        let model_path = crate::transcription::model_manager::resolve_model_path(
            &app,
            config.whisper_model_id.as_deref(),
        )?;
        let model_path_str = model_path.to_string_lossy().to_string();

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

        // Input device (microphone — "You")
        let input_thread = spawn_capture_thread(
            config.input_device_name.clone(),
            false,
            input_ring.clone(),
            running.clone(),
            "input",
        );

        // Output device (loopback — "Them")
        let output_thread = if config.output_device_name.is_some() {
            Some(spawn_capture_thread(
                config.output_device_name.clone(),
                true,
                output_ring.clone(),
                running.clone(),
                "output",
            ))
        } else {
            log::info!("No output device configured, skipping loopback capture");
            None
        };

        // ─── Inference Thread (VAD-gated utterance accumulation) ───
        let running_infer = running.clone();
        let interval_ms = config.inference_interval_ms;
        let has_output = config.output_device_name.is_some();

        let inference_thread = std::thread::spawn(move || {
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

            let ctx = match whisper_rs::WhisperContext::new_from_buffer_with_params(
                &model_bytes,
                ctx_params,
            ) {
                Ok(c) => c,
                Err(e) => {
                    log::error!("Failed to load whisper model: {e}");
                    return;
                }
            };

            log::info!("Whisper model loaded: {model_path_str}");

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
            let mut input_state = DeviceInferState::new(input_vad, input_speaker);

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
                Some(DeviceInferState::new(output_vad, output_speaker))
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
                ctx: &whisper_rs::WhisperContext,
                tx: &std::sync::mpsc::Sender<TranscriptionResult>,
                cycle_count: u64,
            ) {
                // 1. Read chunk from ring buffer
                let chunk = {
                    let buf = match ring.lock() {
                        Ok(b) => b,
                        Err(_) => return,
                    };
                    buf.read_last_n(SAMPLES_PER_CYCLE)
                };

                if chunk.is_empty() {
                    if cycle_count % 10 == 0 {
                        log::debug!("[{device_type}] Ring buffer empty (cycle {cycle_count})");
                    }
                    return;
                }

                // 2. Feed to VAD
                state.vad.accept_waveform(&chunk);
                let is_speech = state.vad.is_speech();

                // Track speech state transitions
                if is_speech && !state.in_speech {
                    // Resume same utterance across short pauses; start new one after long silence.
                    if state.speech_accumulator.is_empty()
                        || state.silence_cycle_count >= SILENCE_FINALIZE_CYCLES
                    {
                        state.speech_started_at = Some(Utc::now().to_rfc3339());
                        state.current_partial_id = uuid::Uuid::new_v4().to_string();
                        state.speech_cycle_count = 0;
                        state.speech_accumulator.clear();
                        log::debug!("[{device_type}] Speech started (VAD)");
                    } else {
                        log::debug!("[{device_type}] Speech resumed after brief pause");
                    }
                    state.in_speech = true;
                    state.silence_cycle_count = 0;
                }

                if is_speech {
                    state.speech_accumulator.extend_from_slice(&chunk);
                    state.speech_cycle_count += 1;
                    state.silence_cycle_count = 0;
                }

                if !is_speech {
                    if state.in_speech {
                        state.in_speech = false;
                    }
                    if !state.speech_accumulator.is_empty() {
                        state.silence_cycle_count += 1;
                    }
                }

                // Heartbeat every 10 cycles
                if cycle_count % 10 == 0 {
                    log::debug!(
                        "[{device_type}] Heartbeat cycle={cycle_count} speech={is_speech} in_speech={} cycles={}",
                        state.in_speech,
                        state.speech_cycle_count,
                    );
                }

                // 3. Process complete VAD segments
                while state.vad.has_segment() {
                    let segment = state.vad.pop_segment();
                    let audio_secs = segment.samples.len() as f32 / SAMPLE_RATE as f32;
                    log::debug!("[{device_type}] VAD segment: {audio_secs:.1}s ({} samples)", segment.samples.len());

                    if let Some(text) = run_whisper(ctx, &segment.samples, device_type) {
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
                    && state.silence_cycle_count >= SILENCE_FINALIZE_CYCLES
                {
                    let speech_secs = state.speech_accumulator.len() / SAMPLE_RATE;
                    if speech_secs >= MIN_FALLBACK_FINALIZE_SECS {
                        if let Some(text) = run_whisper(ctx, &state.speech_accumulator, device_type) {
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
                    if let Some(text) = run_whisper(ctx, &state.speech_accumulator, device_type) {
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
                    if let Some(text) = run_whisper(ctx, &state.speech_accumulator, device_type) {
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
                    state.silence_cycle_count = 0;
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
                process_device("input", &input_ring, &mut input_state, &ctx, &tx, cycle_count);

                // Process output device
                if let Some(ref mut out_state) = output_state {
                    process_device("output", &output_ring, out_state, &ctx, &tx, cycle_count);
                }
            }

            // Finalize: flush VADs and process remaining segments
            for (device_type, state) in std::iter::once(("input", &mut input_state))
                .chain(output_state.as_mut().map(|s| ("output", s)))
            {
                state.vad.flush();
                while state.vad.has_segment() {
                    let segment = state.vad.pop_segment();
                    if let Some(text) = run_whisper(&ctx, &segment.samples, device_type) {
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

        self.threads.push(input_thread);
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

