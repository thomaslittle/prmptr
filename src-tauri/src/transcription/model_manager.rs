//! Local speech-to-text model catalog and on-disk resolution.
//!
//! Every catalog model is a GGUF file run by transcribe.cpp (`transcribe-cpp`
//! crate). Files are pinned to an exact Hugging Face revision + SHA-256 so a
//! download is reproducible and a truncated/corrupt file is never treated as
//! installed. Catalog choices follow the 2026 on-device ASR landscape (see
//! anomalyco/hex's model research): Parakeet Unified English is the default —
//! ~1.6% WER on LibriSpeech, punctuated output, and >15x realtime on a desktop
//! CPU.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Silero VAD v6.2 (GGUF, run by transcribe.cpp) — bundled, 1.2 MB.
const VAD_MODEL_FILENAME: &str = "silero-vad-v6.2-F32.gguf";
const SPEAKER_MODEL_FILENAME: &str = "nemo_en_speakerverification_speakernet.onnx";

/// Model used when the user has never picked one.
pub const DEFAULT_STT_MODEL_ID: &str = "parakeet-unified-en";

#[derive(Clone, Copy, Debug)]
pub struct SttModelSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    /// Human-readable language coverage shown in Settings.
    pub languages: &'static str,
    /// Language hint passed to the model, when it accepts one.
    pub language_hint: Option<&'static str>,
    pub filename: &'static str,
    pub repository: &'static str,
    pub revision: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
    pub recommended: bool,
}

impl SttModelSpec {
    pub fn download_url(&self) -> String {
        format!(
            "https://huggingface.co/{}/resolve/{}/{}",
            self.repository, self.revision, self.filename
        )
    }
}

/// Ordered best-first for English desktop use. Q8_0 everywhere: it is the
/// quantization transcribe.cpp's GPU backends (Vulkan/CUDA) support for every
/// family and is indistinguishable from F16 in accuracy.
pub const STT_MODELS: &[SttModelSpec] = &[
    SttModelSpec {
        id: "parakeet-unified-en",
        name: "Parakeet Unified (English)",
        description: "Recommended — best English accuracy, punctuated, fast on any CPU",
        languages: "English",
        language_hint: Some("en"),
        filename: "parakeet-unified-en-0.6b-Q8_0.gguf",
        repository: "handy-computer/parakeet-unified-en-0.6b-gguf",
        revision: "843b1b175ace04f5a89d379c79e2518c0d065b25",
        bytes: 731_357_568,
        sha256: "4b50b6dd862bf6e346929aaf4f5eaacec003bfa3f56462d6c874b41ef2f38795",
        recommended: true,
    },
    SttModelSpec {
        id: "parakeet-v3",
        name: "Parakeet v3 (Multilingual)",
        description: "25 European languages with automatic language detection",
        languages: "25 European languages",
        language_hint: None,
        filename: "parakeet-tdt-0.6b-v3-Q8_0.gguf",
        repository: "handy-computer/parakeet-tdt-0.6b-v3-gguf",
        revision: "d8d8c32cb2017c57e5307767343e97870f8a7f53",
        bytes: 739_508_576,
        sha256: "5859f77944efcd8eafa23a6350731960b2b55b2203df51f319665c807d802cc7",
        recommended: false,
    },
    SttModelSpec {
        id: "whisper-large-v3-turbo",
        name: "Whisper Large v3 Turbo",
        description: "99 languages; slower than Parakeet on CPU",
        languages: "99 languages",
        language_hint: None,
        filename: "whisper-large-v3-turbo-Q8_0.gguf",
        repository: "handy-computer/whisper-large-v3-turbo-gguf",
        revision: "18ada752005f5fddef499256f9a458d0b37a203a",
        bytes: 886_381_728,
        sha256: "257aa7ec9121c22c167d5e2c49e3e76b4ba0e6e27ebc13074eba0a80f8190220",
        recommended: false,
    },
    SttModelSpec {
        id: "moonshine-streaming-small",
        name: "Moonshine Small (English)",
        description: "Lightweight 200 MB model for older or low-power machines",
        languages: "English",
        language_hint: None,
        filename: "moonshine-streaming-small-Q8_0.gguf",
        repository: "handy-computer/moonshine-streaming-small-gguf",
        revision: "e53f28b0cb90308390c852068b950a1aadd238b0",
        bytes: 198_506_848,
        sha256: "d03670f69629b649085d0f44a63d97668b4119117cc9611a4e4ad94341713dfc",
        recommended: false,
    },
    SttModelSpec {
        id: "parakeet-110m-en",
        name: "Parakeet 110M (English)",
        description: "Smallest and fastest; good accuracy for its 135 MB size",
        languages: "English",
        language_hint: Some("en"),
        filename: "parakeet-tdt_ctc-110m-Q8_0.gguf",
        repository: "handy-computer/parakeet-tdt_ctc-110m-gguf",
        revision: "1c3f0d5378fdd358905cc410a93ed9e64f52d170",
        bytes: 135_373_280,
        sha256: "7dd44c74a331d788a4e5f8b16913b3feb29ced22cf5613aad0e0f6cd30516296",
        recommended: false,
    },
];

#[derive(Clone, Serialize)]
pub struct SttModelInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub languages: String,
    pub size_mb: u32,
    pub installed: bool,
    pub selected: bool,
    pub recommended: bool,
}

#[derive(Serialize, Deserialize)]
struct SttSelection {
    model_id: String,
}

pub fn find_stt_model_spec(model_id: &str) -> Option<&'static SttModelSpec> {
    STT_MODELS.iter().find(|m| m.id == model_id)
}

/// Directory user-downloaded models live in.
pub fn models_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map(|d| d.join("models"))
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))
}

/// A downloaded model counts as installed only when its size matches the
/// pinned artifact; downloads land in a `.part` file and are renamed into
/// place only after the SHA-256 check passes.
fn installed_path(app: &tauri::AppHandle, spec: &SttModelSpec) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(dir) = models_dir(app) {
        candidates.push(dir.join(spec.filename));
    }
    // Dev convenience: src-tauri/models/<file>.
    candidates.push(PathBuf::from("models").join(spec.filename));
    candidates
        .into_iter()
        .find(|p| file_len(p) == Some(spec.bytes))
}

fn file_len(path: &Path) -> Option<u64> {
    std::fs::metadata(path).ok().map(|m| m.len())
}

fn selection_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    Ok(dir.join("stt-model-selection.json"))
}

pub fn get_selected_stt_model_id(app: &tauri::AppHandle) -> String {
    if let Ok(path) = selection_file_path(app) {
        if let Ok(text) = std::fs::read_to_string(path) {
            if let Ok(selection) = serde_json::from_str::<SttSelection>(&text) {
                if find_stt_model_spec(&selection.model_id).is_some() {
                    return selection.model_id;
                }
            }
        }
    }
    best_installed_model_id(app)
}

/// With no explicit selection, prefer the best model that is actually on disk
/// so transcription works without a settings visit.
fn best_installed_model_id(app: &tauri::AppHandle) -> String {
    STT_MODELS
        .iter()
        .find(|spec| installed_path(app, spec).is_some())
        .map(|spec| spec.id)
        .unwrap_or(DEFAULT_STT_MODEL_ID)
        .to_string()
}

pub fn set_selected_stt_model_id(app: &tauri::AppHandle, model_id: &str) -> Result<(), String> {
    if find_stt_model_spec(model_id).is_none() {
        return Err(format!("Unknown speech model: {model_id}"));
    }
    let path = selection_file_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create app data dir: {e}"))?;
    }
    let json = serde_json::to_string_pretty(&SttSelection {
        model_id: model_id.to_string(),
    })
    .map_err(|e| format!("Failed to serialize model selection: {e}"))?;
    std::fs::write(path, json).map_err(|e| format!("Failed to save model selection: {e}"))
}

pub fn list_stt_models(app: &tauri::AppHandle) -> Vec<SttModelInfo> {
    let selected_id = get_selected_stt_model_id(app);
    STT_MODELS
        .iter()
        .map(|spec| SttModelInfo {
            id: spec.id.to_string(),
            name: spec.name.to_string(),
            description: spec.description.to_string(),
            languages: spec.languages.to_string(),
            size_mb: (spec.bytes / 1_000_000) as u32,
            installed: installed_path(app, spec).is_some(),
            selected: spec.id == selected_id,
            recommended: spec.recommended,
        })
        .collect()
}

/// Resolve the GGUF file for the requested (or selected) model.
pub fn resolve_stt_model(
    app: &tauri::AppHandle,
    requested_id: Option<&str>,
) -> Result<(&'static SttModelSpec, PathBuf), String> {
    let model_id = requested_id
        .filter(|id| !id.trim().is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| get_selected_stt_model_id(app));
    let spec = find_stt_model_spec(&model_id)
        .or_else(|| find_stt_model_spec(DEFAULT_STT_MODEL_ID))
        .ok_or_else(|| "Speech model catalog is empty".to_string())?;

    if let Ok(path) = std::env::var("PRMPTR_STT_MODEL_PATH") {
        let p = PathBuf::from(path);
        if p.exists() {
            return Ok((spec, p));
        }
    }

    installed_path(app, spec).map(|p| (spec, p)).ok_or_else(|| {
        format!(
            "Speech model '{}' is not downloaded yet. Open Settings → Capture and download it ({} MB).",
            spec.name,
            spec.bytes / 1_000_000
        )
    })
}

/// Remove speech models earlier PRMPTR versions downloaded (whisper.cpp
/// `ggml-*.bin`, the sherpa Moonshine bundle) — the transcribe.cpp engine
/// can't use them and they can total gigabytes. Also drops interrupted
/// `.part` downloads. Only touches files PRMPTR itself put in its model dir.
pub fn cleanup_legacy_models(app: &tauri::AppHandle) {
    let Ok(dir) = models_dir(app) else { return };
    let Ok(entries) = std::fs::read_dir(&dir) else { return };
    let mut freed: u64 = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        let legacy_file = (name.starts_with("ggml-") && name.ends_with(".bin")) || name.ends_with(".gguf.part");
        let legacy_dir = name == "sherpa-onnx-moonshine-base-en-int8";
        if legacy_file {
            freed += entry.metadata().map(|m| m.len()).unwrap_or(0);
            if let Err(e) = std::fs::remove_file(&path) {
                log::warn!("Could not remove legacy model {}: {e}", path.display());
            }
        } else if legacy_dir && path.is_dir() {
            if let Err(e) = std::fs::remove_dir_all(&path) {
                log::warn!("Could not remove legacy model {}: {e}", path.display());
            }
        }
    }
    if let Ok(data) = app_data_dir(app) {
        let _ = std::fs::remove_file(data.join("whisper-model-selection.json"));
    }
    if freed > 0 {
        log::info!("Removed {} MB of legacy speech models", freed / 1_000_000);
    }
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// Bundled helper models (VAD + speaker embeddings) shipped as resources.
fn resolve_bundled(app: &tauri::AppHandle, filename: &str) -> Result<PathBuf, String> {
    use tauri::Manager;
    let mut candidates = vec![
        PathBuf::from("models").join(filename),
        PathBuf::from("src-tauri").join("models").join(filename),
    ];
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("models").join(filename));
    }
    candidates
        .into_iter()
        .find(|p| p.exists())
        .ok_or_else(|| format!("Bundled model not found: {filename}"))
}

pub fn resolve_vad_model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    resolve_bundled(app, VAD_MODEL_FILENAME)
}

pub fn resolve_speaker_model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    resolve_bundled(app, SPEAKER_MODEL_FILENAME)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn catalog_ids_and_files_are_unique() {
        let ids: HashSet<_> = STT_MODELS.iter().map(|m| m.id).collect();
        let files: HashSet<_> = STT_MODELS.iter().map(|m| m.filename).collect();
        assert_eq!(ids.len(), STT_MODELS.len());
        assert_eq!(files.len(), STT_MODELS.len());
    }

    #[test]
    fn default_model_is_in_catalog_and_recommended() {
        let spec = find_stt_model_spec(DEFAULT_STT_MODEL_ID).expect("default in catalog");
        assert!(spec.recommended);
        assert_eq!(STT_MODELS.iter().filter(|m| m.recommended).count(), 1);
    }

    #[test]
    fn artifacts_are_pinned_q8_gguf() {
        for spec in STT_MODELS {
            assert!(spec.filename.ends_with("-Q8_0.gguf"), "{}", spec.filename);
            assert_eq!(spec.revision.len(), 40, "{} revision must be a commit sha", spec.id);
            assert_eq!(spec.sha256.len(), 64, "{} sha256", spec.id);
            assert!(spec.bytes > 50_000_000);
            assert!(spec.download_url().starts_with("https://huggingface.co/handy-computer/"));
        }
    }
}
