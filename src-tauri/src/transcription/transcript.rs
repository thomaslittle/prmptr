use std::collections::HashSet;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptEntry {
    pub id: String,
    pub text: String,
    pub timestamp: DateTime<Utc>,
    pub source: String,
    pub speaker: Option<i32>,
    pub is_final: bool,
}

pub struct TranscriptBuffer {
    entries: Vec<TranscriptEntry>,
    seen_ids: HashSet<String>,
    window_secs: u64,
}

impl TranscriptBuffer {
    pub fn new(window_secs: u64) -> Self {
        Self {
            entries: Vec::new(),
            seen_ids: HashSet::new(),
            window_secs,
        }
    }

    /// Add an entry, deduplicating by ID
    pub fn push(&mut self, entry: TranscriptEntry) -> bool {
        if self.seen_ids.contains(&entry.id) {
            return false;
        }
        self.seen_ids.insert(entry.id.clone());
        self.entries.push(entry);
        self.prune();
        true
    }

    /// Update an existing entry (same ID) with new text, or insert if new.
    /// Used for partial transcription results that update in-place until finalized.
    pub fn update_or_push(&mut self, entry: TranscriptEntry) {
        if let Some(existing) = self.entries.iter_mut().find(|e| e.id == entry.id) {
            existing.text = entry.text;
            existing.is_final = entry.is_final;
            existing.timestamp = entry.timestamp;
        } else {
            self.seen_ids.insert(entry.id.clone());
            self.entries.push(entry);
            self.prune();
        }
    }

    /// Get all entries within the rolling window
    pub fn entries(&self) -> &[TranscriptEntry] {
        &self.entries
    }

    /// Get formatted transcript text for LLM context
    pub fn formatted_text(&self) -> String {
        self.entries
            .iter()
            .map(|e| {
                let speaker = e.speaker
                    .map(|s| format!("Speaker {}", s))
                    .unwrap_or_else(|| "Unknown".to_string());
                let time = e.timestamp.format("%H:%M:%S").to_string();
                format!("[{}] {} ({}): {}", time, speaker, e.source, e.text)
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Remove entries outside the rolling window
    fn prune(&mut self) {
        let cutoff = Utc::now() - chrono::Duration::seconds(self.window_secs as i64);
        let old_len = self.entries.len();
        self.entries.retain(|e| e.timestamp > cutoff);

        // Clean up seen_ids for removed entries
        if self.entries.len() < old_len {
            let active_ids: HashSet<&str> = self.entries.iter().map(|e| e.id.as_str()).collect();
            self.seen_ids.retain(|id| active_ids.contains(id.as_str()));
        }
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.seen_ids.clear();
    }

    pub fn set_window(&mut self, secs: u64) {
        self.window_secs = secs;
        self.prune();
    }
}
