//! Capture → speech-model audio frontend, shared by local and Deepgram capture.
//!
//! Devices deliver interleaved audio at whatever rate and channel count they
//! like (48 kHz stereo, 44.1 kHz 8-channel loopback, …). Speech models want
//! 16 kHz mono. Two details matter for accuracy:
//!
//! - **Downmix any channel count**, not just stereo: surround / USB headset
//!   loopback devices expose 6–8 channels, and pairing samples as if stereo
//!   scrambles the signal.
//! - **Band-limited resampling.** Naive linear interpolation from 48 kHz to
//!   16 kHz has no anti-alias filter, so energy above 8 kHz folds back into
//!   the speech band as noise. rubato's FFT resampler (the same one hex uses
//!   for Parakeet) low-passes before decimating.
//!
//! Ported from the greenfield-speech-core branch's capture conditioner and
//! updated to rubato 5.

use rubato::audioadapter_buffers::direct::InterleavedSlice;
use rubato::{Fft, FixedSync, Resampler, WindowFunction};

pub const TARGET_RATE: usize = 16_000;
const CHUNK: usize = 1024;

pub struct AudioConditioner {
    channels: usize,
    resampler: Option<Fft<f32>>,
    pending: Vec<f32>,
}

impl AudioConditioner {
    pub fn new(native_rate: u32, channels: usize) -> Result<Self, String> {
        if native_rate == 0 || channels == 0 {
            return Err(format!("Unsupported capture format: {native_rate} Hz, {channels} channels"));
        }
        let resampler = (native_rate as usize != TARGET_RATE)
            .then(|| {
                Fft::new_custom(
                    native_rate as usize,
                    TARGET_RATE,
                    CHUNK,
                    1,
                    1,
                    WindowFunction::BlackmanHarris2,
                    FixedSync::Input,
                )
                .map_err(|e| format!("Failed to initialise resampler: {e}"))
            })
            .transpose()?;
        Ok(Self { channels, resampler, pending: Vec::with_capacity(CHUNK * 2) })
    }

    /// Feed one interleaved callback buffer; returns any 16 kHz mono audio
    /// that became available (input is processed in fixed 1024-frame blocks).
    pub fn push(&mut self, interleaved: &[f32]) -> Vec<f32> {
        let mono = mix_to_mono(interleaved, self.channels);
        let Some(resampler) = self.resampler.as_mut() else {
            return mono;
        };
        self.pending.extend_from_slice(&mono);
        let mut out = Vec::new();
        let mut start = 0;
        while self.pending.len() - start >= CHUNK {
            let block = &self.pending[start..start + CHUNK];
            let input = InterleavedSlice::new(block, 1, CHUNK).expect("mono block fits its slice");
            match resampler.process(&input, None) {
                Ok(buffer) => out.extend(buffer.take_data()),
                Err(e) => log::warn!("resampling failed: {e}"),
            }
            start += CHUNK;
        }
        self.pending.drain(..start);
        out
    }
}

/// Average every frame of an interleaved buffer down to one channel.
pub fn mix_to_mono(input: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return input.to_vec();
    }
    input
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
        .collect()
}

/// RMS level of a mono buffer, clamped to 0..1 (UI activity meters).
pub fn rms_level(input: &[f32]) -> f32 {
    if input.is_empty() {
        return 0.0;
    }
    let energy = input.iter().map(|&s| (s as f64) * (s as f64)).sum::<f64>() / input.len() as f64;
    energy.sqrt().min(1.0) as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(freq: f32, rate: u32, secs: f32, channels: usize) -> Vec<f32> {
        let n = (rate as f32 * secs) as usize;
        (0..n)
            .flat_map(|i| {
                let s = (2.0 * std::f32::consts::PI * freq * i as f32 / rate as f32).sin() * 0.5;
                std::iter::repeat_n(s, channels)
            })
            .collect()
    }

    fn rms(x: &[f32]) -> f32 {
        rms_level(x)
    }

    #[test]
    fn downmixes_any_channel_count() {
        assert_eq!(mix_to_mono(&[1.0, 0.0, -1.0, 0.5, 0.5, 0.5], 3), vec![0.0, 0.5]);
        assert_eq!(mix_to_mono(&[1.0, -1.0, 0.25], 2), vec![0.0, 0.25]);
    }

    #[test]
    fn same_rate_mono_passes_through() {
        let mut c = AudioConditioner::new(16_000, 1).unwrap();
        assert_eq!(c.push(&[0.1, -0.2, 0.3]), vec![0.1, -0.2, 0.3]);
    }

    #[test]
    fn resamples_48k_eight_channel_to_16k_mono_at_the_right_length() {
        let mut c = AudioConditioner::new(48_000, 8).unwrap();
        let mut out = Vec::new();
        for chunk in tone(440.0, 48_000, 1.0, 8).chunks(480 * 8) {
            out.extend(c.push(chunk));
        }
        // One second in → ~one second out, minus one pending input block and
        // the FFT resampler's fixed start-up delay (~20 ms).
        assert!((15_200..=16_000).contains(&out.len()), "{}", out.len());
        // A speech-band tone survives.
        assert!(rms(&out[2000..]) > 0.3, "rms {}", rms(&out[2000..]));
    }

    #[test]
    fn removes_content_above_the_speech_band_instead_of_aliasing_it() {
        // 12 kHz cannot exist at 16 kHz; linear interpolation folds it to
        // 4 kHz noise. The band-limited resampler must suppress it.
        let mut c = AudioConditioner::new(48_000, 1).unwrap();
        let mut out = Vec::new();
        for chunk in tone(12_000.0, 48_000, 1.0, 1).chunks(480) {
            out.extend(c.push(chunk));
        }
        assert!(rms(&out[2000..]) < 0.02, "aliased energy {}", rms(&out[2000..]));
    }
}
