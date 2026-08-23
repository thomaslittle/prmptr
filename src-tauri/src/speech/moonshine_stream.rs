use std::collections::{hash_map::DefaultHasher, HashMap};
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde::Serialize;
use tauri::Emitter;
use tokio::sync::mpsc;

use crate::speech::audio::{AudioChunk, AudioTrackId, SPEECH_SAMPLE_RATE};
use crate::speech::moonshine_voice::{self, MoonshineVoiceArch};
use crate::transcription::canonical::{
    SpeakerSpan, TranscriptLine, TranscriptRole, TranscriptTrackId, TranscriptWord,
};
use crate::transcription::transcript::{TranscriptBuffer, TranscriptEntry};

#[derive(Debug, Clone)]
pub enum MoonshineControl {
    SetContext { text: String, max_terms: u32 },
    SetKeyterms(Vec<String>),
    SetDiarization {
        enabled: bool,
        reply: std::sync::mpsc::SyncSender<Result<SpeakerDiarizationRuntimeUpdate, String>>,
    },
}

#[derive(Debug, Clone)]
pub struct MoonshineStreamConfig {
    pub arch: MoonshineVoiceArch,
    pub context: String,
    pub keyterms: Vec<String>,
    pub context_max_terms: u32,
    pub keyterm_boost: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerDiarizationRuntimeUpdate {
    pub enabled: bool,
    pub native_compute_active: bool,
    pub native_streams_restarted: bool,
    pub engine: &'static str,
}

static ACTIVE_CONTROL: OnceLock<Mutex<Option<std::sync::mpsc::Sender<MoonshineControl>>>> =
    OnceLock::new();

fn active_control() -> &'static Mutex<Option<std::sync::mpsc::Sender<MoonshineControl>>> {
    ACTIVE_CONTROL.get_or_init(|| Mutex::new(None))
}

fn set_active_control(sender: Option<std::sync::mpsc::Sender<MoonshineControl>>) {
    if let Ok(mut slot) = active_control().lock() {
        *slot = sender;
    }
}

pub fn reconfigure_diarization(enabled: bool) -> Result<SpeakerDiarizationRuntimeUpdate, String> {
    let sender = active_control().lock().ok().and_then(|slot| slot.clone());
    let Some(sender) = sender else {
        crate::transcription::speaker::set_speaker_diarization_enabled(enabled);
        return Ok(SpeakerDiarizationRuntimeUpdate {
            enabled,
            native_compute_active: false,
            native_streams_restarted: false,
            engine: "non-moonshine-or-idle",
        });
    };

    let (reply_tx, reply_rx) = std::sync::mpsc::sync_channel(1);
    sender
        .send(MoonshineControl::SetDiarization {
            enabled,
            reply: reply_tx,
        })
        .map_err(|_| "Moonshine Voice control channel is closed".to_string())?;
    let update = reply_rx
        .recv_timeout(Duration::from_secs(90))
        .map_err(|error| format!("Timed out reconfiguring Moonshine diarization: {error}"))??;
    crate::transcription::speaker::set_speaker_diarization_enabled(enabled);
    Ok(update)
}

fn clean_context(value: &str) -> String {
    value.replace('\0', " ").chars().take(32_000).collect()
}

fn clean_keyterm(value: &str) -> String {
    value
        .chars()
        .map(|ch| if matches!(ch, '\0' | ',' | '\n' | '\r') { ' ' } else { ch })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn clean_keyterms(values: &[String]) -> String {
    let mut out: Vec<String> = values
        .iter()
        .map(|value| clean_keyterm(value))
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(96).collect::<String>())
        .take(200)
        .collect();
    out.sort();
    out.dedup();
    out.join(",")
}

fn utf8_byte_to_utf16(text: &str, byte_offset: u64) -> usize {
    let mut end = (byte_offset as usize).min(text.len());
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].encode_utf16().count()
}

#[cfg(feature = "moonshine-voice")]
fn line_fingerprint(line: &moonshine_rs::TranscriptLine) -> u64 {
    let mut hasher = DefaultHasher::new();
    line.text.hash(&mut hasher);
    line.is_complete.hash(&mut hasher);
    line.words.len().hash(&mut hasher);
    for word in &line.words {
        word.text.hash(&mut hasher);
        word.start.to_bits().hash(&mut hasher);
        word.end.to_bits().hash(&mut hasher);
        word.confidence.to_bits().hash(&mut hasher);
    }
    line.speaker_spans.len().hash(&mut hasher);
    for span in &line.speaker_spans {
        span.speaker_id.hash(&mut hasher);
        span.speaker_index.hash(&mut hasher);
        span.start_time.to_bits().hash(&mut hasher);
        span.duration.to_bits().hash(&mut hasher);
        span.start_char.hash(&mut hasher);
        span.end_char.hash(&mut hasher);
    }
    hasher.finish()
}

#[cfg(feature = "moonshine-voice")]
fn ms(seconds: f32) -> u64 {
    if seconds.is_finite() && seconds > 0.0 {
        (seconds as f64 * 1000.0).round().max(0.0) as u64
    } else {
        0
    }
}

#[cfg(feature = "moonshine-voice")]
fn samples_to_ms(samples: u64) -> u64 {
    samples.saturating_mul(1000) / SPEECH_SAMPLE_RATE as u64
}

#[cfg(feature = "moonshine-voice")]
struct EmitState {
    revisions: HashMap<(AudioTrackId, u64, u64), (u64, u64)>,
    created: HashMap<(AudioTrackId, u64, u64), DateTime<Utc>>,
    anchor: DateTime<Utc>,
}

#[cfg(feature = "moonshine-voice")]
impl EmitState {
    fn new() -> Self {
        Self {
            revisions: HashMap::new(),
            created: HashMap::new(),
            anchor: Utc::now(),
        }
    }

    fn emit_transcript(
        &mut self,
        app: &tauri::AppHandle,
        transcript_buffer: &Arc<tokio::sync::Mutex<TranscriptBuffer>>,
        track: AudioTrackId,
        arch: MoonshineVoiceArch,
        generation: u64,
        epoch_ms: u64,
        diarization_visible: bool,
        transcript: moonshine_rs::Transcript,
    ) {
        for native in transcript.lines {
            let key = (track, generation, native.id);
            let fingerprint = line_fingerprint(&native);
            let revision = match self.revisions.get(&key) {
                Some((previous_fingerprint, _)) if *previous_fingerprint == fingerprint => continue,
                Some((_, revision)) => revision.saturating_add(1),
                None => 0,
            };
            self.revisions.insert(key, (fingerprint, revision));

            let start_ms = epoch_ms.saturating_add(ms(native.start_time));
            let end_ms = start_ms.saturating_add(ms(native.duration));
            let created_at = *self.created.entry(key).or_insert_with(|| {
                self.anchor + chrono::Duration::milliseconds(start_ms.min(i64::MAX as u64) as i64)
            });
            let now = Utc::now();
            let words = native
                .words
                .iter()
                .map(|word| TranscriptWord {
                    text: word.text.clone(),
                    start_ms: epoch_ms.saturating_add(ms(word.start)),
                    end_ms: epoch_ms.saturating_add(ms(word.end)),
                    confidence: Some(word.confidence.clamp(0.0, 1.0)),
                })
                .collect::<Vec<_>>();
            let speaker_spans = if track == AudioTrackId::System && diarization_visible {
                native
                    .speaker_spans
                    .iter()
                    .map(|span| SpeakerSpan {
                        speaker_key: format!("system:{}", span.speaker_id),
                        speaker_index: span.speaker_index.min(i32::MAX as u32) as i32,
                        label: Some(format!("Speaker {}", span.speaker_index.saturating_add(1))),
                        start_ms: epoch_ms.saturating_add(ms(span.start_time)),
                        end_ms: epoch_ms.saturating_add(ms(span.start_time + span.duration)),
                        start_char: Some(utf8_byte_to_utf16(&native.text, span.start_char)),
                        end_char: Some(utf8_byte_to_utf16(&native.text, span.end_char)),
                    })
                    .collect()
            } else {
                Vec::new()
            };

            let line = TranscriptLine {
                id: format!("moonshine:{}:{}:{}", track.as_str(), generation, native.id),
                revision,
                track_id: match track {
                    AudioTrackId::Mic => TranscriptTrackId::Mic,
                    AudioTrackId::System => TranscriptTrackId::System,
                },
                role: match track {
                    AudioTrackId::Mic => TranscriptRole::You,
                    AudioTrackId::System => TranscriptRole::Them,
                },
                engine: "moonshine-voice".to_string(),
                model: arch.id().to_string(),
                model_version: Some(moonshine_rs::get_version().to_string()),
                text: native.text,
                start_ms,
                end_ms,
                is_complete: native.is_complete,
                words,
                speaker_spans,
                latency_ms: Some(native.last_transcription_latency_ms as u64),
                created_at,
                updated_at: now,
            };
            let _ = app.emit("speech-transcript-line", &line);
            if line.is_complete && !line.text.trim().is_empty() {
                transcript_buffer.blocking_lock().update_or_push(TranscriptEntry {
                    id: line.id.clone(),
                    text: line.text.clone(),
                    timestamp: created_at,
                    source: line.engine.clone(),
                    speaker: line.speaker_spans.first().map(|span| span.speaker_index),
                    is_final: true,
                });
            }
        }
    }
}

#[cfg(feature = "moonshine-voice")]
struct NativeRuntime {
    transcriber: Arc<moonshine_rs::Transcriber>,
    streams: HashMap<AudioTrackId, moonshine_rs::OwnedTranscriberStream>,
    diarization: bool,
}

#[cfg(feature = "moonshine-voice")]
fn build_native_runtime(
    app: &tauri::AppHandle,
    tracks: &[AudioTrackId],
    config: &MoonshineStreamConfig,
    context: &str,
    keyterms: &[String],
    diarization: bool,
) -> Result<NativeRuntime, String> {
    use moonshine_rs::{Transcriber, TranscriberOptions};

    let model_dir = moonshine_voice::model_dir(app, config.arch)?;
    let status = moonshine_voice::model_status(app, config.arch)?;
    if !status.installed {
        return Err(format!(
            "Moonshine Voice {} is not installed or failed integrity validation",
            config.arch.id()
        ));
    }

    let mut options = TranscriberOptions::new()
        .with_speculative_decoding(true)
        .with_identify_speakers(diarization)
        .with_keyterm_boost(config.keyterm_boost.clamp(0.0, 4.0))
        .with_keyterms(clean_keyterms(keyterms))
        .with_context(clean_context(context))
        .with_context_max_terms(config.context_max_terms.clamp(1, 400))
        .set("word_timestamps", "true")
        .set("decode_incomplete_lines", "true")
        .set("transcription_interval", "0.35");
    if diarization {
        let diarization_dir = moonshine_voice::diarization_dir(app, config.arch)?;
        options = options.with_diarization_model_dir(&diarization_dir);
    }

    let transcriber = Arc::new(
        Transcriber::from_files(&model_dir, config.arch.native(), Some(&options))
            .map_err(|error| format!("Unable to load Moonshine Voice {}: {error}", config.arch.id()))?,
    );
    let mut streams = HashMap::new();
    for track in tracks {
        let stream = transcriber
            .clone()
            .create_owned_stream()
            .map_err(|error| format!("Unable to create Moonshine {} stream: {error}", track.as_str()))?;
        streams.insert(*track, stream);
    }
    Ok(NativeRuntime {
        transcriber,
        streams,
        diarization,
    })
}

#[cfg(feature = "moonshine-voice")]
fn finalize_runtime(
    runtime: &mut NativeRuntime,
    emit: &mut EmitState,
    app: &tauri::AppHandle,
    transcript_buffer: &Arc<tokio::sync::Mutex<TranscriptBuffer>>,
    arch: MoonshineVoiceArch,
    generation: u64,
    epochs: &HashMap<AudioTrackId, u64>,
) {
    for (track, stream) in runtime.streams.drain() {
        match stream.finalize() {
            Ok(transcript) => emit.emit_transcript(
                app,
                transcript_buffer,
                track,
                arch,
                generation,
                *epochs.get(&track).unwrap_or(&0),
                runtime.diarization,
                transcript,
            ),
            Err(error) => log::warn!("Moonshine {} finalization failed: {error}", track.as_str()),
        }
    }
}

#[cfg(feature = "moonshine-voice")]
fn emit_worker_error(app: &tauri::AppHandle, running: &AtomicBool, message: String) {
    let _ = app.emit(
        "local-transcription-status",
        serde_json::json!({
            "mode": "local-whisper",
            "engine": "moonshine-voice",
            "running": false,
            "error": message
        }),
    );
    running.store(false, Ordering::Relaxed);
}

#[cfg(feature = "moonshine-voice")]
pub fn spawn_worker(
    app: tauri::AppHandle,
    running: Arc<AtomicBool>,
    mut audio_rx: mpsc::Receiver<AudioChunk>,
    transcript_buffer: Arc<tokio::sync::Mutex<TranscriptBuffer>>,
    tracks: Vec<AudioTrackId>,
    config: MoonshineStreamConfig,
    ready_tx: std::sync::mpsc::SyncSender<Result<(), String>>,
) -> (std::thread::JoinHandle<()>, std::sync::mpsc::Sender<MoonshineControl>) {
    let (control_tx, control_rx) = std::sync::mpsc::channel::<MoonshineControl>();
    set_active_control(Some(control_tx.clone()));
    let thread = std::thread::spawn(move || {
        let mut context = clean_context(&config.context);
        let mut keyterms = config.keyterms.clone();
        let initial_diarization = tracks.contains(&AudioTrackId::System)
            && crate::transcription::speaker::get_speaker_diarization_enabled();
        let mut runtime = match build_native_runtime(
            &app,
            &tracks,
            &config,
            &context,
            &keyterms,
            initial_diarization,
        ) {
            Ok(runtime) => runtime,
            Err(error) => {
                let _ = ready_tx.send(Err(error));
                running.store(false, Ordering::Relaxed);
                set_active_control(None);
                return;
            }
        };
        let _ = ready_tx.send(Ok(()));
        log::info!(
            "Moonshine Voice worker ready: arch={} tracks={} diarization={}",
            config.arch.id(),
            tracks.len(),
            runtime.diarization
        );

        let mut emit = EmitState::new();
        let mut expected_sample: HashMap<AudioTrackId, u64> =
            tracks.iter().map(|track| (*track, 0)).collect();
        let mut epochs: HashMap<AudioTrackId, u64> = tracks.iter().map(|track| (*track, 0)).collect();
        let mut last_poll: HashMap<AudioTrackId, Instant> =
            tracks.iter().map(|track| (*track, Instant::now())).collect();
        let zero_block = vec![0.0f32; SPEECH_SAMPLE_RATE as usize];
        let mut generation = 0u64;

        'worker: loop {
            for control in control_rx.try_iter() {
                match control {
                    MoonshineControl::SetContext { text, max_terms } => {
                        context = clean_context(&text);
                        if let Err(error) = runtime
                            .transcriber
                            .set_context(&context, max_terms.clamp(1, 400))
                        {
                            log::warn!("Moonshine live context update failed: {error}");
                        }
                    }
                    MoonshineControl::SetKeyterms(values) => {
                        keyterms = values;
                        if let Err(error) = runtime.transcriber.set_keyterms(clean_keyterms(&keyterms)) {
                            log::warn!("Moonshine live keyterm update failed: {error}");
                        }
                    }
                    MoonshineControl::SetDiarization { enabled, reply } => {
                        let desired = enabled && tracks.contains(&AudioTrackId::System);
                        if desired == runtime.diarization {
                            let _ = reply.send(Ok(SpeakerDiarizationRuntimeUpdate {
                                enabled,
                                native_compute_active: runtime.diarization,
                                native_streams_restarted: false,
                                engine: "moonshine-voice",
                            }));
                            continue;
                        }

                        let previous = runtime.diarization;
                        finalize_runtime(
                            &mut runtime,
                            &mut emit,
                            &app,
                            &transcript_buffer,
                            config.arch,
                            generation,
                            &epochs,
                        );
                        generation = generation.saturating_add(1);
                        for track in &tracks {
                            epochs.insert(
                                *track,
                                samples_to_ms(*expected_sample.get(track).unwrap_or(&0)),
                            );
                        }

                        match build_native_runtime(
                            &app,
                            &tracks,
                            &config,
                            &context,
                            &keyterms,
                            desired,
                        ) {
                            Ok(next) => {
                                runtime = next;
                                last_poll = tracks
                                    .iter()
                                    .map(|track| (*track, Instant::now()))
                                    .collect();
                                let update = SpeakerDiarizationRuntimeUpdate {
                                    enabled,
                                    native_compute_active: runtime.diarization,
                                    native_streams_restarted: true,
                                    engine: "moonshine-voice",
                                };
                                let _ = app.emit("speech-diarization-runtime", &update);
                                let _ = reply.send(Ok(update));
                            }
                            Err(error) => {
                                match build_native_runtime(
                                    &app,
                                    &tracks,
                                    &config,
                                    &context,
                                    &keyterms,
                                    previous,
                                ) {
                                    Ok(restored) => {
                                        runtime = restored;
                                        let _ = reply.send(Err(format!(
                                            "Unable to change Moonshine diarization; previous runtime was restored: {error}"
                                        )));
                                    }
                                    Err(restore_error) => {
                                        let message = format!(
                                            "Unable to change Moonshine diarization ({error}) and failed restoring previous runtime ({restore_error})"
                                        );
                                        let _ = reply.send(Err(message.clone()));
                                        emit_worker_error(&app, &running, message);
                                        break 'worker;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            match audio_rx.try_recv() {
                Ok(chunk) => {
                    let Some(stream) = runtime.streams.get_mut(&chunk.track) else {
                        continue;
                    };
                    let expected = expected_sample.entry(chunk.track).or_default();
                    let mut gap = chunk.start_sample.saturating_sub(*expected);
                    while gap > 0 {
                        let count = (gap as usize).min(zero_block.len());
                        if let Err(error) = stream.add_audio(&zero_block[..count], SPEECH_SAMPLE_RATE) {
                            emit_worker_error(
                                &app,
                                &running,
                                format!("Moonshine stream gap fill failed: {error}"),
                            );
                            break 'worker;
                        }
                        gap -= count as u64;
                    }
                    if let Err(error) = stream.add_audio(&chunk.samples, SPEECH_SAMPLE_RATE) {
                        emit_worker_error(
                            &app,
                            &running,
                            format!("Moonshine stream add_audio failed: {error}"),
                        );
                        break 'worker;
                    }
                    *expected = chunk.end_sample();

                    let poll_due = last_poll
                        .get(&chunk.track)
                        .map(|instant| instant.elapsed() >= Duration::from_millis(350))
                        .unwrap_or(true);
                    if poll_due {
                        match stream.poll(false) {
                            Ok(transcript) => emit.emit_transcript(
                                &app,
                                &transcript_buffer,
                                chunk.track,
                                config.arch,
                                generation,
                                *epochs.get(&chunk.track).unwrap_or(&0),
                                runtime.diarization,
                                transcript,
                            ),
                            Err(error) => {
                                emit_worker_error(
                                    &app,
                                    &running,
                                    format!("Moonshine stream poll failed: {error}"),
                                );
                                break 'worker;
                            }
                        }
                        last_poll.insert(chunk.track, Instant::now());
                    }
                }
                Err(tokio::sync::mpsc::error::TryRecvError::Empty) => {
                    if audio_rx.is_closed() {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(8));
                }
                Err(tokio::sync::mpsc::error::TryRecvError::Disconnected) => break,
            }
        }

        if !runtime.streams.is_empty() {
            finalize_runtime(
                &mut runtime,
                &mut emit,
                &app,
                &transcript_buffer,
                config.arch,
                generation,
                &epochs,
            );
        }
        set_active_control(None);
        log::info!("Moonshine Voice streaming worker stopped");
    });
    (thread, control_tx)
}

#[cfg(not(feature = "moonshine-voice"))]
pub fn spawn_worker(
    _app: tauri::AppHandle,
    running: Arc<AtomicBool>,
    _audio_rx: mpsc::Receiver<AudioChunk>,
    _transcript_buffer: Arc<tokio::sync::Mutex<TranscriptBuffer>>,
    _tracks: Vec<AudioTrackId>,
    _config: MoonshineStreamConfig,
    ready_tx: std::sync::mpsc::SyncSender<Result<(), String>>,
) -> (std::thread::JoinHandle<()>, std::sync::mpsc::Sender<MoonshineControl>) {
    let (control_tx, _control_rx) = std::sync::mpsc::channel();
    let thread = std::thread::spawn(move || {
        running.store(false, Ordering::Relaxed);
        let _ = ready_tx.send(Err(
            "Moonshine Voice is not compiled into this build; enable the moonshine-voice feature".to_string(),
        ));
    });
    (thread, control_tx)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_offsets_are_normalized_for_javascript_slicing() {
        let text = "A🙂B café";
        let emoji_end_bytes = "A🙂".len() as u64;
        assert_eq!(utf8_byte_to_utf16(text, emoji_end_bytes), 3);
        assert_eq!(
            utf8_byte_to_utf16(text, text.len() as u64),
            text.encode_utf16().count()
        );
    }

    #[test]
    fn context_and_keyterms_are_bounded_and_nul_safe() {
        assert!(!clean_context("hello\0world").contains('\0'));
        let terms = clean_keyterms(&[
            " Kubernetes ".into(),
            "Kubernetes".into(),
            "Ceph\nCluster".into(),
        ]);
        assert_eq!(terms, "Ceph Cluster,Kubernetes");
    }

    #[test]
    fn sample_epochs_preserve_global_timeline() {
        assert_eq!(samples_to_ms(16_000), 1_000);
        assert_eq!(samples_to_ms(24_000), 1_500);
    }
}
