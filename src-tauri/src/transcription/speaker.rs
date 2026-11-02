use sherpa_rs::embedding_manager::EmbeddingManager;
use sherpa_rs::speaker_id::{EmbeddingExtractor, ExtractorConfig, DEFAULT_SIMILARITY_THRESHOLD};

/// Result of speaker identification for a speech segment.
pub struct SpeakerResult {
    pub speaker_id: i32,
    pub speaker_label: String,
    pub is_new_speaker: bool,
}

/// Tracks speakers by extracting voice embeddings and matching against known speakers.
/// One instance per device (input/output) so speakers are tracked independently.
pub struct SpeakerTracker {
    extractor: EmbeddingExtractor,
    manager: EmbeddingManager,
    next_speaker_id: i32,
}

impl SpeakerTracker {
    pub fn new(model_path: &str) -> Result<Self, String> {
        let config = ExtractorConfig {
            model: model_path.to_string(),
            ..Default::default()
        };
        let extractor = EmbeddingExtractor::new(config)
            .map_err(|e| format!("Failed to create EmbeddingExtractor: {e}"))?;
        let dim = extractor.embedding_size as i32;
        let manager = EmbeddingManager::new(dim);
        Ok(Self {
            extractor,
            manager,
            next_speaker_id: 1,
        })
    }

    /// Extract a voice embedding from audio and identify (or register) the speaker.
    pub fn identify_speaker(&mut self, audio: &[f32], sample_rate: u32) -> Option<SpeakerResult> {
        let mut embedding = match self
            .extractor
            .compute_speaker_embedding(audio.to_vec(), sample_rate)
        {
            Ok(e) => e,
            Err(e) => {
                log::warn!("Speaker embedding extraction failed: {e}");
                return None;
            }
        };

        // Search existing speakers
        if let Some(name) = self.manager.search(&embedding, DEFAULT_SIMILARITY_THRESHOLD) {
            // Parse "Speaker N" → N
            let id = name
                .strip_prefix("Speaker ")
                .and_then(|n| n.parse::<i32>().ok())
                .unwrap_or(0);
            return Some(SpeakerResult {
                speaker_id: id,
                speaker_label: name,
                is_new_speaker: false,
            });
        }

        // New speaker — register
        let id = self.next_speaker_id;
        let label = format!("Speaker {id}");
        if let Err(e) = self.manager.add(label.clone(), &mut embedding) {
            log::warn!("Failed to register speaker: {e}");
            return None;
        }
        self.next_speaker_id += 1;

        Some(SpeakerResult {
            speaker_id: id,
            speaker_label: label,
            is_new_speaker: true,
        })
    }

    /// Clear all tracked speakers (e.g. on stop/restart).
    pub fn reset(&mut self) {
        let dim = self.extractor.embedding_size as i32;
        self.manager = EmbeddingManager::new(dim);
        self.next_speaker_id = 1;
    }
}
