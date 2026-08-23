use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;

use crate::speech::audio::capture::{spawn_capture_thread, CaptureSpec};
use crate::speech::audio::metrics::{AudioPipelineMetrics, AudioPipelineSnapshot};
use crate::speech::audio::{platform, AudioChunk, AudioTrackId, DEFAULT_AUDIO_QUEUE_CAPACITY, SPEECH_SAMPLE_RATE};
use crate::transcription::canonical::{
    SpeakerSpan, TranscriptLine, TranscriptRole, TranscriptTrackId, TranscriptWord,
};

const DEEPGRAM_MODEL: &str = "nova-3";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectDeepgramConfig {
    pub input_device_name: Option<String>,
    pub output_device_name: Option<String>,
    pub api_key: String,
    #[serde(default)]
    pub mute_input: bool,
    #[serde(default)]
    pub mute_output: bool,
}

#[derive(Debug, Clone, Deserialize)]
struct DeepgramWord {
    word: String,
    #[serde(default)]
    punctuated_word: Option<String>,
    start: f64,
    end: f64,
    #[serde(default)]
    confidence: Option<f32>,
    #[serde(default)]
    speaker: Option<i32>,
}

#[derive(Debug, Clone, Deserialize)]
struct DeepgramAlternative {
    transcript: String,
    #[serde(default)]
    words: Vec<DeepgramWord>,
}

#[derive(Debug, Clone, Deserialize)]
struct DeepgramChannel {
    alternatives: Vec<DeepgramAlternative>,
}

#[derive(Debug, Clone, Deserialize)]
struct DeepgramMessage {
    #[serde(rename = "type")]
    msg_type: Option<String>,
    channel: Option<DeepgramChannel>,
    is_final: Option<bool>,
    speech_final: Option<bool>,
    start: Option<f64>,
    duration: Option<f64>,
}

fn seconds_to_ms(value: f64) -> u64 {
    if !value.is_finite() || value <= 0.0 {
        0
    } else {
        (value * 1000.0).round() as u64
    }
}

fn f32_to_pcm16le(samples: &[f32]) -> Vec<u8> {
    let mut output = Vec::with_capacity(samples.len() * 2);
    for &sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        output.extend_from_slice(&value.to_le_bytes());
    }
    output
}

fn deepgram_url(track: AudioTrackId) -> String {
    let mut url = format!(
        "wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate={SPEECH_SAMPLE_RATE}&channels=1&interim_results=true&smart_format=true&punctuate=true&endpointing=300&model={DEEPGRAM_MODEL}"
    );
    if track == AudioTrackId::System {
        url.push_str("&diarize=true&diarize_model=latest");
    }
    url
}

fn canonical_words(words: &[DeepgramWord]) -> Vec<TranscriptWord> {
    words
        .iter()
        .map(|word| TranscriptWord {
            text: word
                .punctuated_word
                .clone()
                .unwrap_or_else(|| word.word.clone()),
            start_ms: seconds_to_ms(word.start),
            end_ms: seconds_to_ms(word.end),
            confidence: word.confidence,
        })
        .collect()
}

fn locate_word(text: &str, cursor: usize, word: &str) -> Option<(usize, usize)> {
    if cursor >= text.len() || word.is_empty() {
        return None;
    }
    text.get(cursor..)?
        .find(word)
        .map(|offset| {
            let start = cursor + offset;
            (start, start + word.len())
        })
}

fn speaker_spans(text: &str, words: &[DeepgramWord], track: AudioTrackId) -> Vec<SpeakerSpan> {
    if track != AudioTrackId::System {
        return Vec::new();
    }

    #[derive(Debug)]
    struct PendingSpan {
        speaker_index: i32,
        start_ms: u64,
        end_ms: u64,
        start_char: Option<usize>,
        end_char: Option<usize>,
    }

    fn finish(span: PendingSpan) -> SpeakerSpan {
        SpeakerSpan {
            speaker_key: format!("system:{}", span.speaker_index),
            speaker_index: span.speaker_index,
            label: Some(format!("Speaker {}", span.speaker_index)),
            start_ms: span.start_ms,
            end_ms: span.end_ms,
            start_char: span.start_char,
            end_char: span.end_char,
        }
    }

    let mut spans = Vec::new();
    let mut pending: Option<PendingSpan> = None;
    let mut cursor = 0usize;

    for word in words {
        let Some(raw_speaker) = word.speaker else {
            continue;
        };
        // Deepgram speaker IDs are zero-based. PRMPTR displays human-friendly
        // 1-based identities and namespaces them to the system track.
        let speaker_index = raw_speaker.saturating_add(1);
        let char_range = locate_word(text, cursor, &word.word);
        if let Some((_, end)) = char_range {
            cursor = end;
        }
        let start_ms = seconds_to_ms(word.start);
        let end_ms = seconds_to_ms(word.end);

        match pending.as_mut() {
            Some(current) if current.speaker_index == speaker_index => {
                current.end_ms = current.end_ms.max(end_ms);
                if let Some((_, end)) = char_range {
                    current.end_char = Some(end);
                }
            }
            _ => {
                if let Some(current) = pending.take() {
                    spans.push(finish(current));
                }
                pending = Some(PendingSpan {
                    speaker_index,
                    start_ms,
                    end_ms,
                    start_char: char_range.map(|range| range.0),
                    end_char: char_range.map(|range| range.1),
                });
            }
        }
    }

    if let Some(current) = pending {
        spans.push(finish(current));
    }
    spans
}

fn line_times(event: &DeepgramMessage, words: &[DeepgramWord]) -> (u64, u64) {
    if let (Some(first), Some(last)) = (words.first(), words.last()) {
        return (seconds_to_ms(first.start), seconds_to_ms(last.end));
    }
    let start_ms = seconds_to_ms(event.start.unwrap_or_default());
    let end_ms = start_ms.saturating_add(seconds_to_ms(event.duration.unwrap_or_default()));
    (start_ms, end_ms)
}

fn emit_unexpected_stop(
    app: &tauri::AppHandle,
    running: &AtomicBool,
    track: AudioTrackId,
    message: impl Into<String>,
) {
    if running.swap(false, Ordering::Relaxed) {
        let error = format!("Deepgram {} stream: {}", track.as_str(), message.into());
        log::error!("{error}");
        let _ = app.emit(
            "local-transcription-status",
            serde_json::json!({
                "mode": "direct-deepgram",
                "running": false,
                "error": error,
            }),
        );
    }
}

fn spawn_worker(
    app: tauri::AppHandle,
    running: Arc<AtomicBool>,
    mut rx: mpsc::Receiver<AudioChunk>,
    api_key: String,
    track: AudioTrackId,
    ready: std::sync::mpsc::SyncSender<Result<(), String>>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
            Ok(runtime) => runtime,
            Err(error) => {
                let _ = ready.send(Err(format!("Failed to create Deepgram runtime: {error}")));
                return;
            }
        };

        runtime.block_on(async move {
            let mut request = match deepgram_url(track).into_client_request() {
                Ok(request) => request,
                Err(error) => {
                    let _ = ready.send(Err(format!("Failed to build Deepgram request: {error}")));
                    return;
                }
            };
            let auth = format!("Token {api_key}");
            let value = match HeaderValue::from_str(&auth) {
                Ok(value) => value,
                Err(error) => {
                    let _ = ready.send(Err(format!("Invalid Deepgram authorization header: {error}")));
                    return;
                }
            };
            request.headers_mut().insert("Authorization", value);

            let (socket, _) = match tokio_tungstenite::connect_async(request).await {
                Ok(value) => value,
                Err(error) => {
                    let _ = ready.send(Err(format!("Deepgram connection failed: {error}")));
                    return;
                }
            };
            let _ = ready.send(Ok(()));
            log::info!("[deepgram:{}] connected model={DEEPGRAM_MODEL}", track.as_str());

            let (mut write, mut read) = socket.split();
            let mut keepalive = tokio::time::interval(Duration::from_secs(5));
            let stream_started = Instant::now();
            let mut expected_sample = 0u64;
            let mut line_id = uuid::Uuid::new_v4().to_string();
            let mut line_created_at: DateTime<Utc> = Utc::now();
            let mut revision = 0u64;

            loop {
                tokio::select! {
                    maybe_chunk = rx.recv() => {
                        let Some(chunk) = maybe_chunk else {
                            break;
                        };
                        if chunk.start_sample > expected_sample {
                            let mut missing = chunk.start_sample - expected_sample;
                            log::warn!(
                                "[deepgram:{}] replacing {} dropped samples with silence",
                                track.as_str(),
                                missing
                            );
                            while missing > 0 {
                                let count = missing.min(SPEECH_SAMPLE_RATE as u64) as usize;
                                let silence = vec![0u8; count * 2];
                                if write.send(tokio_tungstenite::tungstenite::Message::Binary(silence.into())).await.is_err() {
                                    emit_unexpected_stop(&app, &running, track, "audio send failed while filling a queue gap");
                                    return;
                                }
                                missing -= count as u64;
                            }
                        }
                        expected_sample = chunk.end_sample();
                        let pcm = f32_to_pcm16le(&chunk.samples);
                        if write.send(tokio_tungstenite::tungstenite::Message::Binary(pcm.into())).await.is_err() {
                            emit_unexpected_stop(&app, &running, track, "audio send failed");
                            return;
                        }
                    }
                    websocket_message = read.next() => {
                        let Some(message) = websocket_message else {
                            if running.load(Ordering::Relaxed) {
                                emit_unexpected_stop(&app, &running, track, "websocket ended unexpectedly");
                            }
                            break;
                        };
                        let message = match message {
                            Ok(message) => message,
                            Err(error) => {
                                if running.load(Ordering::Relaxed) {
                                    emit_unexpected_stop(&app, &running, track, format!("websocket error: {error}"));
                                }
                                break;
                            }
                        };
                        let tokio_tungstenite::tungstenite::Message::Text(text) = message else {
                            if matches!(message, tokio_tungstenite::tungstenite::Message::Close(_))
                                && running.load(Ordering::Relaxed)
                            {
                                emit_unexpected_stop(&app, &running, track, "server closed the websocket");
                                break;
                            }
                            continue;
                        };
                        let event = match serde_json::from_str::<DeepgramMessage>(&text) {
                            Ok(event) => event,
                            Err(error) => {
                                log::debug!("[deepgram:{}] ignored message parse error: {error}", track.as_str());
                                continue;
                            }
                        };
                        if event.msg_type.as_deref() != Some("Results") {
                            continue;
                        }
                        let Some(alternative) = event.channel.as_ref().and_then(|channel| channel.alternatives.first()) else {
                            continue;
                        };
                        let transcript = alternative.transcript.trim().to_string();
                        if transcript.is_empty() {
                            continue;
                        }

                        let (start_ms, end_ms) = line_times(&event, &alternative.words);
                        let latency_ms = (stream_started.elapsed().as_millis() as u64).saturating_sub(end_ms);
                        let complete = event.speech_final.unwrap_or(false) || event.is_final.unwrap_or(false);
                        let now = Utc::now();
                        let line = TranscriptLine {
                            id: line_id.clone(),
                            revision,
                            track_id: match track {
                                AudioTrackId::Mic => TranscriptTrackId::Mic,
                                AudioTrackId::System => TranscriptTrackId::System,
                            },
                            role: match track {
                                AudioTrackId::Mic => TranscriptRole::You,
                                AudioTrackId::System => TranscriptRole::Them,
                            },
                            engine: "deepgram".to_string(),
                            model: DEEPGRAM_MODEL.to_string(),
                            model_version: None,
                            text: transcript.clone(),
                            start_ms,
                            end_ms,
                            is_complete: complete,
                            words: canonical_words(&alternative.words),
                            speaker_spans: speaker_spans(&transcript, &alternative.words, track),
                            latency_ms: Some(latency_ms),
                            created_at: line_created_at,
                            updated_at: now,
                        };
                        let _ = app.emit("speech-transcript-line", &line);
                        log::info!(
                            "[deepgram:{}] revision={} complete={} start={}ms end={}ms latency={}ms text='{}'",
                            track.as_str(),
                            revision,
                            complete,
                            start_ms,
                            end_ms,
                            latency_ms,
                            transcript.chars().take(100).collect::<String>()
                        );

                        if complete {
                            line_id = uuid::Uuid::new_v4().to_string();
                            line_created_at = Utc::now();
                            revision = 0;
                        } else {
                            revision = revision.saturating_add(1);
                        }
                    }
                    _ = keepalive.tick() => {
                        if !running.load(Ordering::Relaxed) {
                            break;
                        }
                        let keepalive = serde_json::json!({ "type": "KeepAlive" }).to_string();
                        if write.send(tokio_tungstenite::tungstenite::Message::Text(keepalive.into())).await.is_err() {
                            emit_unexpected_stop(&app, &running, track, "keepalive send failed");
                            break;
                        }
                    }
                }
            }

            let close_stream = serde_json::json!({ "type": "CloseStream" }).to_string();
            let _ = write.send(tokio_tungstenite::tungstenite::Message::Text(close_stream.into())).await;
            let _ = write.send(tokio_tungstenite::tungstenite::Message::Close(None)).await;
            log::info!("[deepgram:{}] worker stopped", track.as_str());
        });
    })
}

pub struct DirectDeepgramStreamManager {
    running: Arc<AtomicBool>,
    threads: Vec<std::thread::JoinHandle<()>>,
    mute_input: Arc<AtomicBool>,
    mute_output: Arc<AtomicBool>,
    input_level: Arc<StdMutex<f32>>,
    output_level: Arc<StdMutex<f32>>,
    audio_metrics: Arc<AudioPipelineMetrics>,
}

impl DirectDeepgramStreamManager {
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

    pub fn audio_metrics(&self) -> AudioPipelineSnapshot {
        self.audio_metrics.snapshot()
    }

    pub fn start(&mut self, app: tauri::AppHandle, config: DirectDeepgramConfig) -> Result<(), String> {
        if self.is_running() {
            return Err("Direct Deepgram transcription already running".to_string());
        }
        if config.api_key.trim().is_empty() {
            return Err("Deepgram API key is required for direct mode".to_string());
        }

        let mic_enabled = config.input_device_name.is_some();
        let system_requested = config.output_device_name.is_some();
        let system_enabled = system_requested && platform::supports_system_capture();
        if system_requested && !system_enabled {
            log::warn!("Deepgram system capture disabled: {}", platform::system_capture_detail());
        }
        if !mic_enabled && !system_enabled {
            return Err("No supported Deepgram capture track is configured".to_string());
        }

        self.mute_input.store(config.mute_input, Ordering::Relaxed);
        self.mute_output.store(config.mute_output, Ordering::Relaxed);
        self.audio_metrics = Arc::new(AudioPipelineMetrics::default());
        let running = Arc::new(AtomicBool::new(true));
        self.running = running.clone();

        struct Plan {
            spec: CaptureSpec,
            muted: Arc<AtomicBool>,
            level: Arc<StdMutex<f32>>,
            tx: mpsc::Sender<AudioChunk>,
            ready: std::sync::mpsc::Receiver<Result<(), String>>,
        }

        let mut plans = Vec::new();
        let mut workers = Vec::new();
        for (track, enabled, device_name, muted, level) in [
            (
                AudioTrackId::Mic,
                mic_enabled,
                config.input_device_name.clone(),
                self.mute_input.clone(),
                self.input_level.clone(),
            ),
            (
                AudioTrackId::System,
                system_enabled,
                config.output_device_name.clone(),
                self.mute_output.clone(),
                self.output_level.clone(),
            ),
        ] {
            if !enabled {
                continue;
            }
            let (tx, rx) = mpsc::channel(DEFAULT_AUDIO_QUEUE_CAPACITY);
            let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
            workers.push(spawn_worker(
                app.clone(),
                running.clone(),
                rx,
                config.api_key.clone(),
                track,
                ready_tx,
            ));
            plans.push(Plan {
                spec: CaptureSpec { track, device_name },
                muted,
                level,
                tx,
                ready: ready_rx,
            });
        }

        for plan in &plans {
            match plan.ready.recv_timeout(Duration::from_secs(20)) {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    running.store(false, Ordering::Relaxed);
                    drop(plans);
                    for worker in workers {
                        let _ = worker.join();
                    }
                    return Err(error);
                }
                Err(error) => {
                    running.store(false, Ordering::Relaxed);
                    drop(plans);
                    for worker in workers {
                        let _ = worker.join();
                    }
                    return Err(format!("Timed out connecting to Deepgram: {error}"));
                }
            }
        }

        let mut captures = Vec::new();
        for plan in plans {
            match spawn_capture_thread(
                plan.spec,
                running.clone(),
                plan.muted,
                plan.level,
                plan.tx,
                self.audio_metrics.clone(),
            ) {
                Ok(thread) => captures.push(thread),
                Err(error) => {
                    running.store(false, Ordering::Relaxed);
                    for capture in captures {
                        let _ = capture.join();
                    }
                    for worker in workers {
                        let _ = worker.join();
                    }
                    return Err(error);
                }
            }
        }

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
                tokio::time::sleep(Duration::from_millis(120)).await;
            }
        });

        self.threads.extend(captures);
        self.threads.extend(workers);
        log::info!("Direct Deepgram transcription started on shared audio core, model={DEEPGRAM_MODEL}");
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
        log::info!("Direct Deepgram transcription stopped");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn system_diarization_ids_are_namespaced_and_one_based() {
        let words = vec![
            DeepgramWord {
                word: "hello".to_string(),
                punctuated_word: None,
                start: 0.0,
                end: 0.3,
                confidence: Some(0.9),
                speaker: Some(0),
            },
            DeepgramWord {
                word: "there".to_string(),
                punctuated_word: None,
                start: 0.4,
                end: 0.7,
                confidence: Some(0.8),
                speaker: Some(1),
            },
        ];
        let spans = speaker_spans("hello there", &words, AudioTrackId::System);
        assert_eq!(spans.len(), 2);
        assert_eq!(spans[0].speaker_key, "system:1");
        assert_eq!(spans[1].speaker_key, "system:2");
        assert_eq!(spans[0].start_char, Some(0));
        assert_eq!(spans[1].start_char, Some(6));
    }

    #[test]
    fn microphone_never_receives_diarized_speaker_spans() {
        let words = vec![DeepgramWord {
            word: "hello".to_string(),
            punctuated_word: None,
            start: 0.0,
            end: 0.3,
            confidence: Some(0.9),
            speaker: Some(0),
        }];
        assert!(speaker_spans("hello", &words, AudioTrackId::Mic).is_empty());
    }
}
