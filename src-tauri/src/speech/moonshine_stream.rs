use std::collections::{hash_map::DefaultHasher, HashMap};
use std::hash::{Hash, Hasher};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
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
}

#[derive(Debug, Clone)]
pub struct MoonshineStreamConfig {
    pub arch: MoonshineVoiceArch,
    pub context: String,
    pub keyterms: Vec<String>,
    pub context_max_terms: u32,
    pub keyterm_boost: f32,
}

fn clean_context(value: &str) -> String {
    value.replace('\0', " ").chars().take(32_000).collect()
}

fn clean_keyterms(values: &[String]) -> String {
    let mut out: Vec<String> = values
        .iter()
        .map(|value| value.replace(['\0', ',', '\n', '\r'], " ").trim().to_string())
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
struct EmitState {
    revisions: HashMap<(AudioTrackId, u64), (u64, u64)>,
    created: HashMap<(AudioTrackId, u64), DateTime<Utc>>,
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
        transcript: moonshine_rs::Transcript,
    ) {
        for native in transcript.lines {
            let key = (track, native.id);
            let fingerprint = line_fingerprint(&native);
            let revision = match self.revisions.get(&key) {
                Some((previous_fingerprint, revision)) if *previous_fingerprint == fingerprint => continue,
                Some((_, revision)) => revision.saturating_add(1),
                None => 0,
            };
            self.revisions.insert(key, (fingerprint, revision));

            let start_ms = ms(native.start_time);
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
                    start_ms: ms(word.start),
                    end_ms: ms(word.end),
                    confidence: Some(word.confidence.clamp(0.0, 1.0)),
                })
                .collect::<Vec<_>>();
            let speaker_spans = if track == AudioTrackId::System
                && crate::transcription::speaker::get_speaker_diarization_enabled()
            {
                native
                    .speaker_spans
                    .iter()
                    .map(|span| SpeakerSpan {
                        speaker_key: format!("system:{}", span.speaker_id),
                        speaker_index: span.speaker_index.min(i32::MAX as u32) as i32,
                        label: Some(format!("Speaker {}", span.speaker_index.saturating_add(1))),
                        start_ms: ms(span.start_time),
                        end_ms: ms(span.start_time + span.duration),
                        // Moonshine offsets are UTF-8 bytes; PRMPTR's JS projection
                        // consumes UTF-16 indices, so normalize them at the native boundary.
                        start_char: Some(utf8_byte_to_utf16(&native.text, span.start_char)),
                        end_char: Some(utf8_byte_to_utf16(&native.text, span.end_char)),
                    })
                    .collect()
            } else {
                Vec::new()
            };

            let line = TranscriptLine {
                id: format!("moonshine:{}:{}", track.as_str(), native.id),
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
                let entry = TranscriptEntry {
                    id: line.id.clone(),
                    text: line.text.clone(),
                    timestamp: created_at,
                    source: line.engine.clone(),
                    speaker: line.speaker_spans.first().map(|span| span.speaker_index),
                    is_final: true,
                };
                transcript_buffer.blocking_lock().update_or_push(entry);
            }
        }
    }
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
) -> (
    std::thread::JoinHandle<()>,
    std::sync::mpsc::Sender<MoonshineControl>,
) {
    let (control_tx, control_rx) = std::sync::mpsc::channel::<MoonshineControl>();
    let thread = std::thread::spawn(move || {
        use moonshine_rs::{Transcriber, TranscriberOptions};

        let model_dir = match moonshine_voice::model_dir(&app, config.arch) {
            Ok(path) => path,
            Err(error) => {
                let _ = ready_tx.send(Err(error));
                running.store(false, Ordering::Relaxed);
                return;
            }
        };
        let status = match moonshine_voice::model_status(&app, config.arch) {
            Ok(status) => status,
            Err(error) => {
                let _ = ready_tx.send(Err(error));
                running.store(false, Ordering::Relaxed);
                return;
            }
        };
        if !status.installed {
            let _ = ready_tx.send(Err(format!(
                "Moonshine Voice {} is not installed or failed integrity validation",
                config.arch.id()
            )));
            running.store(false, Ordering::Relaxed);
            return;
        }
        let diarization_dir = match moonshine_voice::diarization_dir(&app, config.arch) {
            Ok(path) => path,
            Err(error) => {
                let _ = ready_tx.send(Err(error));
                running.store(false, Ordering::Relaxed);
                return;
            }
        };
        let keyterms = clean_keyterms(&config.keyterms);
        let context = clean_context(&config.context);
        let options = TranscriberOptions::new()
            .with_speculative_decoding(true)
            .with_identify_speakers(tracks.contains(&AudioTrackId::System))
            .with_diarization_model_dir(&diarization_dir)
            .with_keyterm_boost(config.keyterm_boost.clamp(0.0, 4.0))
            .with_keyterms(&keyterms)
            .with_context(&context)
            .with_context_max_terms(config.context_max_terms.clamp(1, 400))
            .set("word_timestamps", "true")
            .set("decode_incomplete_lines", "true")
            .set("transcription_interval", "0.35");
        let transcriber = match Transcriber::from_files(&model_dir, config.arch.native(), Some(&options)) {
            Ok(value) => Arc::new(value),
            Err(error) => {
                let _ = ready_tx.send(Err(format!("Unable to load Moonshine Voice {}: {error}", config.arch.id())));
                running.store(false, Ordering::Relaxed);
                return;
            }
        };
        let mut streams = HashMap::new();
        for track in &tracks {
            match transcriber.clone().create_owned_stream() {
                Ok(stream) => {
                    streams.insert(*track, stream);
                }
                Err(error) => {
                    let _ = ready_tx.send(Err(format!("Unable to create Moonshine {} stream: {error}", track.as_str())));
                    running.store(false, Ordering::Relaxed);
                    return;
                }
            }
        }
        let _ = ready_tx.send(Ok(()));

        let mut emit = EmitState::new();
        let mut expected_sample: HashMap<AudioTrackId, u64> = tracks.iter().map(|track| (*track, 0)).collect();
        let mut last_poll: HashMap<AudioTrackId, Instant> = tracks.iter().map(|track| (*track, Instant::now())).collect();
        let zero_block = vec![0.0f32; SPEECH_SAMPLE_RATE as usize];

        while let Some(chunk) = audio_rx.blocking_recv() {
            for control in control_rx.try_iter() {
                let result = match control {
                    MoonshineControl::SetContext { text, max_terms } => {
                        transcriber.set_context(clean_context(&text), max_terms.clamp(1, 400))
                    }
                    MoonshineControl::SetKeyterms(values) => transcriber.set_keyterms(clean_keyterms(&values)),
                };
                if let Err(error) = result {
                    log::warn!("Moonshine live context update failed: {error}");
                }
            }

            let Some(stream) = streams.get_mut(&chunk.track) else {
                continue;
            };
            let expected = expected_sample.entry(chunk.track).or_default();
            let mut gap = chunk.start_sample.saturating_sub(*expected);
            while gap > 0 {
                let count = (gap as usize).min(zero_block.len());
                if let Err(error) = stream.add_audio(&zero_block[..count], SPEECH_SAMPLE_RATE) {
                    let _ = app.emit("local-transcription-status", serde_json::json!({
                        "mode": "moonshine-voice",
                        "running": false,
                        "error": format!("Moonshine stream gap fill failed: {error}")
                    }));
                    running.store(false, Ordering::Relaxed);
                    return;
                }
                gap -= count as u64;
            }
            if let Err(error) = stream.add_audio(&chunk.samples, SPEECH_SAMPLE_RATE) {
                let _ = app.emit("local-transcription-status", serde_json::json!({
                    "mode": "moonshine-voice",
                    "running": false,
                    "error": format!("Moonshine stream add_audio failed: {error}")
                }));
                running.store(false, Ordering::Relaxed);
                return;
            }
            *expected = chunk.end_sample();

            let poll_due = last_poll
                .get(&chunk.track)
                .is_none_or(|instant| instant.elapsed() >= Duration::from_millis(350));
            if poll_due {
                match stream.poll(false) {
                    Ok(transcript) => emit.emit_transcript(
                        &app,
                        &transcript_buffer,
                        chunk.track,
                        config.arch,
                        transcript,
                    ),
                    Err(error) => {
                        let _ = app.emit("local-transcription-status", serde_json::json!({
                            "mode": "moonshine-voice",
                            "running": false,
                            "error": format!("Moonshine stream poll failed: {error}")
                        }));
                        running.store(false, Ordering::Relaxed);
                        return;
                    }
                }
                last_poll.insert(chunk.track, Instant::now());
            }
        }

        for (track, stream) in streams.drain() {
            match stream.finalize() {
                Ok(transcript) => emit.emit_transcript(
                    &app,
                    &transcript_buffer,
                    track,
                    config.arch,
                    transcript,
                ),
                Err(error) => log::warn!("Moonshine {} finalization failed: {error}", track.as_str()),
            }
        }
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
) -> (
    std::thread::JoinHandle<()>,
    std::sync::mpsc::Sender<MoonshineControl>,
) {
    let (control_tx, _control_rx) = std::sync::mpsc::channel();
    let thread = std::thread::spawn(move || {
        running.store(false, Ordering::Relaxed);
        let _ = ready_tx.send(Err(
            "Moonshine Voice is not compiled into this build; enable the moonshine-voice feature"
                .to_string(),
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
        assert_eq!(utf8_byte_to_utf16(text, text.len() as u64), text.encode_utf16().count());
    }

    #[test]
    fn context_and_keyterms_are_bounded_and_nul_safe() {
        assert!(!clean_context("hello\0world").contains('\0'));
        let terms = clean_keyterms(&[" Kubernetes ".into(), "Kubernetes".into(), "Ceph\nCluster".into()]);
        assert_eq!(terms, "Ceph Cluster,Kubernetes");
    }
}
