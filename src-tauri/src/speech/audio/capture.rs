use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample};
use tokio::sync::mpsc;

use super::conditioner::{rms_level, StreamingAudioConditioner};
use super::metrics::AudioPipelineMetrics;
use super::{platform, AudioChunk, AudioTrackId};

#[derive(Debug, Clone)]
pub struct CaptureSpec {
    pub track: AudioTrackId,
    pub device_name: Option<String>,
}

fn clean_device_name(value: &str) -> String {
    value
        .trim()
        .trim_end_matches(" (input)")
        .trim_end_matches(" (output)")
        .trim()
        .to_string()
}

fn resolve_device(spec: &CaptureSpec) -> Result<cpal::Device, String> {
    platform::validate_track(spec.track)?;
    let host = cpal::default_host();
    let wanted = spec.device_name.as_deref().map(clean_device_name);

    let device = match spec.track {
        AudioTrackId::Mic => {
            if let Some(ref name) = wanted {
                host.input_devices()
                    .map_err(|e| format!("Failed to enumerate input devices: {e}"))?
                    .find(|device| platform::device_matches(device, name))
            } else {
                host.default_input_device()
            }
        }
        AudioTrackId::System => platform::resolve_system_device(&host, wanted.as_deref()),
    };

    device.ok_or_else(|| {
        format!(
            "No {} capture device available{}",
            spec.track.as_str(),
            wanted
                .as_ref()
                .map(|name| format!(": {name}"))
                .unwrap_or_default()
        )
    })
}

fn supported_config(
    device: &cpal::Device,
    track: AudioTrackId,
) -> Result<cpal::SupportedStreamConfig, String> {
    match track {
        AudioTrackId::Mic => device
            .default_input_config()
            .map_err(|e| format!("Failed to read microphone format: {e}")),
        AudioTrackId::System if platform::system_capture_uses_input_config() => device
            .default_input_config()
            .map_err(|e| format!("Failed to read system monitor format: {e}")),
        AudioTrackId::System => device
            .default_output_config()
            .map_err(|e| format!("Failed to read system-output format: {e}")),
    }
}

fn enqueue_chunk(
    tx: &mpsc::Sender<AudioChunk>,
    track: AudioTrackId,
    start_sample: u64,
    samples: Vec<f32>,
    metrics: &AudioPipelineMetrics,
) {
    if samples.is_empty() {
        return;
    }
    match tx.try_send(AudioChunk {
        track,
        start_sample,
        samples,
    }) {
        Ok(()) => metrics.record_enqueued(),
        Err(mpsc::error::TrySendError::Full(chunk)) => metrics.record_drop(chunk.samples.len()),
        Err(mpsc::error::TrySendError::Closed(chunk)) => metrics.record_drop(chunk.samples.len()),
    }
}

fn build_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    conditioner: Arc<Mutex<StreamingAudioConditioner>>,
    spec: CaptureSpec,
    running: Arc<AtomicBool>,
    muted: Arc<AtomicBool>,
    level: Arc<Mutex<f32>>,
    sample_clock: Arc<AtomicU64>,
    tx: mpsc::Sender<AudioChunk>,
    metrics: Arc<AudioPipelineMetrics>,
) -> Result<cpal::Stream, String>
where
    T: Sample + SizedSample + Copy + Send + 'static,
    f32: FromSample<T>,
{
    let error_metrics = metrics.clone();
    let label = spec.track.as_str();

    device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                if !running.load(Ordering::Relaxed) {
                    return;
                }
                metrics.record_native_samples(data.len());
                if muted.load(Ordering::Relaxed) {
                    metrics.record_muted_samples(data.len());
                    if let Ok(mut current) = level.lock() {
                        *current = 0.0;
                    }
                    return;
                }

                let native: Vec<f32> = data
                    .iter()
                    .copied()
                    .map(|sample| sample.to_sample::<f32>())
                    .collect();

                let conditioned = match conditioner.lock() {
                    Ok(mut guard) => match guard.push_interleaved(&native) {
                        Ok(samples) => samples,
                        Err(error) => {
                            metrics.record_resampler_error();
                            log::error!("[{label}] audio conditioning failed: {error}");
                            return;
                        }
                    },
                    Err(_) => {
                        metrics.record_capture_error();
                        return;
                    }
                };

                if let Ok(mut current) = level.lock() {
                    *current = rms_level(&conditioned);
                }
                if conditioned.is_empty() {
                    return;
                }

                metrics.record_conditioned_samples(conditioned.len());
                let start_sample = sample_clock.fetch_add(conditioned.len() as u64, Ordering::Relaxed);
                enqueue_chunk(&tx, spec.track, start_sample, conditioned, &metrics);
            },
            move |error| {
                error_metrics.record_capture_error();
                log::error!("[{label}] capture stream error: {error}");
            },
            None,
        )
        .map_err(|e| format!("Failed to build {label} capture stream: {e}"))
}

pub fn spawn_capture_thread(
    spec: CaptureSpec,
    running: Arc<AtomicBool>,
    muted: Arc<AtomicBool>,
    level: Arc<Mutex<f32>>,
    tx: mpsc::Sender<AudioChunk>,
    metrics: Arc<AudioPipelineMetrics>,
) -> Result<std::thread::JoinHandle<()>, String> {
    platform::validate_track(spec.track)?;

    #[cfg(target_os = "macos")]
    if spec.track == AudioTrackId::System {
        return platform::spawn_system_capture_thread(running, muted, level, tx, metrics);
    }

    Ok(std::thread::spawn(move || {
        let label = spec.track.as_str();
        let device = match resolve_device(&spec) {
            Ok(device) => device,
            Err(error) => {
                metrics.record_capture_error();
                log::error!("[{label}] {error}");
                return;
            }
        };
        let device_name = device.name().unwrap_or_else(|_| "unknown".to_string());
        let supported = match supported_config(&device, spec.track) {
            Ok(config) => config,
            Err(error) => {
                metrics.record_capture_error();
                log::error!("[{label}] {error}");
                return;
            }
        };

        let native_rate = supported.sample_rate().0;
        let channels = supported.channels() as usize;
        let sample_format = supported.sample_format();
        let stream_config: cpal::StreamConfig = supported.into();
        let conditioner = match StreamingAudioConditioner::new(native_rate, channels) {
            Ok(value) => Arc::new(Mutex::new(value)),
            Err(error) => {
                metrics.record_resampler_error();
                log::error!("[{label}] {error}");
                return;
            }
        };
        let sample_clock = Arc::new(AtomicU64::new(0));

        log::info!(
            "[{label}] capture backend={} device='{}' format={:?} rate={}Hz channels={}",
            platform::backend_name(),
            device_name,
            sample_format,
            native_rate,
            channels
        );

        let stream = match sample_format {
            SampleFormat::F32 => build_stream::<f32>(&device, &stream_config, conditioner.clone(), spec.clone(), running.clone(), muted.clone(), level.clone(), sample_clock.clone(), tx.clone(), metrics.clone()),
            SampleFormat::F64 => build_stream::<f64>(&device, &stream_config, conditioner.clone(), spec.clone(), running.clone(), muted.clone(), level.clone(), sample_clock.clone(), tx.clone(), metrics.clone()),
            SampleFormat::I8 => build_stream::<i8>(&device, &stream_config, conditioner.clone(), spec.clone(), running.clone(), muted.clone(), level.clone(), sample_clock.clone(), tx.clone(), metrics.clone()),
            SampleFormat::I16 => build_stream::<i16>(&device, &stream_config, conditioner.clone(), spec.clone(), running.clone(), muted.clone(), level.clone(), sample_clock.clone(), tx.clone(), metrics.clone()),
            SampleFormat::I32 => build_stream::<i32>(&device, &stream_config, conditioner.clone(), spec.clone(), running.clone(), muted.clone(), level.clone(), sample_clock.clone(), tx.clone(), metrics.clone()),
            SampleFormat::I64 => build_stream::<i64>(&device, &stream_config, conditioner.clone(), spec.clone(), running.clone(), muted.clone(), level.clone(), sample_clock.clone(), tx.clone(), metrics.clone()),
            SampleFormat::U8 => build_stream::<u8>(&device, &stream_config, conditioner.clone(), spec.clone(), running.clone(), muted.clone(), level.clone(), sample_clock.clone(), tx.clone(), metrics.clone()),
            SampleFormat::U16 => build_stream::<u16>(&device, &stream_config, conditioner.clone(), spec.clone(), running.clone(), muted.clone(), level.clone(), sample_clock.clone(), tx.clone(), metrics.clone()),
            SampleFormat::U32 => build_stream::<u32>(&device, &stream_config, conditioner.clone(), spec.clone(), running.clone(), muted.clone(), level.clone(), sample_clock.clone(), tx.clone(), metrics.clone()),
            SampleFormat::U64 => build_stream::<u64>(&device, &stream_config, conditioner.clone(), spec.clone(), running.clone(), muted.clone(), level.clone(), sample_clock.clone(), tx.clone(), metrics.clone()),
            other => Err(format!("Unsupported native audio sample format: {other:?}")),
        };

        let stream = match stream {
            Ok(stream) => stream,
            Err(error) => {
                metrics.record_capture_error();
                log::error!("[{label}] {error}");
                return;
            }
        };
        if let Err(error) = stream.play() {
            metrics.record_capture_error();
            log::error!("[{label}] failed to start capture stream: {error}");
            return;
        }

        while running.load(Ordering::Relaxed) {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }

        drop(stream);
        if let Ok(mut guard) = conditioner.lock() {
            match guard.flush() {
                Ok(tail) if !tail.is_empty() => {
                    metrics.record_conditioned_samples(tail.len());
                    let start_sample = sample_clock.fetch_add(tail.len() as u64, Ordering::Relaxed);
                    enqueue_chunk(&tx, spec.track, start_sample, tail, &metrics);
                }
                Ok(_) => {}
                Err(error) => {
                    metrics.record_resampler_error();
                    log::warn!("[{label}] conditioner flush failed: {error}");
                }
            }
        }
        log::info!("[{label}] capture thread stopped");
    }))
}
