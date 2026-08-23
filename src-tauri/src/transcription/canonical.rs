use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptTrackId {
    Mic,
    System,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptRole {
    You,
    Them,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranscriptWord {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confidence: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SpeakerSpan {
    pub speaker_key: String,
    pub speaker_index: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub start_ms: u64,
    pub end_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_char: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_char: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranscriptLine {
    pub id: String,
    pub revision: u64,
    pub track_id: TranscriptTrackId,
    pub role: TranscriptRole,
    pub engine: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_version: Option<String>,
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub is_complete: bool,
    #[serde(default)]
    pub words: Vec<TranscriptWord>,
    #[serde(default)]
    pub speaker_spans: Vec<SpeakerSpan>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Default)]
pub struct TranscriptReducer {
    lines: Vec<TranscriptLine>,
}

impl TranscriptReducer {
    pub fn lines(&self) -> &[TranscriptLine] {
        &self.lines
    }

    /// Upsert one logical line by stable ID. Older revisions are ignored;
    /// same-revision updates are accepted only when their update timestamp is newer.
    pub fn upsert(&mut self, incoming: TranscriptLine) -> bool {
        if let Some(existing) = self.lines.iter_mut().find(|line| line.id == incoming.id) {
            if incoming.revision < existing.revision {
                return false;
            }
            if incoming.revision == existing.revision && incoming.updated_at <= existing.updated_at {
                return false;
            }
            *existing = incoming;
            return true;
        }
        self.lines.push(incoming);
        true
    }

    pub fn retain_newer_than(&mut self, cutoff: DateTime<Utc>) {
        self.lines.retain(|line| line.updated_at > cutoff);
    }

    pub fn clear(&mut self) {
        self.lines.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(revision: u64, text: &str, updated_offset_ms: i64) -> TranscriptLine {
        let created_at = Utc::now();
        TranscriptLine {
            id: "stable-line".to_string(),
            revision,
            track_id: TranscriptTrackId::System,
            role: TranscriptRole::Them,
            engine: "moonshine".to_string(),
            model: "medium-streaming".to_string(),
            model_version: None,
            text: text.to_string(),
            start_ms: 100,
            end_ms: 900,
            is_complete: false,
            words: Vec::new(),
            speaker_spans: Vec::new(),
            latency_ms: None,
            created_at,
            updated_at: created_at + chrono::Duration::milliseconds(updated_offset_ms),
        }
    }

    #[test]
    fn stable_id_revisions_replace_in_place() {
        let mut reducer = TranscriptReducer::default();
        assert!(reducer.upsert(line(0, "partial", 0)));
        assert!(reducer.upsert(line(1, "final", 1)));
        assert_eq!(reducer.lines().len(), 1);
        assert_eq!(reducer.lines()[0].text, "final");
        assert_eq!(reducer.lines()[0].revision, 1);
    }

    #[test]
    fn stale_revision_cannot_replace_newer_line() {
        let mut reducer = TranscriptReducer::default();
        assert!(reducer.upsert(line(3, "new", 0)));
        assert!(!reducer.upsert(line(2, "old", 10)));
        assert_eq!(reducer.lines()[0].text, "new");
    }

    #[test]
    fn speaker_only_same_revision_update_can_advance_by_time() {
        let mut reducer = TranscriptReducer::default();
        let original = line(2, "same text", 0);
        let mut speaker_update = line(2, "same text", 1);
        speaker_update.speaker_spans.push(SpeakerSpan {
            speaker_key: "system:1".to_string(),
            speaker_index: 1,
            label: Some("Speaker 1".to_string()),
            start_ms: 100,
            end_ms: 900,
            start_char: Some(0),
            end_char: Some(9),
        });
        assert!(reducer.upsert(original));
        assert!(reducer.upsert(speaker_update));
        assert_eq!(reducer.lines()[0].speaker_spans.len(), 1);
    }
}
