//! On-device speech-to-text via transcribe.cpp (GGUF models: Parakeet,
//! Whisper, Moonshine, ...). One engine serves every capture channel; each
//! call transcribes one VAD-delimited utterance of 16 kHz mono f32 audio.

use std::path::Path;
use std::sync::Once;

use transcribe_cpp::{
    Backend, ExtSlot, Feature, Model, ModelOptions, ParakeetVocabularyOptions, RunExtension, RunOptions, Session,
};

use super::model_manager::SttModelSpec;

pub const SAMPLE_RATE: usize = 16_000;

/// Trailing silence appended to each utterance. Transducer models (Parakeet)
/// emit the final word only once they see a little audio after it; without
/// padding, clips that end abruptly at the VAD boundary lose their last word.
const TRAILING_PAD_SAMPLES: usize = SAMPLE_RATE * 3 / 10;

/// Glossary limits (hex's caps): enough for names and jargon, small enough
/// that biasing stays fast and precise.
const MAX_GLOSSARY_TERMS: usize = 64;
const MAX_TERM_CHARS: usize = 48;
/// Moderate bias, in nats: a term may score this much below what was heard
/// and still win (hex's "Normal" setting).
const PARAKEET_BOOST_NATS: f32 = 2.5;
/// Whisper's context prompt budget for glossary terms.
const PROMPT_MAX_CHARS: usize = 224;

/// How this engine applies the user's glossary.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GlossaryMode {
    /// Parakeet rescoring biases decoding toward the terms.
    Bias,
    /// Whisper-style models read the terms as context.
    Prompt,
    /// The model can't use a glossary, or none was given.
    None,
}

/// One glossary line: `Term` or `Term = mishearing, mishearing`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GlossaryEntry {
    pub term: String,
    /// Spellings the model produces for this term; rewritten to `term` after
    /// transcription (whole words, case-insensitive), for every model.
    pub sounds_like: Vec<String>,
}

fn clean_phrase(raw: &str) -> Option<String> {
    if raw.chars().any(char::is_control) {
        return None;
    }
    let phrase = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    (!phrase.is_empty()).then(|| phrase.chars().take(MAX_TERM_CHARS).collect())
}

/// Parse glossary lines: trim, drop empties and control characters,
/// de-duplicate terms case-insensitively, and cap count and length.
pub fn parse_glossary(lines: &[String]) -> Vec<GlossaryEntry> {
    let mut seen = std::collections::HashSet::new();
    lines
        .iter()
        .filter_map(|line| {
            let (term, alts) = match line.split_once('=') {
                Some((term, alts)) => (term, alts),
                None => (line.as_str(), ""),
            };
            let term = clean_phrase(term)?;
            let sounds_like = alts
                .split(',')
                .filter_map(clean_phrase)
                .filter(|alt| !alt.eq_ignore_ascii_case(&term))
                .take(8)
                .collect();
            Some(GlossaryEntry { term, sounds_like })
        })
        .filter(|entry| seen.insert(entry.term.to_lowercase()))
        .take(MAX_GLOSSARY_TERMS)
        .collect()
}

/// The glossary's terms alone, in order.
pub fn sanitize_glossary(lines: &[String]) -> Vec<String> {
    parse_glossary(lines).into_iter().map(|e| e.term).collect()
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '\'' || c == '\u{2019}'
}

/// Replace whole-word, case-insensitive occurrences of each mishearing with
/// its glossary term. Longer mishearings are applied first.
pub fn apply_sounds_like(text: &str, entries: &[GlossaryEntry]) -> String {
    let mut rules: Vec<(&str, &str)> = entries
        .iter()
        .flat_map(|e| e.sounds_like.iter().map(move |alt| (alt.as_str(), e.term.as_str())))
        .collect();
    if rules.is_empty() {
        return text.to_string();
    }
    rules.sort_by_key(|(alt, _)| std::cmp::Reverse(alt.chars().count()));
    let mut out = text.to_string();
    for (alt, term) in rules {
        let lower = out.to_lowercase();
        let alt_lower = alt.to_lowercase();
        // Lowercasing can change byte lengths for some scripts; only rewrite
        // when offsets line up (always true for ASCII mishearings).
        if lower.len() != out.len() {
            continue;
        }
        let mut result = String::with_capacity(out.len());
        let mut cursor = 0;
        while let Some(found) = lower[cursor..].find(&alt_lower) {
            let start = cursor + found;
            let end = start + alt_lower.len();
            let before_ok = out[..start].chars().next_back().is_none_or(|c| !is_word_char(c));
            let after_ok = out[end..].chars().next().is_none_or(|c| !is_word_char(c));
            result.push_str(&out[cursor..start]);
            if before_ok && after_ok {
                result.push_str(term);
            } else {
                result.push_str(&out[start..end]);
            }
            cursor = end;
        }
        result.push_str(&out[cursor..]);
        out = result;
    }
    out
}

/// Comma-separated terms that fit the prompt budget, in list order.
fn glossary_prompt(terms: &[String]) -> Option<String> {
    let mut prompt = String::new();
    for term in terms {
        let sep = if prompt.is_empty() { "" } else { ", " };
        if prompt.chars().count() + sep.len() + term.chars().count() > PROMPT_MAX_CHARS {
            break;
        }
        prompt.push_str(sep);
        prompt.push_str(term);
    }
    (!prompt.is_empty()).then_some(prompt)
}

/// Clips shorter than this are VAD blips (clicks, breaths), not speech.
const MIN_UTTERANCE_SAMPLES: usize = SAMPLE_RATE / 4;

static LOGGING: Once = Once::new();

pub struct SttEngine {
    session: Session,
    options: RunOptions,
    pub model_name: &'static str,
    pub backend: String,
    pub glossary_mode: GlossaryMode,
    glossary: Vec<GlossaryEntry>,
}

impl SttEngine {
    /// Load a GGUF model. `prefer_gpu` lets transcribe.cpp pick the best
    /// device (GPU when this build has a GPU backend); otherwise strict CPU.
    pub fn load(spec: &'static SttModelSpec, path: &Path, prefer_gpu: bool, glossary: &[String]) -> Result<Self, String> {
        LOGGING.call_once(|| {
            if std::env::var_os("PRMPTR_STT_DEBUG").is_some() {
                transcribe_cpp::init_logging();
            } else {
                transcribe_cpp::disable_logging();
            }
        });

        let options = ModelOptions {
            backend: if prefer_gpu { Backend::Auto } else { Backend::Cpu },
            ..Default::default()
        };
        let model = Model::load_with(path, &options)
            .or_else(|err| {
                if prefer_gpu {
                    log::warn!("GPU model load failed ({err}); retrying on CPU");
                    Model::load_with(path, &ModelOptions { backend: Backend::Cpu, ..Default::default() })
                } else {
                    Err(err)
                }
            })
            .map_err(|e| format!("Failed to load speech model '{}': {e}", spec.name))?;
        let backend = model.backend();
        let session = model
            .session()
            .map_err(|e| format!("Failed to start speech model session: {e}"))?;

        let accepts_hint = model
            .capabilities()
            .map(|caps| !caps.languages.is_empty())
            .unwrap_or(false);
        let mut run_options = RunOptions {
            language: if accepts_hint {
                spec.language_hint.map(str::to_string)
            } else {
                None
            },
            ..Default::default()
        };

        let entries = parse_glossary(glossary);
        let terms: Vec<String> = entries.iter().map(|e| e.term.clone()).collect();
        let mut glossary_mode = GlossaryMode::None;
        if !terms.is_empty() {
            if model.accepts_ext(ExtSlot::Run, transcribe_cpp::sys::TRANSCRIBE_EXT_KIND_PARAKEET_VOCABULARY) {
                run_options.vocabulary = terms.clone();
                run_options.family = Some(RunExtension::ParakeetVocabulary(ParakeetVocabularyOptions {
                    boost: Some(PARAKEET_BOOST_NATS),
                    sounds_like: Vec::new(),
                }));
                glossary_mode = GlossaryMode::Bias;
            } else if model.supports(Feature::ContextPrompt) {
                run_options.prompt = glossary_prompt(&terms);
                glossary_mode = GlossaryMode::Prompt;
            }
        }

        log::info!(
            "Speech model loaded: {} on {backend}; glossary: {} terms ({glossary_mode:?})",
            spec.name,
            terms.len()
        );
        Ok(Self {
            session,
            options: run_options,
            model_name: spec.name,
            backend,
            glossary_mode,
            glossary: entries,
        })
    }

    pub fn transcribe(&mut self, audio: &[f32], device_label: &str) -> Option<String> {
        if audio.len() < MIN_UTTERANCE_SAMPLES {
            return None;
        }
        let mut padded = Vec::with_capacity(audio.len() + TRAILING_PAD_SAMPLES);
        padded.extend_from_slice(audio);
        padded.resize(audio.len() + TRAILING_PAD_SAMPLES, 0.0);

        let started = std::time::Instant::now();
        let result = match self.session.run(&padded, &self.options) {
            Ok(r) => r,
            Err(e) => {
                log::error!("[{device_label}] Transcription failed: {e}");
                return None;
            }
        };
        log::debug!(
            "[{device_label}] {:.1}s audio transcribed in {} ms",
            audio.len() as f32 / SAMPLE_RATE as f32,
            started.elapsed().as_millis()
        );
        clean_transcript(&result.text).map(|text| apply_sounds_like(&text, &self.glossary))
    }
}

/// Normalize model output and drop well-known non-speech hallucinations
/// ("Thank you.", "[BLANK_AUDIO]", lone filler words) that ASR models emit on
/// noise that slipped past the VAD.
pub fn clean_transcript(raw: &str) -> Option<String> {
    let text = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.chars().filter(|c| c.is_alphanumeric()).count() < 2 {
        return None;
    }
    let lower = text.to_lowercase();
    let bare: String = lower
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect();
    let bare = bare.trim();
    const HALLUCINATIONS: &[&str] = &[
        "you",
        "the",
        "thank you",
        "thanks for watching",
        "thank you for watching",
        "bye",
        "uh",
        "um",
        "hmm",
        "mm",
    ];
    if HALLUCINATIONS.contains(&bare)
        || lower.contains("[blank_audio]")
        || lower.contains("(blank audio)")
        || (text.starts_with('[') && text.ends_with(']'))
        || (text.starts_with('(') && text.ends_with(')'))
    {
        return None;
    }
    Some(text)
}

/// Compute devices transcribe.cpp can use in this build.
pub fn available_devices() -> Vec<(String, String, bool)> {
    transcribe_cpp::devices()
        .into_iter()
        .map(|d| {
            let is_gpu = matches!(
                d.device_type,
                transcribe_cpp::DeviceType::Gpu | transcribe_cpp::DeviceType::Igpu
            );
            (d.kind.to_string(), d.description.trim().to_string(), is_gpu)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::clean_transcript;

    #[test]
    fn keeps_real_speech_and_collapses_whitespace() {
        assert_eq!(
            clean_transcript("  Hello   there,\n how are you? ").as_deref(),
            Some("Hello there, how are you?")
        );
    }

    #[test]
    fn drops_hallucinations_and_tags() {
        for junk in ["", " . ", "Thank you.", "you", "[BLANK_AUDIO]", "(music)", "[Applause]", "Um.", "a"] {
            assert_eq!(clean_transcript(junk), None, "{junk:?} should be dropped");
        }
    }

    #[test]
    fn glossary_is_cleaned_deduplicated_and_capped() {
        let long = "x".repeat(80);
        let raw: Vec<String> = ["  Kubernetes ", "kubernetes", "", "Sarah\nO'Neil", "PR  MPTR", long.as_str()]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let clean = super::sanitize_glossary(&raw);
        assert_eq!(clean, vec!["Kubernetes".to_string(), "PR MPTR".to_string(), "x".repeat(48)]);
        let many: Vec<String> = (0..100).map(|i| format!("term{i}")).collect();
        assert_eq!(super::sanitize_glossary(&many).len(), 64);
    }

    #[test]
    fn glossary_lines_parse_terms_and_mishearings() {
        let lines = vec!["Saoirse = Sayers, Sersha".to_string(), "Qdrant=Drant".to_string(), "Grafana".to_string()];
        let entries = super::parse_glossary(&lines);
        assert_eq!(entries[0].term, "Saoirse");
        assert_eq!(entries[0].sounds_like, vec!["Sayers", "Sersha"]);
        assert_eq!(entries[1].sounds_like, vec!["Drant"]);
        assert!(entries[2].sounds_like.is_empty());
    }

    #[test]
    fn mishearings_are_rewritten_as_whole_words_only() {
        let entries = super::parse_glossary(&[
            "Saoirse = Sayers".to_string(),
            "Tadhg = Tad".to_string(),
            "Qdrant = Drant".to_string(),
        ]);
        assert_eq!(
            super::apply_sounds_like("Ask Sayers and Tad to ship to Drant by Thursday.", &entries),
            "Ask Saoirse and Tadhg to ship to Qdrant by Thursday."
        );
        // No partial-word rewrites: "Tadpole" and "today" stay intact.
        assert_eq!(super::apply_sounds_like("A tadpole, today.", &entries), "A tadpole, today.");
        assert_eq!(super::apply_sounds_like("sayers' notes", &entries), "sayers' notes");
    }

    #[test]
    fn glossary_prompt_respects_budget() {
        let terms: Vec<String> = (0..100).map(|i| format!("Term{i:03}")).collect();
        let prompt = super::glossary_prompt(&terms).unwrap();
        assert!(prompt.chars().count() <= 224);
        assert!(prompt.starts_with("Term000, Term001"));
    }

    #[test]
    fn keeps_sentences_containing_thanks() {
        assert!(clean_transcript("Thank you for the update on Friday.").is_some());
    }
}
