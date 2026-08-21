use tauri::{State, Emitter, Manager};
use std::sync::Arc;
use std::sync::{Mutex as StdMutex, OnceLock};
use tokio::sync::Mutex;
use base64::Engine;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::screenpipe::manager::{ScreenpipeManager, ScreenpipeStatus, AudioDevice};
use crate::screenpipe::config::ScreenpipeConfig;
use serde::Serialize;
use crate::session::manager::{SessionConfig, SessionManager, SessionStats};
use crate::transcription::transcript::TranscriptBuffer;
use crate::transcription::model_manager::{WhisperModelInfo, WhisperModelSpec};
use futures_util::StreamExt;

// ──────────────────────────── Screenpipe Commands ────────────────────────────

#[tauri::command]
pub async fn start_screenpipe(
    screenpipe: State<'_, Arc<Mutex<ScreenpipeManager>>>,
    config: Option<ScreenpipeConfig>,
) -> Result<(), String> {
    let mut mgr = screenpipe.lock().await;
    if let Some(cfg) = config {
        mgr.update_config(cfg);
    }
    mgr.start().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_screenpipe(
    screenpipe: State<'_, Arc<Mutex<ScreenpipeManager>>>,
) -> Result<(), String> {
    let mut mgr = screenpipe.lock().await;
    mgr.stop().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_screenpipe_status(
    screenpipe: State<'_, Arc<Mutex<ScreenpipeManager>>>,
) -> Result<ScreenpipeStatus, String> {
    let mut mgr = screenpipe.lock().await;
    Ok(mgr.check_health().await)
}

#[tauri::command]
pub async fn get_audio_devices(
    screenpipe: State<'_, Arc<Mutex<ScreenpipeManager>>>,
) -> Result<Vec<AudioDevice>, String> {
    let mgr = screenpipe.lock().await;
    mgr.get_audio_devices().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_screenpipe_config(
    screenpipe: State<'_, Arc<Mutex<ScreenpipeManager>>>,
    config: ScreenpipeConfig,
) -> Result<(), String> {
    let mut mgr = screenpipe.lock().await;
    mgr.update_config(config);
    Ok(())
}

// ──────────────────────────── Native Audio Device Enumeration ────────────────────────────

#[tauri::command]
pub async fn list_system_audio_devices() -> Result<Vec<AudioDevice>, String> {
    tokio::task::spawn_blocking(|| {
        use cpal::traits::{DeviceTrait, HostTrait};
        let host = cpal::default_host();
        let default_input = host
            .default_input_device()
            .and_then(|d| d.name().ok());
        let default_output = host
            .default_output_device()
            .and_then(|d| d.name().ok());
        let mut devices = Vec::new();
        if let Ok(inputs) = host.input_devices() {
            for dev in inputs {
                if let Ok(name) = dev.name() {
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
                if let Ok(name) = dev.name() {
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

// ──────────────────────────── Screenpipe Install Commands ────────────────────────────

#[derive(Serialize)]
pub struct CheckInstallResult {
    pub installed: bool,
    pub path: Option<String>,
}

#[tauri::command]
pub async fn check_screenpipe_installed(
    screenpipe: State<'_, Arc<Mutex<ScreenpipeManager>>>,
) -> Result<CheckInstallResult, String> {
    let mut mgr = screenpipe.lock().await;
    let path = mgr.find_binary();
    Ok(CheckInstallResult { installed: path.is_some(), path })
}

#[tauri::command]
pub async fn install_screenpipe(
    app: tauri::AppHandle,
    screenpipe: State<'_, Arc<Mutex<ScreenpipeManager>>>,
) -> Result<String, String> {
    let path = crate::screenpipe::installer::download_and_install(&app)
        .await
        .map_err(|e| e.to_string())?;
    // Update manager so it knows where the binary is
    let mut mgr = screenpipe.lock().await;
    let mut cfg = mgr.config().clone();
    cfg.binary_path = Some(path.clone());
    mgr.update_config(cfg);
    Ok(path)
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

#[tauri::command]
pub async fn validate_api_key(
    provider: String,
    api_key: String,
    base_url: Option<String>,
) -> Result<bool, String> {
    use crate::llm::provider::LlmProvider;

    let client: Box<dyn LlmProvider> = match provider.as_str() {
        "anthropic" => Box::new(crate::llm::anthropic::AnthropicClient::new(api_key)),
        "openai" => Box::new(crate::llm::openai::OpenAICompatibleClient::new(
            Some(api_key),
            "https://api.openai.com/v1".to_string(),
            "openai".to_string(),
        )),
        "groq" => Box::new(crate::llm::groq::new_groq_client(api_key)),
        "cerebras" => Box::new(crate::llm::cerebras::new_cerebras_client(api_key)),
        "lmstudio" => Box::new(crate::llm::lmstudio::new_lmstudio_client(base_url)),
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    client.validate().await
}

#[tauri::command]
pub async fn fetch_lmstudio_models(
    base_url: Option<String>,
) -> Result<Vec<String>, String> {
    use crate::llm::provider::LlmProvider;
    let client = crate::llm::lmstudio::new_lmstudio_client(base_url);
    client.list_models().await
}

#[tauri::command]
pub async fn trigger_llm(
    app: tauri::AppHandle,
    session: State<'_, Arc<Mutex<SessionManager>>>,
    transcript: State<'_, Arc<Mutex<TranscriptBuffer>>>,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<(), String> {
    use crate::llm::provider::{LlmProvider, LlmRequest, StreamToken};
    use crate::llm::prompt_builder;

    let (config, buf_text) = {
        let sess = session.lock().await;
        if !sess.active {
            return Err("No active session".to_string());
        }
        let buf = transcript.lock().await;
        (sess.config.clone(), buf.formatted_text())
    };

    if buf_text.is_empty() {
        return Err("No transcript data".to_string());
    }

    let system_prompt = prompt_builder::build_system_prompt(
        &config.context,
        match config.response_style {
            crate::session::manager::ResponseStyle::Concise => "concise",
            crate::session::manager::ResponseStyle::Detailed => "detailed",
            crate::session::manager::ResponseStyle::AiVoice => "ai-voice",
        },
        match config.trigger_mode {
            crate::session::manager::TriggerMode::Auto => "auto",
            crate::session::manager::TriggerMode::Manual => "manual",
            crate::session::manager::TriggerMode::Continuous => "continuous",
        },
    );

    let buf = transcript.lock().await;
    let user_message = prompt_builder::build_user_message(&buf);
    drop(buf);

    let request = LlmRequest {
        system_prompt,
        user_message,
        model: config.model.clone(),
        max_tokens: config.max_tokens,
        temperature: config.temperature,
    };

    let client: Box<dyn LlmProvider> = match config.provider.as_str() {
        "anthropic" => {
            let key = api_key.ok_or("Anthropic API key required")?;
            Box::new(crate::llm::anthropic::AnthropicClient::new(key))
        }
        "openai" => {
            let key = api_key.ok_or("OpenAI API key required")?;
            Box::new(crate::llm::openai::OpenAICompatibleClient::new(
                Some(key),
                "https://api.openai.com/v1".to_string(),
                "openai".to_string(),
            ))
        }
        "groq" => {
            let key = api_key.ok_or("Groq API key required")?;
            Box::new(crate::llm::groq::new_groq_client(key))
        }
        "cerebras" => {
            let key = api_key.ok_or("Cerebras API key required")?;
            Box::new(crate::llm::cerebras::new_cerebras_client(key))
        }
        "lmstudio" => {
            Box::new(crate::llm::lmstudio::new_lmstudio_client(base_url))
        }
        _ => return Err(format!("Unknown provider: {}", config.provider)),
    };

    let (tx, mut rx) = tokio::sync::mpsc::channel::<StreamToken>(100);

    let app_handle = app.clone();
    tokio::spawn(async move {
        let mut full_response = String::new();
        while let Some(token) = rx.recv().await {
            if !token.text.is_empty() {
                full_response.push_str(&token.text);
            }
            let _ = app_handle.emit("response-stream", &token);
            if token.is_complete {
                break;
            }
        }
    });

    client.stream_response(request, tx).await?;
    Ok(())
}

// ──────────────────────────── Local Whisper Commands ────────────────────────────

#[tauri::command]
pub async fn start_local_transcription(
    app: tauri::AppHandle,
    whisper: State<'_, Arc<Mutex<crate::transcription::whisper_stream::WhisperStreamManager>>>,
    transcript: State<'_, Arc<Mutex<TranscriptBuffer>>>,
    input_device_name: Option<String>,
    output_device_name: Option<String>,
    whisper_model_id: Option<String>,
    prefer_gpu: Option<bool>,
) -> Result<(), String> {
    let config = crate::transcription::whisper_stream::LocalWhisperConfig {
        input_device_name,
        output_device_name,
        whisper_model_id,
        prefer_gpu: prefer_gpu.unwrap_or(false),
        ..Default::default()
    };

    let mut mgr = whisper.lock().await;
    mgr.start(app, config, transcript.inner().clone())
}

#[tauri::command]
pub async fn stop_local_transcription(
    whisper: State<'_, Arc<Mutex<crate::transcription::whisper_stream::WhisperStreamManager>>>,
) -> Result<(), String> {
    let mut mgr = whisper.lock().await;
    mgr.stop();
    Ok(())
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

#[derive(Clone, Serialize)]
pub struct LocalGpuStatus {
    pub nvidia_gpu_detected: bool,
    pub cuda_toolkit_installed: bool,
    pub cuda_backend_available: bool,
    pub can_use_gpu: bool,
    pub message: String,
}

#[tauri::command]
pub fn get_local_transcription_gpu_status() -> Result<LocalGpuStatus, String> {
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

    let nvidia_gpu_detected = std::process::Command::new("nvidia-smi")
        .arg("-L")
        .output()
        .map(|o| o.status.success() && !String::from_utf8_lossy(&o.stdout).trim().is_empty())
        .unwrap_or(false);

    #[cfg(windows)]
    let cuda_toolkit_installed = {
        let env_path = std::env::var("CUDA_PATH").ok();
        let env_exists = env_path
            .as_ref()
            .map(|p| std::path::Path::new(p).exists())
            .unwrap_or(false);
        let cuda_root = std::path::Path::new("C:\\Program Files\\NVIDIA GPU Computing Toolkit\\CUDA");
        let default_exists = cuda_root.exists();
        let versioned_nvcc_exists = std::fs::read_dir(cuda_root)
            .ok()
            .map(|entries| {
                entries
                    .flatten()
                    .map(|entry| entry.path().join("bin").join("nvcc.exe"))
                    .any(|nvcc| nvcc.exists())
            })
            .unwrap_or(false);
        let nvcc_on_path = std::process::Command::new("cmd")
            .args(["/C", "where", "nvcc"])
            .output()
            .map(|o| o.status.success() && !String::from_utf8_lossy(&o.stdout).trim().is_empty())
            .unwrap_or(false);

        env_exists || default_exists || versioned_nvcc_exists || nvcc_on_path
    };

    #[cfg(not(windows))]
    let cuda_toolkit_installed = std::path::Path::new("/usr/local/cuda").exists()
        || std::path::Path::new("/opt/cuda").exists();

    let cuda_backend_available = whisper_cuda_backend_available();
    // Runtime GPU use is gated by NVIDIA GPU presence + whisper CUDA backend availability.
    // Toolkit presence is reported for diagnostics, but should not hard-block runtime detection.
    let can_use_gpu = nvidia_gpu_detected && cuda_backend_available;

    let message = if can_use_gpu {
        "GPU acceleration is available for local transcription.".to_string()
    } else if !nvidia_gpu_detected {
        "No NVIDIA GPU detected. Local transcription will run on CPU.".to_string()
    } else if !cuda_backend_available {
        "NVIDIA GPU detected, but CUDA backend is not active in this app runtime/build. Recheck, and if it still fails, rebuild/restart with CUDA-enabled whisper runtime."
            .to_string()
    } else if !cuda_toolkit_installed {
        "NVIDIA GPU detected, but CUDA Toolkit was not found. GPU may still work via driver runtime, but installing Toolkit is recommended."
            .to_string()
    } else {
        "GPU acceleration is unavailable in the current environment.".to_string()
    };

    Ok(LocalGpuStatus {
        nvidia_gpu_detected,
        cuda_toolkit_installed,
        cuda_backend_available,
        can_use_gpu,
        message,
    })
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
pub struct WhisperModelDownloadProgress {
    pub model_id: String,
    pub stage: String,
    pub percent: u8,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
}

fn emit_whisper_model_progress(
    app: &tauri::AppHandle,
    model_id: &str,
    stage: &str,
    percent: u8,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
) {
    let _ = app.emit(
        "whisper-model-download-progress",
        WhisperModelDownloadProgress {
            model_id: model_id.to_string(),
            stage: stage.to_string(),
            percent,
            downloaded_bytes,
            total_bytes,
        },
    );
}

#[tauri::command]
pub fn list_whisper_models(app: tauri::AppHandle) -> Result<Vec<WhisperModelInfo>, String> {
    Ok(crate::transcription::model_manager::list_whisper_models(&app))
}

#[tauri::command]
pub fn get_selected_whisper_model(app: tauri::AppHandle) -> Result<String, String> {
    Ok(crate::transcription::model_manager::get_selected_whisper_model_id(&app))
}

#[tauri::command]
pub fn set_selected_whisper_model(app: tauri::AppHandle, model_id: String) -> Result<(), String> {
    crate::transcription::model_manager::set_selected_whisper_model_id(&app, &model_id)
}

#[tauri::command]
pub async fn download_whisper_model(
    app: tauri::AppHandle,
    model_id: String,
) -> Result<(), String> {
    use tauri::Manager;

    let spec: &WhisperModelSpec = crate::transcription::model_manager::find_whisper_model_spec(&model_id)
        .ok_or_else(|| format!("Unknown model id: {model_id}"))?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    let model_dir = app_data_dir.join("models");
    std::fs::create_dir_all(&model_dir)
        .map_err(|e| format!("Failed to create model dir: {e}"))?;
    let model_path = model_dir.join(spec.filename);

    emit_whisper_model_progress(&app, &model_id, "Starting download...", 0, 0, None);

    let client = reqwest::Client::builder()
        .user_agent("prmptr-whisper-model-downloader")
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let response = client
        .get(spec.download_url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status {}",
            response.status()
        ));
    }

    let total_size = response.content_length();
    let mut downloaded: u64 = 0;
    let mut file = std::fs::File::create(&model_path)
        .map_err(|e| format!("Failed to create model file: {e}"))?;

    let mut stream = response.bytes_stream();
    // Safety cap: refuse absurdly large downloads (largest whisper model ~3 GB).
    const MAX_MODEL_DOWNLOAD_BYTES: u64 = 4 * 1024 * 1024 * 1024;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
        use std::io::Write;
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write model file: {e}"))?;
        downloaded += chunk.len() as u64;
        if downloaded > MAX_MODEL_DOWNLOAD_BYTES {
            drop(file);
            let _ = std::fs::remove_file(&model_path);
            return Err("Download exceeded maximum expected size; aborted".to_string());
        }

        let pct = if let Some(total) = total_size {
            if total > 0 {
                ((downloaded as f64 / total as f64) * 100.0) as u8
            } else {
                0
            }
        } else {
            0
        };

        emit_whisper_model_progress(
            &app,
            &model_id,
            "Downloading...",
            pct.min(99),
            downloaded,
            total_size,
        );
    }

    emit_whisper_model_progress(
        &app,
        &model_id,
        "Complete",
        100,
        downloaded,
        total_size,
    );

    crate::transcription::model_manager::set_selected_whisper_model_id(&app, &model_id)?;
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
