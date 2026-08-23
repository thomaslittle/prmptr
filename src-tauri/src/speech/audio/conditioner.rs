use rubato::{
    Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
};

use super::SPEECH_SAMPLE_RATE;

const RESAMPLE_CHUNK: usize = 1024;

/// Shared capture conditioner used by every speech backend.
///
/// CPAL callbacks may arrive at arbitrary native rates/channel counts. This
/// converts one interleaved callback to mono and runs a band-limited sinc
/// resampler in fixed input blocks. Keeping this below the engine boundary
/// prevents Whisper, Moonshine and Deepgram from implementing subtly different
/// audio frontends.
pub struct StreamingAudioConditioner {
    channels: usize,
    native_rate: u32,
    pending_mono: Vec<f32>,
    resampler: Option<SincFixedIn<f32>>,
}

impl StreamingAudioConditioner {
    pub fn new(native_rate: u32, channels: usize) -> Result<Self, String> {
        if native_rate == 0 {
            return Err("Audio sample rate must be greater than zero".to_string());
        }
        if channels == 0 {
            return Err("Audio channel count must be greater than zero".to_string());
        }

        let resampler = if native_rate == SPEECH_SAMPLE_RATE {
            None
        } else {
            let params = SincInterpolationParameters {
                sinc_len: 256,
                f_cutoff: 0.95,
                interpolation: SincInterpolationType::Cubic,
                oversampling_factor: 128,
                window: WindowFunction::BlackmanHarris2,
            };
            Some(
                SincFixedIn::<f32>::new(
                    SPEECH_SAMPLE_RATE as f64 / native_rate as f64,
                    2.0,
                    params,
                    RESAMPLE_CHUNK,
                    1,
                )
                .map_err(|e| format!("Failed to initialize sinc resampler: {e}"))?,
            )
        };

        Ok(Self {
            channels,
            native_rate,
            pending_mono: Vec::with_capacity(RESAMPLE_CHUNK * 2),
            resampler,
        })
    }

    pub fn native_rate(&self) -> u32 {
        self.native_rate
    }

    pub fn channels(&self) -> usize {
        self.channels
    }

    pub fn push_interleaved(&mut self, input: &[f32]) -> Result<Vec<f32>, String> {
        let mono = mix_interleaved_to_mono(input, self.channels);
        if self.resampler.is_none() {
            return Ok(mono);
        }

        self.pending_mono.extend_from_slice(&mono);
        let mut conditioned = Vec::new();
        while self.pending_mono.len() >= RESAMPLE_CHUNK {
            let rest = self.pending_mono.split_off(RESAMPLE_CHUNK);
            let block = std::mem::replace(&mut self.pending_mono, rest);
            let output = self
                .resampler
                .as_mut()
                .expect("resampler checked above")
                .process(&[block], None)
                .map_err(|e| format!("Sinc resampling failed: {e}"))?;
            if let Some(channel) = output.into_iter().next() {
                conditioned.extend(channel);
            }
        }
        Ok(conditioned)
    }

    /// Flush the short native tail when capture ends. Padding is preferable to
    /// silently losing the final phoneme; VAD sees the padded zeros as silence.
    pub fn flush(&mut self) -> Result<Vec<f32>, String> {
        if self.pending_mono.is_empty() {
            return Ok(Vec::new());
        }
        if self.resampler.is_none() {
            return Ok(std::mem::take(&mut self.pending_mono));
        }

        self.pending_mono.resize(RESAMPLE_CHUNK, 0.0);
        let block = std::mem::take(&mut self.pending_mono);
        let output = self
            .resampler
            .as_mut()
            .expect("resampler checked above")
            .process(&[block], None)
            .map_err(|e| format!("Sinc resampling flush failed: {e}"))?;
        Ok(output.into_iter().next().unwrap_or_default())
    }
}

pub fn mix_interleaved_to_mono(input: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return input.to_vec();
    }

    input
        .chunks(channels)
        .map(|frame| {
            if frame.is_empty() {
                return 0.0;
            }
            frame.iter().copied().sum::<f32>() / frame.len() as f32
        })
        .collect()
}

pub fn rms_level(input: &[f32]) -> f32 {
    if input.is_empty() {
        return 0.0;
    }
    let energy = input
        .iter()
        .map(|sample| (*sample as f64) * (*sample as f64))
        .sum::<f64>()
        / input.len() as f64;
    energy.sqrt().min(1.0) as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arbitrary_channel_count_downmixes_without_pair_assumptions() {
        let input = [1.0, 0.0, -1.0, 0.5, 0.5, 0.5];
        assert_eq!(mix_interleaved_to_mono(&input, 3), vec![0.0, 0.5]);
    }

    #[test]
    fn incomplete_trailing_frame_is_averaged_safely() {
        assert_eq!(mix_interleaved_to_mono(&[1.0, -1.0, 0.25], 2), vec![0.0, 0.25]);
    }

    #[test]
    fn same_rate_conditioning_preserves_mono_samples() {
        let mut conditioner = StreamingAudioConditioner::new(16_000, 1).unwrap();
        assert_eq!(conditioner.push_interleaved(&[0.1, -0.2, 0.3]).unwrap(), vec![0.1, -0.2, 0.3]);
    }
}
