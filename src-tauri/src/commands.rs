use tauri::{State, Emitter, Manager};
use std::sync::Arc;
use std::sync::{Mutex as StdMutex, OnceLock};
use tokio::sync::Mutex;
use base64::Engine;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;
use crate::session::manager::{SessionConfig, SessionManager, SessionStats};
use crate::transcription::transcript::TranscriptBuffer;
use crate::transcription::model_manager::{SttModelInfo, SttModelSpec};
use futures_util::StreamExt;

// ──────────────────────────── Native Audio Device Enumeration ────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct AudioDevice {
    pub name: String,
    pub is_default: bool,
}

#[tauri::command]
pub async fn list_system_audio_devices() -> Result<Vec<AudioDevice>, String> {
    tokio::task::spawn_blocking(|| {
        use cpal::traits::HostTrait;
        let host = cpal::default_host();
        let default_input = host
            .default_input_device()
            .and_then(|d| crate::audio_device::device_name(&d));
        let default_output = host
            .default_output_device()
            .and_then(|d| crate::audio_device::device_name(&d));
        let mut devices = Vec::new();
        if let Ok(inputs) = host.input_devices() {
            for dev in inputs {
                if let Some(name) = crate::audio_device::device_name(&dev) {
                    let display_name = format!("{} (input)", name);
                    devices.push(AudioDevice {
                        name: display_name,
                        is_default: default_input.as_ref() == Some(&name),
                    });
                }
            }
        }
        if let Ok(outputs) = host.output_devices() {
            for dev in outputs {
                if let Some(name) = crate::audio_device::device_name(&dev) {
                    let display_name = format!("{} (output)", name);
                    devices.push(AudioDevice {
                        name: display_name,
                        is_default: default_output.as_ref() == Some(&name),
                    });
                }
            }
        }
        devices.dedup_by(|a, b| a.name == b.name);
        Ok(devices)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ──────────────────────────── Session Commands ────────────────────────────

#[tauri::command]
pub async fn start_session(
    session: State<'_, Arc<Mutex<SessionManager>>>,
    config: SessionConfig,
) -> Result<(), String> {
    let mut mgr = session.lock().await;
    mgr.start(config);
    Ok(())
}

#[tauri::command]
pub async fn end_session(
    session: State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<Option<SessionStats>, String> {
    let mut mgr = session.lock().await;
    Ok(mgr.end())
}

#[tauri::command]
pub async fn get_session_config(
    session: State<'_, Arc<Mutex<SessionManager>>>,
) -> Result<SessionConfig, String> {
    let mgr = session.lock().await;
    Ok(mgr.config.clone())
}

// ──────────────────────────── Transcript Commands ────────────────────────────

#[tauri::command]
pub async fn get_transcript(
    transcript: State<'_, Arc<Mutex<TranscriptBuffer>>>,
) -> Result<String, String> {
    let buf = transcript.lock().await;
    Ok(buf.formatted_text())
}

#[tauri::command]
pub async fn clear_transcript(
    transcript: State<'_, Arc<Mutex<TranscriptBuffer>>>,
) -> Result<(), String> {
    let mut buf = transcript.lock().await;
    buf.clear();
    Ok(())
}

// ──────────────────────────── LLM Commands ────────────────────────────

fn openai_compatible_base(provider: &str) -> Option<&'static str> {
    match provider {
        "openai" => Some("https://api.openai.com/v1"),
        "groq" => Some("https://api.groq.com/openai/v1"),
        "cerebras" => Some("https://api.cerebras.ai/v1"),
        // OpenCode Zen exposes an OpenAI-compatible /v1 surface.
        "zen" => Some("https://opencode.ai/zen/v1"),
        _ => None,
    }
}

fn normalize_lmstudio_base(base_url: Option<String>) -> String {
    let raw = base_url.unwrap_or_else(|| "http://localhost:1234/v1".to_string());
    let trimmed = raw.trim().trim_end_matches('/').to_string();
    if trimmed.ends_with("/v1") {
        trimmed
    } else {
        format!("{trimmed}/v1")
    }
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))
}

async fn validate_openai_compatible(base: &str, api_key: &str) -> Result<bool, String> {
    let mut req = http_client()?.get(format!("{base}/models"));
    req = req.header(reqwest::header::AUTHORIZATION, format!("Bearer {api_key}"));
    let resp = req.send().await.map_err(|e| format!("Validation failed: {e}"))?;
    Ok(resp.status().is_success())
}

#[tauri::command]
pub async fn validate_api_key(
    provider: String,
    api_key: String,
    base_url: Option<String>,
) -> Result<bool, String> {
    match provider.as_str() {
        "anthropic" => {
            // Listing models is free and model-agnostic, unlike a test message.
            let resp = http_client()?
                .get("https://api.anthropic.com/v1/models")
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .send()
                .await
                .map_err(|e| format!("Validation failed: {e}"))?;
            Ok(resp.status().is_success())
        }
        "openai" | "groq" | "cerebras" | "zen" => {
            validate_openai_compatible(openai_compatible_base(&provider).unwrap(), &api_key).await
        }
        "lmstudio" => {
            let base = normalize_lmstudio_base(base_url);
            let resp = http_client()?
                .get(format!("{base}/models"))
                .send()
                .await
                .map_err(|e| format!("Validation failed: {e}"))?;
            Ok(resp.status().is_success())
        }
        _ => Err(format!("Unknown provider: {provider}")),
    }
}

#[tauri::command]
pub async fn fetch_lmstudio_models(
    base_url: Option<String>,
) -> Result<Vec<String>, String> {
    let base = normalize_lmstudio_base(base_url);
    let resp = http_client()?
        .get(format!("{base}/models"))
        .send()
        .await
        .map_err(|e| format!("Failed to list models: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse models: {e}"))?;
    Ok(data
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|id| id.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default())
}

// ──────────────────────────── Local Transcription Commands ────────────────────────────

type LocalSttState<'a> = State<'a, Arc<Mutex<crate::transcription::local_stream::LocalSttManager>>>;

#[tauri::command]
pub async fn start_local_transcription(
    app: tauri::AppHandle,
    stt: LocalSttState<'_>,
    transcript: State<'_, Arc<Mutex<TranscriptBuffer>>>,
    input_device_name: Option<String>,
    output_device_name: Option<String>,
    model_id: Option<String>,
    prefer_gpu: Option<bool>,
    mute_input: Option<bool>,
    mute_output: Option<bool>,
    glossary: Option<Vec<String>>,
) -> Result<(), String> {
    if input_device_name.is_none() && output_device_name.is_none() {
        return Err("Select a microphone or system-audio device in Settings → Capture first.".to_string());
    }
    if stt.lock().await.is_running() {
        return Err("Local transcription already running".to_string());
    }

    // Load the model off the async runtime (mmap + session setup can take a
    // second or two) and surface failures to the caller instead of a worker
    // thread silently dying.
    let (spec, path) =
        crate::transcription::model_manager::resolve_stt_model(&app, model_id.as_deref())?;
    let prefer_gpu = prefer_gpu.unwrap_or(false);
    let engine = tauri::async_runtime::spawn_blocking(move || {
        crate::transcription::stt_engine::SttEngine::load(spec, &path, prefer_gpu, &glossary.unwrap_or_default())
    })
    .await
    .map_err(|e| format!("Speech model loader crashed: {e}"))??;

    let config = crate::transcription::local_stream::LocalSttConfig {
        input_device_name,
        output_device_name,
        mute_input: mute_input.unwrap_or(false),
        mute_output: mute_output.unwrap_or(false),
        ..Default::default()
    };

    let mut mgr = stt.lock().await;
    mgr.start(app, config, engine, transcript.inner().clone())
}

#[tauri::command]
pub async fn stop_local_transcription(stt: LocalSttState<'_>) -> Result<(), String> {
    let manager = stt.inner().clone();
    // Joining capture/inference threads can block for an in-flight utterance;
    // keep it off the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(async move { manager.lock().await.stop() })
    })
    .await
    .map_err(|e| format!("Failed to stop transcription: {e}"))
}

/// Live per-channel mute: flips the shared flag the capture callbacks check, so
/// a muted channel silently stops feeding the transcript without restarting.
#[tauri::command]
pub async fn set_local_mute(stt: LocalSttState<'_>, channel: String, muted: bool) -> Result<(), String> {
    let mgr = stt.lock().await;
    mgr.set_mute(&channel, muted);
    Ok(())
}

#[tauri::command]
pub async fn get_local_activity(stt: LocalSttState<'_>) -> Result<serde_json::Value, String> {
    let mgr = stt.lock().await;
    Ok(serde_json::json!({
        "input_level": mgr.input_level(),
        "output_level": mgr.output_level(),
        "input_muted": mgr.input_muted(),
        "output_muted": mgr.output_muted(),
        "running": mgr.is_running(),
    }))
}

#[tauri::command]
pub async fn start_direct_deepgram_transcription(
    app: tauri::AppHandle,
    deepgram: State<'_, Arc<Mutex<crate::transcription::deepgram_stream::DirectDeepgramStreamManager>>>,
    input_device_name: Option<String>,
    output_device_name: Option<String>,
    api_key: String,
    mute_input: Option<bool>,
    mute_output: Option<bool>,
) -> Result<(), String> {
    let config = crate::transcription::deepgram_stream::DirectDeepgramConfig {
        input_device_name,
        output_device_name,
        api_key,
        mute_input: mute_input.unwrap_or(false),
        mute_output: mute_output.unwrap_or(false),
    };
    let mut mgr = deepgram.lock().await;
    mgr.start(app, config)
}

#[tauri::command]
pub async fn update_direct_deepgram_transcription(
    app: tauri::AppHandle,
    deepgram: State<'_, Arc<Mutex<crate::transcription::deepgram_stream::DirectDeepgramStreamManager>>>,
    input_device_name: Option<String>,
    output_device_name: Option<String>,
    api_key: String,
    mute_input: Option<bool>,
    mute_output: Option<bool>,
) -> Result<(), String> {
    let config = crate::transcription::deepgram_stream::DirectDeepgramConfig {
        input_device_name,
        output_device_name,
        api_key,
        mute_input: mute_input.unwrap_or(false),
        mute_output: mute_output.unwrap_or(false),
    };

    // Mirror DirectDeepgramStreamManager::start constraints:
    // if both sides are effectively muted/unavailable, treat as a valid "paused" state.
    let has_input = !config.mute_input;
    let has_output = config.output_device_name.is_some() && !config.mute_output;
    let mut mgr = deepgram.lock().await;

    if !has_input && !has_output {
        if mgr.is_running() {
            mgr.stop();
        }
        return Ok(());
    }

    if mgr.is_running() {
        mgr.stop();
        return mgr.start(app, config);
    }
    mgr.start(app, config)
}

#[tauri::command]
pub async fn stop_direct_deepgram_transcription(
    deepgram: State<'_, Arc<Mutex<crate::transcription::deepgram_stream::DirectDeepgramStreamManager>>>,
) -> Result<(), String> {
    let mut mgr = deepgram.lock().await;
    mgr.stop();
    Ok(())
}

/// Live per-channel mute for direct Deepgram — flips the shared capture flag so
/// a muted channel stops feeding audio without restarting the stream.
#[tauri::command]
pub async fn set_deepgram_mute(
    deepgram: State<'_, Arc<Mutex<crate::transcription::deepgram_stream::DirectDeepgramStreamManager>>>,
    channel: String,
    muted: bool,
) -> Result<(), String> {
    let mgr = deepgram.lock().await;
    mgr.set_mute(&channel, muted);
    Ok(())
}

#[derive(Clone, Serialize)]
pub struct ComputeDevice {
    pub kind: String,
    pub name: String,
    pub is_gpu: bool,
}

#[derive(Clone, Serialize)]
pub struct LocalGpuStatus {
    /// A GPU device is usable by the speech engine in this build.
    pub can_use_gpu: bool,
    /// GPU backends compiled into this build (e.g. "vulkan", "cuda").
    pub gpu_backends: Vec<String>,
    pub devices: Vec<ComputeDevice>,
    pub message: String,
}

#[tauri::command]
pub fn get_local_transcription_gpu_status() -> Result<LocalGpuStatus, String> {
    let devices: Vec<ComputeDevice> = crate::transcription::stt_engine::available_devices()
        .into_iter()
        .map(|(kind, name, is_gpu)| ComputeDevice { kind, name, is_gpu })
        .collect();
    let gpu_backends: Vec<String> = [
        (cfg!(feature = "vulkan"), "vulkan"),
        (cfg!(feature = "cuda"), "cuda"),
    ]
    .iter()
    .filter(|(on, _)| *on)
    .map(|(_, name)| name.to_string())
    .collect();
    let can_use_gpu = devices.iter().any(|d| d.is_gpu);
    let message = if can_use_gpu {
        let gpu = devices.iter().find(|d| d.is_gpu).map(|d| d.name.clone()).unwrap_or_default();
        format!("GPU acceleration available ({gpu}).")
    } else if gpu_backends.is_empty() {
        "This build runs speech recognition on the CPU — Parakeet is still many times faster than real time on any modern processor.".to_string()
    } else {
        format!(
            "Built with {} support, but no compatible GPU was found. Using the CPU.",
            gpu_backends.join("/")
        )
    };
    Ok(LocalGpuStatus { can_use_gpu, gpu_backends, devices, message })
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    // Only allow plain web links — never arbitrary URI schemes (file:, ms-*:, etc.)
    let parsed = url::Url::parse(&url).map_err(|_| "Invalid URL".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Only http(s) URLs can be opened".to_string());
    }
    open::that(parsed.as_str()).map_err(|e| format!("Failed to open URL: {e}"))?;
    Ok(())
}

#[derive(Clone, Serialize)]
pub struct TtsProxyResponse {
    pub audio_base64: Option<String>,
    pub mime: Option<String>,
    pub json: Option<serde_json::Value>,
}

const LOCAL_SHERPA_ENDPOINT_PREFIX: &str = "local://sherpa";
const SHERPA_KOKORO_ARCHIVE_URL: &str = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2";
static LOCAL_SHERPA_ENGINE: OnceLock<StdMutex<LocalSherpaEngine>> = OnceLock::new();

struct LocalSherpaEngine {
    tts: sherpa_rs::tts::KokoroTts,
    model_dir: PathBuf,
}

fn local_sherpa_voice_ids() -> Vec<String> {
    vec![
        // The bundled kokoro-en-v0_19 archive used here exposes 11 speakers (sid 0..10).
        "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore",
        "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

fn sherpa_voice_sid(voice: &str) -> i32 {
    let voices = local_sherpa_voice_ids();
    let sid = voices
        .iter()
        .position(|v| v == voice)
        .map(|idx| idx as i32)
        .unwrap_or(0);
    sid.clamp(0, 10)
}

fn encode_wav_pcm16(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let channels: u16 = 1;
    let bits_per_sample: u16 = 16;
    let bytes_per_sample = (bits_per_sample / 8) as usize;
    let data_len = samples.len() * bytes_per_sample;
    let riff_chunk_size = 36 + data_len as u32;
    let byte_rate = sample_rate * channels as u32 * bits_per_sample as u32 / 8;
    let block_align = channels * bits_per_sample / 8;

    let mut out = Vec::with_capacity(44 + data_len);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&riff_chunk_size.to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // PCM fmt chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM format
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&bits_per_sample.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data_len as u32).to_le_bytes());
    for &s in samples {
        let clamped = s.clamp(-1.0, 1.0);
        let v = (clamped * i16::MAX as f32) as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

fn has_kokoro_files(dir: &Path) -> bool {
    dir.join("model.onnx").exists()
        && dir.join("voices.bin").exists()
        && dir.join("tokens.txt").exists()
}

fn find_kokoro_model_dir(root: &Path) -> Option<PathBuf> {
    if !root.exists() {
        return None;
    }
    if has_kokoro_files(root) {
        return Some(root.to_path_buf());
    }
    let mut stack = vec![root.to_path_buf()];
    while let Some(current) = stack.pop() {
        let entries = match std::fs::read_dir(&current) {
            Ok(v) => v,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if has_kokoro_files(&path) {
                    return Some(path);
                }
                stack.push(path);
            }
        }
    }
    None
}

async fn ensure_sherpa_kokoro_assets(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    let root_dir = app_data_dir.join("sherpa-tts");
    std::fs::create_dir_all(&root_dir).map_err(|e| format!("Failed to create TTS dir: {e}"))?;

    if let Some(found) = find_kokoro_model_dir(&root_dir) {
        return Ok(found);
    }

    let archive_path = root_dir.join("kokoro-en-v0_19.tar.bz2");
    if !archive_path.exists() {
        let client = reqwest::Client::builder()
            .user_agent("prmptr-sherpa-tts-downloader")
            .connect_timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| format!("HTTP client error: {e}"))?;
        let response = client
            .get(SHERPA_KOKORO_ARCHIVE_URL)
            .send()
            .await
            .map_err(|e| format!("Failed to download sherpa TTS model archive: {e}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "Failed to download sherpa TTS model archive (status: {})",
                response.status()
            ));
        }
        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Failed reading sherpa TTS archive: {e}"))?;
        std::fs::write(&archive_path, &bytes)
            .map_err(|e| format!("Failed writing sherpa TTS archive: {e}"))?;
    }

    let archive_path_clone = archive_path.clone();
    let root_dir_clone = root_dir.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        let status = std::process::Command::new("tar")
            .arg("-xjf")
            .arg(&archive_path_clone)
            .arg("-C")
            .arg(&root_dir_clone)
            .status()
            .map_err(|e| format!("Failed to run tar for sherpa model extraction: {e}"))?;
        if !status.success() {
            return Err(format!(
                "Failed to extract sherpa TTS model archive (tar exit code: {status})"
            ));
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("Failed waiting for sherpa extraction task: {e}"))??;

    find_kokoro_model_dir(&root_dir).ok_or_else(|| {
        "Sherpa TTS model extracted, but model files were not found (model.onnx/voices.bin/tokens.txt)".to_string()
    })
}

async fn synthesize_local_sherpa_tts(
    app: &tauri::AppHandle,
    text: &str,
    voice: &str,
    rate: f32,
) -> Result<TtsProxyResponse, String> {
    let model_dir = ensure_sherpa_kokoro_assets(app).await?;
    let sid = sherpa_voice_sid(voice);
    let model_dir_owned = model_dir.clone();
    let text_owned = text.to_string();

    let build_tts = |dir: &Path| -> Result<sherpa_rs::tts::KokoroTts, String> {
        let model_path = dir.join("model.onnx");
        let voices_path = dir.join("voices.bin");
        let tokens_path = dir.join("tokens.txt");
        let data_dir = dir.join("espeak-ng-data");
        let model_str = model_path.to_string_lossy().to_string();
        let voices_str = voices_path.to_string_lossy().to_string();
        let tokens_str = tokens_path.to_string_lossy().to_string();
        let data_dir_str = if data_dir.exists() {
            data_dir.to_string_lossy().to_string()
        } else {
            String::new()
        };
        Ok(sherpa_rs::tts::KokoroTts::new(sherpa_rs::tts::KokoroTtsConfig {
            model: model_str,
            voices: voices_str,
            tokens: tokens_str,
            data_dir: data_dir_str,
            dict_dir: String::new(),
            lexicon: String::new(),
            length_scale: 1.0,
            lang: "en-us".to_string(),
            ..Default::default()
        }))
    };

    let audio = tokio::task::spawn_blocking(move || -> Result<(Vec<f32>, u32), String> {
        if LOCAL_SHERPA_ENGINE.get().is_none() {
            let tts = build_tts(&model_dir_owned)?;
            let _ = LOCAL_SHERPA_ENGINE.set(StdMutex::new(LocalSherpaEngine {
                tts,
                model_dir: model_dir_owned.clone(),
            }));
        }
        let lock = LOCAL_SHERPA_ENGINE
            .get()
            .ok_or_else(|| "Failed to initialize local Sherpa TTS engine".to_string())?;
        let mut engine = lock
            .lock()
            .map_err(|_| "Local Sherpa TTS engine lock poisoned".to_string())?;
        if engine.model_dir != model_dir_owned {
            engine.tts = build_tts(&model_dir_owned)?;
            engine.model_dir = model_dir_owned.clone();
        }
        let out = engine
            .tts
            .create(&text_owned, sid, rate)
            .map_err(|e| format!("Sherpa TTS synthesis failed: {e}"))?;
        Ok((out.samples, out.sample_rate))
    })
    .await
    .map_err(|e| format!("Failed waiting for Sherpa TTS task: {e}"))??;

    let wav = encode_wav_pcm16(&audio.0, audio.1);
    Ok(TtsProxyResponse {
        audio_base64: Some(base64::engine::general_purpose::STANDARD.encode(wav)),
        mime: Some("audio/wav".to_string()),
        json: None,
    })
}

fn with_tts_auth(
    builder: reqwest::RequestBuilder,
    api_key: Option<&str>,
) -> reqwest::RequestBuilder {
    if let Some(key) = api_key.filter(|k| !k.trim().is_empty()) {
        let key = key.trim();
        builder
            .header(reqwest::header::AUTHORIZATION, format!("Bearer {key}"))
            .header("x-api-key", key)
    } else {
        builder
    }
}

async fn parse_tts_http_response(response: reqwest::Response) -> Result<TtsProxyResponse, String> {
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let content_type_lower = content_type.to_lowercase();
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed reading TTS response: {e}"))?;

    // HTML means we likely hit a website page instead of the TTS API route.
    if content_type_lower.contains("text/html") {
        let head = String::from_utf8_lossy(&bytes[..bytes.len().min(200)]).to_string();
        return Err(format!(
            "TTS endpoint returned HTML (likely wrong route). Use /api/v1/audio/speech. Response head: {head}"
        ));
    }

    // Many OpenAI-compatible TTS servers return raw audio as application/octet-stream.
    if content_type_lower.starts_with("audio/")
        || content_type_lower.contains("octet-stream")
        || content_type_lower.contains("mpeg")
        || content_type_lower.contains("wav")
    {
        let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
        return Ok(TtsProxyResponse {
            audio_base64: Some(encoded),
            mime: Some(if content_type.is_empty() { "audio/mpeg".to_string() } else { content_type }),
            json: None,
        });
    }

    // Prefer JSON parsing when indicated, but gracefully fallback to raw audio bytes.
    if content_type_lower.contains("json") {
        match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(json) => {
                return Ok(TtsProxyResponse {
                    audio_base64: None,
                    mime: None,
                    json: Some(json),
                });
            }
            Err(_) => {
                // Misconfigured servers may return raw audio but set application/json.
                let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
                return Ok(TtsProxyResponse {
                    audio_base64: Some(encoded),
                    mime: Some("audio/mpeg".to_string()),
                    json: None,
                });
            }
        }
    }

    // Unknown content-type: detect and reject accidental HTML fallback pages.
    let sniff = String::from_utf8_lossy(&bytes[..bytes.len().min(80)]).to_lowercase();
    if sniff.contains("<!doctype html") || sniff.contains("<html") {
        return Err("TTS endpoint returned HTML page. Use an API route like /api/v1/audio/speech".to_string());
    }

    // Unknown content-type: treat as audio to maximize compatibility with TTS services.
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(TtsProxyResponse {
        audio_base64: Some(encoded),
        mime: Some(if content_type.is_empty() { "audio/mpeg".to_string() } else { content_type }),
        json: None,
    })
}

fn normalize_tts_endpoint(endpoint: &str) -> String {
    endpoint
        .trim()
        .split('?')
        .next()
        .unwrap_or("")
        .trim_end_matches('/')
        .trim_end_matches("/index.html")
        .to_string()
}

#[tauri::command]
pub async fn proxy_tts_synthesize(
    app: tauri::AppHandle,
    endpoint: String,
    text: String,
    voice: Option<String>,
    model: Option<String>,
    rate: Option<f32>,
    api_key: Option<String>,
) -> Result<TtsProxyResponse, String> {
    let endpoint = normalize_tts_endpoint(&endpoint);
    if endpoint.is_empty() {
        return Err("TTS endpoint is empty".to_string());
    }

    let voice_clean = {
        let v = voice.unwrap_or_default().trim().to_string();
        if v.is_empty() { "af_heart".to_string() } else { v }
    };
    let model_clean = {
        let m = model.unwrap_or_default().trim().to_string();
        let raw = if m.is_empty() { "model".to_string() } else { m };
        match raw.as_str() {
            // Backward-compat with older UI values
            "kokoro" => "model".to_string(),
            "kokoro-82m" => "model".to_string(),
            "kokoro-tts" => "model_q4".to_string(),
            _ => raw,
        }
    };
    let rate_clean = rate.unwrap_or(1.0).clamp(0.5, 2.0);

    if endpoint.starts_with(LOCAL_SHERPA_ENDPOINT_PREFIX) {
        return synthesize_local_sherpa_tts(&app, &text, &voice_clean, rate_clean).await;
    }

    let mut payload_input_voice = serde_json::json!({
        "input": text,
        "model": model_clean,
        "response_format": "mp3",
        "speed": rate_clean
    });
    payload_input_voice["voice"] = serde_json::Value::String(voice_clean.clone());

    let base = endpoint
        .trim_end_matches("/audio/speech")
        .trim_end_matches("/v1")
        .trim_end_matches("/api/v1")
        .trim_end_matches('/')
        .to_string();

    let candidate_urls = vec![
        format!("{}/api/v1/audio/speech", base),
        format!("{}/v1/audio/speech", base),
        endpoint.clone(),
    ];
    let mut candidate_urls_deduped: Vec<String> = Vec::new();
    let mut seen_urls = HashSet::new();
    for u in candidate_urls {
        if seen_urls.insert(u.clone()) {
            candidate_urls_deduped.push(u);
        }
    }
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) PRMPTR-TTS/1.0")
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;
    let mut errors: Vec<String> = Vec::new();

    for url in candidate_urls_deduped {
        let response = match with_tts_auth(
            client
                .post(&url)
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .header(reqwest::header::ACCEPT, "audio/mpeg, audio/*, application/octet-stream, application/json")
                .json(&payload_input_voice),
            api_key.as_deref(),
        )
        .send()
        .await
        {
            Ok(r) => r,
            Err(e) => {
                errors.push(format!("POST {url}: {e}"));
                continue;
            }
        };
        if response.status().is_success() {
            match parse_tts_http_response(response).await {
                Ok(parsed) => return Ok(parsed),
                Err(e) => {
                    errors.push(format!("POST {url} parse error: {e}"));
                    continue;
                }
            }
        }
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        // Truncate error bodies so upstream content can't flood IPC responses.
        let body_snippet: String = body.chars().take(300).collect();
        errors.push(format!("POST {url} -> {status}: {body_snippet}"));
    }

    Err(format!(
        "TTS failed for all endpoint variants. Attempts: {}",
        errors.join(" | ")
    ))
}

#[tauri::command]
pub async fn proxy_tts_list_voices(endpoint: String, api_key: Option<String>) -> Result<Vec<String>, String> {
    let endpoint = normalize_tts_endpoint(&endpoint);
    if endpoint.is_empty() {
        return Err("TTS endpoint is empty".to_string());
    }
    if endpoint.starts_with(LOCAL_SHERPA_ENDPOINT_PREFIX) {
        return Ok(local_sherpa_voice_ids());
    }

    let base = endpoint
        .trim_end_matches("/audio/speech")
        .trim_end_matches("/v1")
        .trim_end_matches("/api/v1")
        .trim_end_matches('/')
        .to_string();

    let candidates = vec![
        format!("{}/v1/audio/voices", base),
        format!("{}/api/v1/audio/voices", base),
        format!("{}/audio/voices", base),
    ];

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;
    let mut errors = Vec::new();
    for url in candidates {
        let response = match with_tts_auth(client.get(&url), api_key.as_deref()).send().await {
            Ok(r) => r,
            Err(e) => {
                errors.push(format!("GET {url}: {e}"));
                continue;
            }
        };
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            errors.push(format!("GET {url} -> {status}: {body}"));
            continue;
        }

        let json = match response.json::<serde_json::Value>().await {
            Ok(v) => v,
            Err(e) => {
                errors.push(format!("GET {url} parse error: {e}"));
                continue;
            }
        };

        let mut voices: Vec<String> = Vec::new();
        match json {
            serde_json::Value::Array(items) => {
                for item in items {
                    if let Some(id) = item.as_str() {
                        voices.push(id.to_string());
                    } else if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                        voices.push(id.to_string());
                    } else if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                        voices.push(name.to_string());
                    }
                }
            }
            serde_json::Value::Object(map) => {
                if let Some(serde_json::Value::Array(items)) = map.get("voices") {
                    for item in items {
                        if let Some(id) = item.as_str() {
                            voices.push(id.to_string());
                        } else if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                            voices.push(id.to_string());
                        } else if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                            voices.push(name.to_string());
                        }
                    }
                }
            }
            _ => {}
        }

        voices.sort();
        voices.dedup();
        if !voices.is_empty() {
            return Ok(voices);
        }
    }

    Err(format!(
        "Unable to load voices from endpoint. Attempts: {}",
        errors.join(" | ")
    ))
}

#[derive(Clone, Serialize)]
pub struct SttModelDownloadProgress {
    pub model_id: String,
    pub stage: String,
    pub percent: u8,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
}

fn emit_stt_progress(app: &tauri::AppHandle, model_id: &str, stage: &str, percent: u8, downloaded: u64, total: Option<u64>) {
    let _ = app.emit(
        "stt-model-download-progress",
        SttModelDownloadProgress {
            model_id: model_id.to_string(),
            stage: stage.to_string(),
            percent,
            downloaded_bytes: downloaded,
            total_bytes: total,
        },
    );
}

#[tauri::command]
pub fn list_stt_models(app: tauri::AppHandle) -> Result<Vec<SttModelInfo>, String> {
    Ok(crate::transcription::model_manager::list_stt_models(&app))
}

#[tauri::command]
pub fn get_selected_stt_model(app: tauri::AppHandle) -> Result<String, String> {
    Ok(crate::transcription::model_manager::get_selected_stt_model_id(&app))
}

#[tauri::command]
pub fn set_selected_stt_model(app: tauri::AppHandle, model_id: String) -> Result<(), String> {
    crate::transcription::model_manager::set_selected_stt_model_id(&app, &model_id)
}

/// Models currently downloading, so a double-click can't start two writers
/// on the same `.part` file.
static DOWNLOADS_IN_FLIGHT: OnceLock<StdMutex<HashSet<String>>> = OnceLock::new();

#[tauri::command]
pub async fn download_stt_model(app: tauri::AppHandle, model_id: String) -> Result<(), String> {
    let spec: &'static SttModelSpec = crate::transcription::model_manager::find_stt_model_spec(&model_id)
        .ok_or_else(|| format!("Unknown speech model: {model_id}"))?;

    {
        let mut inflight = DOWNLOADS_IN_FLIGHT
            .get_or_init(|| StdMutex::new(HashSet::new()))
            .lock()
            .map_err(|_| "download registry poisoned".to_string())?;
        if !inflight.insert(model_id.clone()) {
            return Err(format!("{} is already downloading", spec.name));
        }
    }
    let result = download_stt_model_inner(&app, spec).await;
    if let Some(set) = DOWNLOADS_IN_FLIGHT.get() {
        if let Ok(mut inflight) = set.lock() {
            inflight.remove(&model_id);
        }
    }
    if let Err(ref e) = result {
        emit_stt_progress(&app, spec.id, &format!("Failed: {e}"), 0, 0, Some(spec.bytes));
    }
    result
}

async fn download_stt_model_inner(app: &tauri::AppHandle, spec: &'static SttModelSpec) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    use tokio::io::AsyncWriteExt;

    let model_dir = crate::transcription::model_manager::models_dir(app)?;
    tokio::fs::create_dir_all(&model_dir)
        .await
        .map_err(|e| format!("Failed to create model dir: {e}"))?;
    let final_path = model_dir.join(spec.filename);
    let part_path = model_dir.join(format!("{}.part", spec.filename));

    emit_stt_progress(app, spec.id, "Starting download…", 0, 0, Some(spec.bytes));

    let client = reqwest::Client::builder()
        .user_agent(concat!("prmptr/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;
    let response = client
        .get(spec.download_url())
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Download failed with HTTP {}", response.status()));
    }

    let mut file = tokio::fs::File::create(&part_path)
        .await
        .map_err(|e| format!("Failed to create model file: {e}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded: u64 = 0;
    let mut last_pct: u8 = 0;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                drop(file);
                let _ = tokio::fs::remove_file(&part_path).await;
                return Err(format!("Download interrupted: {e}"));
            }
        };
        downloaded += chunk.len() as u64;
        if downloaded > spec.bytes {
            drop(file);
            let _ = tokio::fs::remove_file(&part_path).await;
            return Err("Download is larger than the pinned model; aborted".to_string());
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write model file: {e}"))?;
        let pct = ((downloaded as f64 / spec.bytes as f64) * 100.0) as u8;
        if pct != last_pct {
            last_pct = pct;
            emit_stt_progress(app, spec.id, "Downloading…", pct.min(99), downloaded, Some(spec.bytes));
        }
    }
    file.flush().await.map_err(|e| format!("Failed to flush model file: {e}"))?;
    drop(file);

    emit_stt_progress(app, spec.id, "Verifying…", 99, downloaded, Some(spec.bytes));
    let digest = format!("{:x}", hasher.finalize());
    if downloaded != spec.bytes || digest != spec.sha256 {
        let _ = tokio::fs::remove_file(&part_path).await;
        return Err("Downloaded model failed its integrity check — please retry".to_string());
    }
    tokio::fs::rename(&part_path, &final_path)
        .await
        .map_err(|e| format!("Failed to install model file: {e}"))?;

    emit_stt_progress(app, spec.id, "Complete", 100, downloaded, Some(spec.bytes));
    crate::transcription::model_manager::set_selected_stt_model_id(app, spec.id)?;
    log::info!("Speech model installed: {}", final_path.display());
    Ok(())
}

// ──────────────────────────── Template Commands ────────────────────────────

#[tauri::command]
pub fn load_templates(
    app: tauri::AppHandle,
) -> Result<Vec<crate::session::templates::TemplateData>, String> {
    use crate::session::templates::load_templates_from_dir;

    // Look for templates in the resource directory first, then the CWD
    let resource_dir = app.path().resource_dir().ok();
    let template_dirs: Vec<std::path::PathBuf> = [
        resource_dir.map(|d| d.join("templates")),
        Some(std::path::PathBuf::from("templates")),
    ]
    .into_iter()
    .flatten()
    .collect();

    for dir in &template_dirs {
        if dir.exists() {
            let templates = load_templates_from_dir(dir);
            if !templates.is_empty() {
                return Ok(templates);
            }
        }
    }

    Ok(Vec::new())
}
