use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use screencapturekit::prelude::*;
use tokio::sync::mpsc;

use crate::speech::audio::conditioner::{rms_level, StreamingAudioConditioner};
use crate::speech::audio::metrics::AudioPipelineMetrics;
use crate::speech::audio::{AudioChunk, AudioTrackId, SPEECH_SAMPLE_RATE};

pub fn backend_name() -> &'static str { "screencapturekit" }

fn macos_major_version() -> Option<u32> {
    let output = std::process::Command::new("sw_vers").arg("-productVersion").output().ok()?;
    if !output.status.success() { return None; }
    String::from_utf8_lossy(&output.stdout).trim().split('.').next()?.parse().ok()
}

pub fn supports_system_capture() -> bool {
    macos_major_version().is_some_and(|major| major >= 13)
}

pub fn system_capture_detail() -> &'static str {
    "System output uses native ScreenCaptureKit audio capture on macOS 13+ and requires Screen & System Audio Recording permission."
}

pub fn resolve_system_device(_host: &cpal::Host, _requested: Option<&str>) -> Option<cpal::Device> { None }
pub fn system_capture_uses_input_config() -> bool { false }

fn decode_scalar(bytes: &[u8], bits: u32, is_float: bool, big_endian: bool) -> Result<f32, String> {
    match (bits, is_float) {
        (32, true) => {
            let raw: [u8; 4] = bytes.try_into().map_err(|_| "Invalid Float32 PCM bytes")?;
            Ok(if big_endian { f32::from_be_bytes(raw) } else { f32::from_le_bytes(raw) })
        }
        (64, true) => {
            let raw: [u8; 8] = bytes.try_into().map_err(|_| "Invalid Float64 PCM bytes")?;
            let value = if big_endian { f64::from_be_bytes(raw) } else { f64::from_le_bytes(raw) };
            Ok(value.clamp(-1.0, 1.0) as f32)
        }
        (8, false) if bytes.len() == 1 => Ok((bytes[0] as i8) as f32 / i8::MAX as f32),
        (16, false) => {
            let raw: [u8; 2] = bytes.try_into().map_err(|_| "Invalid Int16 PCM bytes")?;
            let value = if big_endian { i16::from_be_bytes(raw) } else { i16::from_le_bytes(raw) };
            Ok((value as f32 / i16::MAX as f32).clamp(-1.0, 1.0))
        }
        (24, false) if bytes.len() == 3 => {
            let raw = if big_endian {
                ((bytes[0] as i32) << 16) | ((bytes[1] as i32) << 8) | bytes[2] as i32
            } else {
                ((bytes[2] as i32) << 16) | ((bytes[1] as i32) << 8) | bytes[0] as i32
            };
            let signed = if raw & 0x0080_0000 != 0 { raw | !0x00ff_ffff } else { raw };
            Ok((signed as f32 / 8_388_607.0).clamp(-1.0, 1.0))
        }
        (32, false) => {
            let raw: [u8; 4] = bytes.try_into().map_err(|_| "Invalid Int32 PCM bytes")?;
            let value = if big_endian { i32::from_be_bytes(raw) } else { i32::from_le_bytes(raw) };
            Ok((value as f32 / i32::MAX as f32).clamp(-1.0, 1.0))
        }
        _ => Err(format!("Unsupported ScreenCaptureKit PCM format: bits={bits} float={is_float}")),
    }
}

fn decode_bytes(bytes: &[u8], bits: u32, is_float: bool, big_endian: bool) -> Result<Vec<f32>, String> {
    let bytes_per_sample = (bits / 8) as usize;
    if bytes_per_sample == 0 || bytes.len() % bytes_per_sample != 0 {
        return Err(format!("Invalid PCM byte length {} for {}-bit samples", bytes.len(), bits));
    }
    bytes.chunks_exact(bytes_per_sample)
        .map(|sample| decode_scalar(sample, bits, is_float, big_endian))
        .collect()
}

fn decode_sample_buffer(sample: &CMSampleBuffer) -> Result<(Vec<f32>, u32, usize), String> {
    let format = sample.format_description()
        .ok_or_else(|| "ScreenCaptureKit audio sample has no format description".to_string())?;
    if !format.is_audio() || !format.is_pcm() {
        return Err(format!("ScreenCaptureKit returned non-PCM audio format: {}", format.media_subtype_string()));
    }
    let rate = format.audio_sample_rate().map(|value| value.round() as u32).filter(|value| *value > 0)
        .ok_or_else(|| "ScreenCaptureKit audio sample rate is unavailable".to_string())?;
    let channels = format.audio_channel_count().map(|value| value as usize).filter(|value| *value > 0)
        .ok_or_else(|| "ScreenCaptureKit audio channel count is unavailable".to_string())?;
    let bits = format.audio_bits_per_channel().filter(|value| *value > 0)
        .ok_or_else(|| "ScreenCaptureKit PCM bit depth is unavailable".to_string())?;
    let is_float = format.audio_is_float();
    let big_endian = format.audio_is_big_endian();
    let list = sample.audio_buffer_list()
        .ok_or_else(|| "ScreenCaptureKit audio sample has no AudioBufferList".to_string())?;

    if list.num_buffers() == 1 {
        let buffer = list.get(0).ok_or_else(|| "ScreenCaptureKit AudioBufferList is unexpectedly empty".to_string())?;
        if buffer.number_channels as usize != channels {
            return Err(format!("Unexpected interleaved audio layout: format channels={} buffer channels={}", channels, buffer.number_channels));
        }
        return Ok((decode_bytes(buffer.data(), bits, is_float, big_endian)?, rate, channels));
    }

    if list.num_buffers() == channels && list.iter().all(|buffer| buffer.number_channels == 1) {
        let planes: Vec<Vec<f32>> = list.iter()
            .map(|buffer| decode_bytes(buffer.data(), bits, is_float, big_endian))
            .collect::<Result<_, _>>()?;
        let frame_count = planes.iter().map(Vec::len).min().unwrap_or(0);
        let mut interleaved = Vec::with_capacity(frame_count * channels);
        for frame in 0..frame_count {
            for plane in &planes { interleaved.push(plane[frame]); }
        }
        return Ok((interleaved, rate, channels));
    }

    Err(format!("Unsupported ScreenCaptureKit AudioBufferList layout: {} buffers for {} channels", list.num_buffers(), channels))
}

#[derive(Clone)]
struct SystemAudioHandler {
    running: Arc<AtomicBool>,
    muted: Arc<AtomicBool>,
    level: Arc<Mutex<f32>>,
    sample_clock: Arc<AtomicU64>,
    conditioner: Arc<Mutex<Option<(u32, usize, StreamingAudioConditioner)>>>,
    tx: mpsc::Sender<AudioChunk>,
    metrics: Arc<AudioPipelineMetrics>,
}

impl SCStreamOutputTrait for SystemAudioHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, output_type: SCStreamOutputType) {
        if !matches!(output_type, SCStreamOutputType::Audio) || !self.running.load(Ordering::Relaxed) { return; }
        let (native, rate, channels) = match decode_sample_buffer(&sample) {
            Ok(value) => value,
            Err(error) => {
                self.metrics.record_capture_error();
                self.running.store(false, Ordering::Relaxed);
                log::error!("[system] ScreenCaptureKit audio decode failed and stopped the pipeline: {error}");
                return;
            }
        };
        self.metrics.record_native_samples(native.len());
        if self.muted.load(Ordering::Relaxed) {
            self.metrics.record_muted_samples(native.len());
            if let Ok(mut current) = self.level.lock() { *current = 0.0; }
            return;
        }

        let conditioned = match self.conditioner.lock() {
            Ok(mut slot) => {
                let replace = slot.as_ref()
                    .map(|(existing_rate, existing_channels, _)| *existing_rate != rate || *existing_channels != channels)
                    .unwrap_or(true);
                if replace {
                    match StreamingAudioConditioner::new(rate, channels) {
                        Ok(conditioner) => *slot = Some((rate, channels, conditioner)),
                        Err(error) => {
                            self.metrics.record_resampler_error();
                            self.running.store(false, Ordering::Relaxed);
                            log::error!("[system] ScreenCaptureKit conditioner init failed: {error}");
                            return;
                        }
                    }
                }
                match slot.as_mut().expect("conditioner initialized above").2.push_interleaved(&native) {
                    Ok(samples) => samples,
                    Err(error) => {
                        self.metrics.record_resampler_error();
                        self.running.store(false, Ordering::Relaxed);
                        log::error!("[system] ScreenCaptureKit conditioning failed: {error}");
                        return;
                    }
                }
            }
            Err(_) => {
                self.metrics.record_capture_error();
                self.running.store(false, Ordering::Relaxed);
                return;
            }
        };

        if let Ok(mut current) = self.level.lock() { *current = rms_level(&conditioned); }
        if conditioned.is_empty() { return; }
        self.metrics.record_conditioned_samples(conditioned.len());
        let start_sample = self.sample_clock.fetch_add(conditioned.len() as u64, Ordering::Relaxed);
        match self.tx.try_send(AudioChunk { track: AudioTrackId::System, start_sample, samples: conditioned }) {
            Ok(()) => self.metrics.record_enqueued(),
            Err(mpsc::error::TrySendError::Full(chunk)) | Err(mpsc::error::TrySendError::Closed(chunk)) => self.metrics.record_drop(chunk.samples.len()),
        }
    }
}

pub fn spawn_system_capture_thread(
    running: Arc<AtomicBool>,
    muted: Arc<AtomicBool>,
    level: Arc<Mutex<f32>>,
    tx: mpsc::Sender<AudioChunk>,
    metrics: Arc<AudioPipelineMetrics>,
) -> Result<std::thread::JoinHandle<()>, String> {
    if !supports_system_capture() { return Err("ScreenCaptureKit system audio requires macOS 13 or newer".to_string()); }

    let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel::<Result<(), String>>(1);
    let startup_running = running.clone();
    let thread = std::thread::spawn(move || {
        let content = match SCShareableContent::get() {
            Ok(content) => content,
            Err(error) => {
                let _ = ready_tx.send(Err(format!("ScreenCaptureKit content access failed (check Screen & System Audio Recording permission): {error}")));
                return;
            }
        };
        let Some(display) = content.displays().into_iter().next() else {
            let _ = ready_tx.send(Err("ScreenCaptureKit found no display to anchor system-audio capture".to_string()));
            return;
        };
        let filter = SCContentFilter::create().with_display(&display).with_excluding_windows(&[]).build();
        let config = SCStreamConfiguration::new().with_captures_audio(true).with_sample_rate(SPEECH_SAMPLE_RATE as i32).with_channel_count(1);
        let handler = SystemAudioHandler {
            running: running.clone(), muted, level,
            sample_clock: Arc::new(AtomicU64::new(0)),
            conditioner: Arc::new(Mutex::new(None)), tx, metrics: metrics.clone(),
        };
        let mut stream = SCStream::new(&filter, &config);
        stream.add_output_handler(handler, SCStreamOutputType::Audio);
        if let Err(error) = stream.start_capture() {
            metrics.record_capture_error();
            let _ = ready_tx.send(Err(format!("Failed to start ScreenCaptureKit system audio: {error}")));
            return;
        }
        let _ = ready_tx.send(Ok(()));
        log::info!("[system] ScreenCaptureKit system audio started at requested 16kHz mono");
        while running.load(Ordering::Relaxed) { std::thread::sleep(std::time::Duration::from_millis(50)); }
        if let Err(error) = stream.stop_capture() {
            metrics.record_capture_error();
            log::warn!("[system] ScreenCaptureKit stop failed: {error}");
        }
        log::info!("[system] ScreenCaptureKit system audio stopped");
    });

    match ready_rx.recv_timeout(std::time::Duration::from_secs(15)) {
        Ok(Ok(())) => Ok(thread),
        Ok(Err(error)) => {
            startup_running.store(false, Ordering::Relaxed);
            let _ = thread.join();
            Err(error)
        }
        Err(error) => {
            startup_running.store(false, Ordering::Relaxed);
            Err(format!("Timed out starting ScreenCaptureKit system audio: {error}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn float32_pcm_decode_is_endian_aware() {
        let little = 0.5f32.to_le_bytes();
        let big = (-0.25f32).to_be_bytes();
        assert!((decode_scalar(&little, 32, true, false).unwrap() - 0.5).abs() < 0.0001);
        assert!((decode_scalar(&big, 32, true, true).unwrap() + 0.25).abs() < 0.0001);
    }

    #[test]
    fn signed_integer_pcm_normalizes_to_float() {
        let maximum = i16::MAX.to_le_bytes();
        let minimum = i16::MIN.to_le_bytes();
        assert!((decode_scalar(&maximum, 16, false, false).unwrap() - 1.0).abs() < 0.0001);
        assert_eq!(decode_scalar(&minimum, 16, false, false).unwrap(), -1.0);
    }

    #[test]
    fn unsupported_pcm_width_fails_instead_of_guessing() {
        assert!(decode_scalar(&[0; 5], 40, false, false).is_err());
    }
}
