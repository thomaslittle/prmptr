#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranscriptFilterReason {
    Empty,
    ExplicitBlankAudioMarker,
}

/// Conservative transcript filtering policy for the greenfield path.
/// Common spoken phrases are always valid. Only explicit non-speech control
/// markers are rejected here; confidence/VAD policy belongs in the engine layer.
pub fn transcript_filter_reason(text: &str) -> Option<TranscriptFilterReason> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Some(TranscriptFilterReason::Empty);
    }

    let lower = trimmed.to_lowercase();
    if lower == "[blank_audio]" || lower == "(blank audio)" {
        return Some(TranscriptFilterReason::ExplicitBlankAudioMarker);
    }

    None
}

pub fn transcript_is_acceptable(text: &str) -> bool {
    transcript_filter_reason(text).is_none()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legitimate_short_phrases_are_not_blacklisted() {
        for phrase in ["you", "the", "thank you.", "thanks", "yes", "no"] {
            assert!(transcript_is_acceptable(phrase), "phrase should survive: {phrase}");
        }
    }

    #[test]
    fn explicit_blank_audio_markers_are_filtered() {
        assert_eq!(
            transcript_filter_reason("[blank_audio]"),
            Some(TranscriptFilterReason::ExplicitBlankAudioMarker)
        );
        assert_eq!(
            transcript_filter_reason("(blank audio)"),
            Some(TranscriptFilterReason::ExplicitBlankAudioMarker)
        );
    }

    #[test]
    fn arbitrary_bracketed_speech_is_not_dropped() {
        assert!(transcript_is_acceptable("[laughs] that was wild"));
        assert!(transcript_is_acceptable("[you] are up next"));
    }
}
