use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;

#[derive(Debug, Default)]
pub struct AudioPipelineMetrics {
    native_samples_received: AtomicU64,
    muted_native_samples: AtomicU64,
    conditioned_samples_emitted: AtomicU64,
    chunks_enqueued: AtomicU64,
    chunks_dropped: AtomicU64,
    samples_dropped: AtomicU64,
    capture_errors: AtomicU64,
    resampler_errors: AtomicU64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AudioPipelineSnapshot {
    pub native_samples_received: u64,
    pub muted_native_samples: u64,
    pub conditioned_samples_emitted: u64,
    pub chunks_enqueued: u64,
    pub chunks_dropped: u64,
    pub samples_dropped: u64,
    pub capture_errors: u64,
    pub resampler_errors: u64,
}

impl AudioPipelineMetrics {
    pub fn record_native_samples(&self, count: usize) {
        self.native_samples_received.fetch_add(count as u64, Ordering::Relaxed);
    }

    pub fn record_muted_samples(&self, count: usize) {
        self.muted_native_samples.fetch_add(count as u64, Ordering::Relaxed);
    }

    pub fn record_conditioned_samples(&self, count: usize) {
        self.conditioned_samples_emitted.fetch_add(count as u64, Ordering::Relaxed);
    }

    pub fn record_enqueued(&self) {
        self.chunks_enqueued.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_drop(&self, samples: usize) {
        self.chunks_dropped.fetch_add(1, Ordering::Relaxed);
        self.samples_dropped.fetch_add(samples as u64, Ordering::Relaxed);
    }

    pub fn record_capture_error(&self) {
        self.capture_errors.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_resampler_error(&self) {
        self.resampler_errors.fetch_add(1, Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> AudioPipelineSnapshot {
        AudioPipelineSnapshot {
            native_samples_received: self.native_samples_received.load(Ordering::Relaxed),
            muted_native_samples: self.muted_native_samples.load(Ordering::Relaxed),
            conditioned_samples_emitted: self.conditioned_samples_emitted.load(Ordering::Relaxed),
            chunks_enqueued: self.chunks_enqueued.load(Ordering::Relaxed),
            chunks_dropped: self.chunks_dropped.load(Ordering::Relaxed),
            samples_dropped: self.samples_dropped.load(Ordering::Relaxed),
            capture_errors: self.capture_errors.load(Ordering::Relaxed),
            resampler_errors: self.resampler_errors.load(Ordering::Relaxed),
        }
    }
}
