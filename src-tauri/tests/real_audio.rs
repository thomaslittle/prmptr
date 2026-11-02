//! End-to-end speech pipeline on real audio: Silero VAD v6.2 segments a
//! recording, the production `SttEngine` (transcribe.cpp) transcribes each
//! segment. Needs the GGUF models on disk, so it only runs when
//! `PRMPTR_TEST_MODELS` points at a directory containing them:
//!
//!   PRMPTR_TEST_MODELS=/path/to/models cargo test --test real_audio
use std::path::PathBuf;

use prmptr_lib::transcription::model_manager::find_stt_model_spec;
use prmptr_lib::transcription::stt_engine::SttEngine;
use prmptr_lib::transcription::vad::SpeechDetector;

fn models_dir() -> Option<PathBuf> {
    std::env::var_os("PRMPTR_TEST_MODELS").map(PathBuf::from)
}

fn read_wav() -> Vec<f32> {
    read_wav_named("speech-16k.wav")
}

fn read_wav_named(name: &str) -> Vec<f32> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name);
    let bytes = std::fs::read(path).expect("fixture wav");
    // 16-bit PCM mono 16 kHz; samples follow the "data" chunk header.
    let data = bytes.windows(4).position(|w| w == b"data").expect("data chunk") + 8;
    bytes[data..]
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
        .collect()
}

#[test]
fn vad_segments_and_parakeet_transcribes_real_speech() {
    let Some(dir) = models_dir() else {
        eprintln!("skipped: set PRMPTR_TEST_MODELS to run");
        return;
    };
    let audio = read_wav();

    // Silence before and after, streamed in capture-sized chunks.
    let mut stream = vec![0.0f32; 16_000];
    stream.extend_from_slice(&audio);
    stream.extend(std::iter::repeat_n(0.0, 16_000));
    let mut vad = SpeechDetector::new(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models/silero-vad-v6.2-F32.gguf"))
        .expect("load Silero VAD v6.2");
    let mut segments = Vec::new();
    for chunk in stream.chunks(4_800) {
        vad.accept_waveform(chunk);
        while let Some(seg) = vad.pop_segment() {
            segments.push(seg);
        }
    }
    vad.flush();
    while let Some(seg) = vad.pop_segment() {
        segments.push(seg);
    }
    assert!(!segments.is_empty(), "VAD found no speech");
    assert!(segments[0].start >= 12_000, "leading silence must not be speech (start={})", segments[0].start);

    let spec = find_stt_model_spec("parakeet-unified-en").unwrap();
    let mut engine = SttEngine::load(spec, &dir.join(spec.filename), false, &[]).expect("load Parakeet");
    let text = segments
        .iter()
        .filter_map(|s| engine.transcribe(&s.samples, "test"))
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    eprintln!("transcript: {text}");
    for word in ["quarterly numbers", "kubernetes", "friday"] {
        assert!(text.contains(word), "missing {word:?} in {text:?}");
    }

    // The glossary reaches Parakeet as decoder biasing (transcribe.cpp fork
    // with vocabulary rescoring) and leaves a correct transcript intact.
    let glossary = vec!["Kubernetes".to_string(), "PRMPTR".to_string()];
    let mut biased = SttEngine::load(spec, &dir.join(spec.filename), false, &glossary).expect("load with glossary");
    assert_eq!(biased.glossary_mode, prmptr_lib::transcription::stt_engine::GlossaryMode::Bias);
    let biased_text = segments
        .iter()
        .filter_map(|s| biased.transcribe(&s.samples, "test"))
        .collect::<Vec<_>>()
        .join(" ");
    eprintln!("biased transcript: {biased_text}");
    assert!(biased_text.contains("Kubernetes"), "{biased_text}");

    // Names the model can't spell from sound: biasing + mishearing rewrites.
    let names = read_wav_named("names-16k.wav");
    let glossary: Vec<String> = [
        "Saoirse = Sayers", "Tadhg = Tad", "Kubeflow", "Grafana", "Qdrant = Drant",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    let mut plain = SttEngine::load(spec, &dir.join(spec.filename), false, &[]).unwrap();
    let mut tuned = SttEngine::load(spec, &dir.join(spec.filename), false, &glossary).unwrap();
    let before = plain.transcribe(&names, "test").unwrap_or_default();
    let after = tuned.transcribe(&names, "test").unwrap_or_default();
    eprintln!("names without glossary: {before}");
    eprintln!("names with glossary:    {after}");
    for term in ["Saoirse", "Tadhg", "Kubeflow", "Grafana", "Qdrant"] {
        assert!(after.contains(term), "missing {term} in {after:?}");
    }

    // Pure silence must not hallucinate.
    assert_eq!(engine.transcribe(&vec![0.0; 32_000], "test"), None);
}
