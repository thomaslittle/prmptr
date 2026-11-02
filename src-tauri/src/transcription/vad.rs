//! Voice activity detection with Silero VAD v6.2, run by transcribe.cpp.
//!
//! Like hex, PRMPTR never hands silence or room noise to the ASR model —
//! that is where "Thank you." / "you" hallucinations come from. transcribe.cpp
//! streams one speech probability per 32 ms frame; `Segmenter` turns those
//! into utterances with Silero's usual hysteresis (start above `threshold`,
//! end after `min_silence` below `neg_threshold`).

use std::path::Path;

use transcribe_cpp::{Model, VadSession};

use super::stt_engine::SAMPLE_RATE;

#[derive(Clone, Copy, Debug)]
pub struct SegmenterConfig {
    pub threshold: f32,
    pub neg_threshold: f32,
    pub min_speech_samples: usize,
    pub min_silence_samples: usize,
    pub max_speech_samples: usize,
}

impl Default for SegmenterConfig {
    fn default() -> Self {
        Self {
            // Slightly below Silero's 0.5 so soft sentence onsets trigger.
            threshold: 0.45,
            neg_threshold: 0.3,
            min_speech_samples: SAMPLE_RATE / 5,          // 200 ms
            min_silence_samples: SAMPLE_RATE * 3 / 10,    // 300 ms: quick turn splits
            max_speech_samples: SAMPLE_RATE * 10,         // cap over-grouping
        }
    }
}

/// A finished utterance. `start` is the absolute sample index in the stream.
pub struct SpeechSegment {
    pub start: i32,
    pub samples: Vec<f32>,
}

/// Pure probability → segment state machine (no model), for testing.
pub struct Segmenter {
    config: SegmenterConfig,
    frame: usize,
    /// Audio retained from `base` onward (absolute sample index of `audio[0]`).
    audio: Vec<f32>,
    base: usize,
    /// Absolute index of the next frame's first sample.
    cursor: usize,
    speech_start: Option<usize>,
    silence_start: Option<usize>,
    ready: std::collections::VecDeque<SpeechSegment>,
}

impl Segmenter {
    pub fn new(config: SegmenterConfig, frame: usize) -> Self {
        Self {
            config,
            frame,
            audio: Vec::new(),
            base: 0,
            cursor: 0,
            speech_start: None,
            silence_start: None,
            ready: Default::default(),
        }
    }

    pub fn push_audio(&mut self, samples: &[f32]) {
        self.audio.extend_from_slice(samples);
    }

    fn slice(&self, from: usize, to: usize) -> Vec<f32> {
        let from = from.max(self.base) - self.base;
        let to = to.max(self.base).min(self.base + self.audio.len()) - self.base;
        self.audio[from..to.max(from)].to_vec()
    }

    fn emit(&mut self, start: usize, end: usize) {
        if end.saturating_sub(start) >= self.config.min_speech_samples {
            let samples = self.slice(start, end);
            self.ready.push_back(SpeechSegment { start: start as i32, samples });
        }
    }

    /// Consume one probability per frame, in stream order.
    pub fn push_probs(&mut self, probs: &[f32]) {
        for &p in probs {
            let frame_start = self.cursor;
            let frame_end = frame_start + self.frame;
            self.cursor = frame_end;
            match self.speech_start {
                None if p >= self.config.threshold => {
                    self.speech_start = Some(frame_start);
                    self.silence_start = None;
                }
                None => {}
                Some(mut start) => {
                    // Split before this frame would push the utterance past the cap.
                    if frame_end - start > self.config.max_speech_samples && self.silence_start.is_none() {
                        self.emit(start, frame_start);
                        start = frame_start;
                        self.speech_start = Some(frame_start);
                    }
                    if p >= self.config.threshold {
                        self.silence_start = None;
                    } else if p < self.config.neg_threshold {
                        let silence = *self.silence_start.get_or_insert(frame_start);
                        if frame_end - silence >= self.config.min_silence_samples {
                            self.emit(start, silence);
                            self.speech_start = None;
                            self.silence_start = None;
                        }
                    }
                }
            }
        }
        self.trim();
    }

    /// Drop audio no future segment can reference.
    fn trim(&mut self) {
        let keep_from = self
            .speech_start
            .unwrap_or(self.cursor)
            .saturating_sub(SAMPLE_RATE); // small margin
        if keep_from > self.base {
            let drop = (keep_from - self.base).min(self.audio.len());
            self.audio.drain(..drop);
            self.base += drop;
        }
    }

    pub fn is_speech(&self) -> bool {
        self.speech_start.is_some() && self.silence_start.is_none()
    }

    pub fn finish(&mut self) {
        if let Some(start) = self.speech_start.take() {
            let end = self.silence_start.take().unwrap_or(self.base + self.audio.len());
            self.emit(start, end);
        }
    }

    pub fn has_segment(&self) -> bool {
        !self.ready.is_empty()
    }

    pub fn pop_segment(&mut self) -> Option<SpeechSegment> {
        self.ready.pop_front()
    }
}

/// Streaming speech detector: Silero VAD v6.2 probabilities + `Segmenter`.
pub struct SpeechDetector {
    session: VadSession,
    segmenter: Segmenter,
}

impl SpeechDetector {
    pub fn new(model_path: &Path) -> Result<Self, String> {
        let model = Model::load(model_path).map_err(|e| format!("Failed to load VAD model: {e}"))?;
        let frame = model
            .vad_info()
            .map(|info| info.frame_samples.max(1) as usize)
            .map_err(|e| format!("VAD model info: {e}"))?;
        let session = model.vad_session().map_err(|e| format!("Failed to start VAD: {e}"))?;
        Ok(Self {
            session,
            segmenter: Segmenter::new(SegmenterConfig::default(), frame),
        })
    }

    pub fn accept_waveform(&mut self, samples: &[f32]) {
        self.segmenter.push_audio(samples);
        match self.session.stream_feed(samples) {
            Ok(result) => self.segmenter.push_probs(&result.probs),
            Err(e) => log::warn!("VAD frame error: {e}"),
        }
    }

    pub fn is_speech(&self) -> bool {
        self.segmenter.is_speech()
    }

    pub fn has_segment(&self) -> bool {
        self.segmenter.has_segment()
    }

    pub fn pop_segment(&mut self) -> Option<SpeechSegment> {
        self.segmenter.pop_segment()
    }

    pub fn flush(&mut self) {
        if let Ok(result) = self.session.stream_flush() {
            self.segmenter.push_probs(&result.probs);
        }
        self.segmenter.finish();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FRAME: usize = 512; // 32 ms

    fn run(probs: &[f32]) -> Vec<(i32, usize)> {
        let mut s = Segmenter::new(SegmenterConfig::default(), FRAME);
        s.push_audio(&vec![0.1; probs.len() * FRAME]);
        s.push_probs(probs);
        s.finish();
        std::iter::from_fn(|| s.pop_segment()).map(|seg| (seg.start, seg.samples.len())).collect()
    }

    fn frames(ms: usize) -> usize {
        ms * SAMPLE_RATE / 1000 / FRAME
    }

    #[test]
    fn silence_produces_nothing() {
        assert!(run(&vec![0.05; 100]).is_empty());
    }

    #[test]
    fn one_utterance_with_exact_bounds() {
        let mut probs = vec![0.0; 10];
        probs.extend(vec![0.9; 30]); // ~960 ms speech
        probs.extend(vec![0.0; 20]);
        let segs = run(&probs);
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0], ((10 * FRAME) as i32, 30 * FRAME));
    }

    #[test]
    fn short_pause_does_not_split_but_long_pause_does() {
        let mut probs = vec![0.9; 20];
        probs.extend(vec![0.0; frames(150)]); // brief breath
        probs.extend(vec![0.9; 20]);
        probs.extend(vec![0.0; frames(600)]);
        probs.extend(vec![0.9; 20]);
        probs.extend(vec![0.0; 20]);
        assert_eq!(run(&probs).len(), 2);
    }

    #[test]
    fn blips_shorter_than_min_speech_are_dropped() {
        let mut probs = vec![0.0; 5];
        probs.extend(vec![0.9; 3]); // ~96 ms click
        probs.extend(vec![0.0; 30]);
        assert!(run(&probs).is_empty());
    }

    #[test]
    fn long_speech_is_split_at_max_length() {
        let probs = vec![0.9; frames(25_000)];
        let segs = run(&probs);
        assert!(segs.len() >= 3, "{segs:?}");
        assert!(segs.iter().all(|(_, len)| *len <= SegmenterConfig::default().max_speech_samples));
    }

    #[test]
    fn hysteresis_keeps_speech_through_mid_probabilities() {
        let mut probs = vec![0.9; 10];
        probs.extend(vec![0.35; 40]); // between neg_threshold and threshold
        probs.extend(vec![0.0; 20]);
        let segs = run(&probs);
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].1, 50 * FRAME);
    }
}
