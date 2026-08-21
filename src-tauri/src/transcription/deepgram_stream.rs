use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tauri::Emitter;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;

const SAMPLE_RATE: u32 = 16_000;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DirectDeepgramConfig {
    pub input_device_name: Option<String>,
    pub output_device_name: Option<String>,
    pub api_key: String,
    #[serde(default)]
    pub mute_input: bool,
    #[serde(default)]
    pub mute_output: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TranscriptionResult {
    pub id: String,
    pub text: String,
    pub is_final: bool,
    pub timestamp: String,
    pub device_type: String,
    pub speaker_id: Option<i32>,
    pub speaker_label: Option<String>,
}

#[derive(Deserialize)]
struct DeepgramAlt {
    transcript: String,
}

#[derive(Deserialize)]
struct DeepgramChannel {
    alternatives: Vec<DeepgramAlt>,
}

#[derive(Deserialize)]
struct DeepgramMessage {
    #[serde(rename = "type")]
    msg_type: Option<String>,
    channel: Option<DeepgramChannel>,
    is_final: Option<bool>,
    speech_final: Option<bool>,
}

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

fn f32_to_pcm16le(samples: &[f32]) -> Vec<u8> {
    let mut out = Vec::with_capacity(samples.len() * 2);
    for &s in samples {
        let clamped = s.clamp(-1.0, 1.0);
        let v = (clamped * i16::MAX as f32) as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }
    out
}

fn device_exists(device_name: &str, is_output: bool) -> bool {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let wanted = device_name
        .trim()
        .trim_end_matches(" (input)")
        .trim_end_matches(" (output)")
        .trim()
        .to_string();

    let names: Vec<String> = if is_output {
        match host.output_devices() {
            Ok(devs) => devs.filter_map(|d| d.name().ok()).collect(),
            Err(_) => return false,
        }
    } else {
        match host.input_devices() {
            Ok(devs) => devs.filter_map(|d| d.name().ok()).collect(),
            Err(_) => return false,
        }
    };

    names.iter().any(|name| {
        let n = name.trim();
        n == wanted || n.eq_ignore_ascii_case(&wanted)
    })
}

fn spawn_capture_thread(
    device_name: Option<String>,
    is_output: bool,
    running: Arc<AtomicBool>,
    tx: mpsc::UnboundedSender<Vec<f32>>,
    label: &'static str,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

        let host = cpal::default_host();

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

        let requested_name = clean_name.clone();
        let device = if is_output {
            if let Some(ref name) = clean_name {
                host.output_devices()
                    .ok()
                    .and_then(|mut devs| {
                        devs.find(|d| d.name().map(|n| matches_device(&n, name)).unwrap_or(false))
                    })
            } else {
                host.default_output_device()
            }
        } else if let Some(ref name) = clean_name {
            host.input_devices()
                .ok()
                .and_then(|mut devs| {
                    devs.find(|d| d.name().map(|n| matches_device(&n, name)).unwrap_or(false))
                })
        } else {
            host.default_input_device()
        };

        let device = match device {
            Some(d) => d,
            None => {
                if let Some(name) = requested_name {
                    log::error!(
                        "[direct-deepgram:{label}] selected {} device '{}' not found",
                        if is_output { "output" } else { "input" },
                        name
                    );
                }
                log::error!("[direct-deepgram:{label}] no audio device available");
                return;
            }
        };

        let dev_name = device.name().unwrap_or_default();
        log::info!("[direct-deepgram:{label}] using device '{dev_name}'");

        let supported_config = if is_output {
            match device.default_output_config() {
                Ok(c) => c,
                Err(e) => {
                    log::error!(
                        "[direct-deepgram:{label}] failed to get default output config: {e}"
                    );
                    return;
                }
            }
        } else {
            match device.default_input_config() {
                Ok(c) => c,
                Err(e) => {
                    log::error!(
                        "[direct-deepgram:{label}] failed to get default input config: {e}"
                    );
                    return;
                }
            }
        };

        let native_rate = supported_config.sample_rate().0;
        let native_channels = supported_config.channels() as usize;
        let stream_config: cpal::StreamConfig = supported_config.into();

        let running_cb = running.clone();
        let tx_cb = tx.clone();

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
                let resampled = resample_linear(&mono, native_rate, SAMPLE_RATE);
                let _ = tx_cb.send(resampled);
            },
            move |err| {
                log::error!("[direct-deepgram:{label}] capture error: {err}");
            },
            None,
        );

        let stream = match stream {
            Ok(s) => s,
            Err(e) => {
                log::error!("[direct-deepgram:{label}] failed to build stream: {e}");
                return;
            }
        };

        if let Err(e) = stream.play() {
            log::error!("[direct-deepgram:{label}] failed to start stream: {e}");
            return;
        }

        while running.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        drop(stream);
    })
}

fn spawn_deepgram_worker_thread(
    app: tauri::AppHandle,
    running: Arc<AtomicBool>,
    mut audio_rx: mpsc::UnboundedReceiver<Vec<f32>>,
    api_key: String,
    device_type: &'static str,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                log::error!("[direct-deepgram:{device_type}] failed to create runtime: {e}");
                return;
            }
        };

        rt.block_on(async move {
            let url = "wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&punctuate=true&endpointing=300&model=nova-2";
            let mut request = match url.into_client_request() {
                Ok(req) => req,
                Err(e) => {
                    log::error!("[direct-deepgram:{device_type}] request build failed: {e}");
                    return;
                }
            };
            let auth = format!("Token {api_key}");
            match HeaderValue::from_str(&auth) {
                Ok(v) => {
                    request.headers_mut().insert("Authorization", v);
                }
                Err(e) => {
                    log::error!("[direct-deepgram:{device_type}] invalid auth header: {e}");
                    return;
                }
            }

            let connect = tokio_tungstenite::connect_async(request).await;
            let (ws, _) = match connect {
                Ok(v) => v,
                Err(e) => {
                    log::error!("[direct-deepgram:{device_type}] websocket connect failed: {e}");
                    if running.load(Ordering::Relaxed) {
                        let _ = app.emit(
                            "local-transcription-status",
                            serde_json::json!({
                                "mode": "direct-deepgram",
                                "running": false,
                                "error": format!("Deepgram connection failed: {e}"),
                            }),
                        );
                    }
                    return;
                }
            };

            log::info!("[direct-deepgram:{device_type}] connected");
            let (mut write, mut read) = ws.split();

            let mut ping_interval = tokio::time::interval(std::time::Duration::from_secs(5));
            let mut pending_text = String::new();
            let mut pending_updated_at = std::time::Instant::now();
            let mut last_committed_text = String::new();

            while running.load(Ordering::Relaxed) {
                tokio::select! {
                    maybe_audio = audio_rx.recv() => {
                        match maybe_audio {
                            Some(chunk) => {
                                let pcm = f32_to_pcm16le(&chunk);
                                if write.send(tokio_tungstenite::tungstenite::Message::Binary(pcm.into())).await.is_err() {
                                    log::warn!("[direct-deepgram:{device_type}] audio send failed");
                                    break;
                                }
                            }
                            None => break,
                        }
                    }
                    ws_msg = read.next() => {
                        let Some(msg) = ws_msg else {
                            if running.load(Ordering::Relaxed) {
                                log::error!("[direct-deepgram:{device_type}] websocket stream ended unexpectedly");
                                let _ = app.emit(
                                    "local-transcription-status",
                                    serde_json::json!({
                                        "mode": "direct-deepgram",
                                        "running": false,
                                        "error": "Deepgram connection dropped",
                                    }),
                                );
                            }
                            break;
                        };
                        let Ok(msg) = msg else {
                            if running.load(Ordering::Relaxed) {
                                log::error!("[direct-deepgram:{device_type}] websocket error");
                                let _ = app.emit(
                                    "local-transcription-status",
                                    serde_json::json!({
                                        "mode": "direct-deepgram",
                                        "running": false,
                                        "error": "Deepgram connection error",
                                    }),
                                );
                            }
                            break;
                        };
                        if let tokio_tungstenite::tungstenite::Message::Text(text) = msg {
                            let parsed = serde_json::from_str::<DeepgramMessage>(&text);
                            let Ok(evt) = parsed else {
                                log::debug!(
                                    "[direct-deepgram:{device_type}] non-result message: {}",
                                    text.chars().take(160).collect::<String>()
                                );
                                continue;
                            };
                            if evt.msg_type.as_deref() != Some("Results") {
                                continue;
                            }
                            let transcript = evt
                                .channel
                                .as_ref()
                                .and_then(|c| c.alternatives.first())
                                .map(|a| a.transcript.trim().to_string())
                                .unwrap_or_default();

                            if transcript.is_empty() {
                                continue;
                            }

                            pending_text = transcript;
                            pending_updated_at = std::time::Instant::now();

                            // `speech_final` is the utterance boundary we want for feed commits.
                            let should_commit = evt.speech_final.unwrap_or(false) || evt.is_final.unwrap_or(false);
                            if should_commit && !pending_text.is_empty() && pending_text != last_committed_text {
                                let committed = pending_text.clone();
                                let result = TranscriptionResult {
                                    id: uuid::Uuid::new_v4().to_string(),
                                    text: committed.clone(),
                                    is_final: true,
                                    timestamp: Utc::now().to_rfc3339(),
                                    device_type: device_type.to_string(),
                                    speaker_id: None,
                                    speaker_label: None,
                                };
                                log::info!("[direct-deepgram:{device_type}] {committed}");
                                let _ = app.emit("local-transcription", &result);
                                last_committed_text = committed;
                                pending_text.clear();
                            }
                        } else if let tokio_tungstenite::tungstenite::Message::Close(frame) = msg {
                            log::warn!("[direct-deepgram:{device_type}] websocket closed: {:?}", frame);
                            break;
                        }
                    }
                    _ = ping_interval.tick() => {
                        // Fallback flush when Deepgram doesn't emit a clean final marker.
                        if !pending_text.is_empty()
                            && std::time::Instant::now().duration_since(pending_updated_at)
                                > std::time::Duration::from_millis(1400)
                            && pending_text != last_committed_text
                        {
                            let committed = pending_text.clone();
                            let result = TranscriptionResult {
                                id: uuid::Uuid::new_v4().to_string(),
                                text: committed.clone(),
                                is_final: true,
                                timestamp: Utc::now().to_rfc3339(),
                                device_type: device_type.to_string(),
                                speaker_id: None,
                                speaker_label: None,
                            };
                            log::info!("[direct-deepgram:{device_type}] {committed}");
                            let _ = app.emit("local-transcription", &result);
                            last_committed_text = committed;
                            pending_text.clear();
                        }
                        let _ = write.send(tokio_tungstenite::tungstenite::Message::Ping(vec![].into())).await;
                    }
                }
            }

            let _ = write.send(tokio_tungstenite::tungstenite::Message::Close(None)).await;
            log::info!("[direct-deepgram:{device_type}] stopped");
        });
    })
}

pub struct DirectDeepgramStreamManager {
    running: Arc<AtomicBool>,
    threads: Vec<std::thread::JoinHandle<()>>,
}

fn is_output_style_device_name(name: &str) -> bool {
    name.trim().to_lowercase().ends_with("(output)")
}

impl DirectDeepgramStreamManager {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            threads: Vec::new(),
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    pub fn start(&mut self, app: tauri::AppHandle, config: DirectDeepgramConfig) -> Result<(), String> {
        if self.is_running() {
            return Err("Direct Deepgram transcription already running".to_string());
        }
        if config.api_key.trim().is_empty() {
            return Err("Deepgram API key is required for direct mode".to_string());
        }
        let has_input = !config.mute_input;
        let has_output = config.output_device_name.is_some() && !config.mute_output;
        if !has_input && !has_output {
            return Err("At least one of input or output must be unmuted for direct capture.".to_string());
        }
        if let Some(ref input) = config.input_device_name {
            if !input.ends_with(" (input)") {
                return Err("Direct mode input must be an input device. Re-select 'Input - You'.".to_string());
            }
            if !device_exists(input, false) {
                return Err(format!("Selected input device not found: {input}. Re-select it in Settings."));
            }
        }
        if let Some(ref output) = config.output_device_name {
            let output_is_output = is_output_style_device_name(output);
            if !output.ends_with(" (output)") && !output.ends_with(" (input)") {
                return Err("Direct mode 'Them' must be selected from device list (input or output).".to_string());
            }
            if !device_exists(output, output_is_output) {
                return Err(format!("Selected output device not found: {output}. Re-select it in Settings."));
            }
        }

        let running = Arc::new(AtomicBool::new(true));
        self.running = running.clone();
        self.threads.clear();

        if !config.mute_input {
            let (in_tx, in_rx) = mpsc::unbounded_channel::<Vec<f32>>();
            let input_capture = spawn_capture_thread(
                config.input_device_name,
                false,
                running.clone(),
                in_tx,
                "input",
            );
            let input_worker = spawn_deepgram_worker_thread(
                app.clone(),
                running.clone(),
                in_rx,
                config.api_key.clone(),
                "input",
            );
            self.threads.push(input_capture);
            self.threads.push(input_worker);
        }

        if config.output_device_name.is_some() && !config.mute_output {
            let (out_tx, out_rx) = mpsc::unbounded_channel::<Vec<f32>>();
            let output_is_output = config
                .output_device_name
                .as_deref()
                .map(is_output_style_device_name)
                .unwrap_or(true);
            let output_capture = spawn_capture_thread(
                config.output_device_name,
                output_is_output,
                running.clone(),
                out_tx,
                "output",
            );
            let output_worker = spawn_deepgram_worker_thread(
                app,
                running.clone(),
                out_rx,
                config.api_key,
                "output",
            );
            self.threads.push(output_capture);
            self.threads.push(output_worker);
        }

        Ok(())
    }

    pub fn stop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
        for handle in self.threads.drain(..) {
            let _ = handle.join();
        }
    }
}

