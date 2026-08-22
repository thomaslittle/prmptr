use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const VAD_MODEL_FILENAME: &str = "silero_vad.onnx";
const SPEAKER_MODEL_FILENAME: &str = "nemo_en_speakerverification_speakernet.onnx";

// ──────────────────────────── Moonshine ────────────────────────────

/// Extracted directory name of the sherpa-onnx Moonshine base int8 model.
pub const MOONSHINE_DIR_NAME: &str = "sherpa-onnx-moonshine-base-en-int8";
pub const MOONSHINE_ARCHIVE_URL: &str =
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-base-en-int8.tar.bz2";
pub const MOONSHINE_ARCHIVE_FILENAME: &str = "sherpa-onnx-moonshine-base-en-int8.tar.bz2";

fn moonshine_model_files_present(dir: &std::path::Path) -> bool {
    dir.join("preprocess.onnx").exists()
        && dir.join("encode.int8.onnx").exists()
        && dir.join("uncached_decode.int8.onnx").exists()
        && dir.join("cached_decode.int8.onnx").exists()
        && dir.join("tokens.txt").exists()
}

/// Locate an installed Moonshine model directory. Tolerates both flat and
/// nested (archive-contains-same-named-dir) extraction layouts.
pub fn resolve_moonshine_model_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;

    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Ok(app_data_dir) = app.path().app_data_dir() {
        let models = app_data_dir.join("models");
        candidates.push(models.join(MOONSHINE_DIR_NAME));
        // Nested layout: <models>/<dir>/<dir>/...
        candidates.push(models.join(MOONSHINE_DIR_NAME).join(MOONSHINE_DIR_NAME));
    }

    // Dev convenience: models/ next to src-tauri
    let dev = PathBuf::from("models").join(MOONSHINE_DIR_NAME);
    candidates.push(dev.clone());
    candidates.push(dev.join(MOONSHINE_DIR_NAME));

    for dir in candidates {
        if moonshine_model_files_present(&dir) {
            return Ok(dir);
        }
    }

    Err("Moonshine model is not installed. Download it from Settings -> Transcription.".to_string())
}

pub fn is_moonshine_installed(app: &tauri::AppHandle) -> bool {
    resolve_moonshine_model_dir(app).is_ok()
}

/// Directory that should contain (or receive) the Moonshine model.
pub fn moonshine_install_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path()
        .app_data_dir()
        .map(|d| d.join("models"))
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))
}

#[derive(Clone, Serialize)]
pub struct WhisperModelInfo {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub description: String,
    pub size_mb: u32,
    pub installed: bool,
    pub selected: bool,
}

#[derive(Clone, Copy)]
pub struct WhisperModelSpec {
    pub id: &'static str,
    pub name: &'static str,
    pub filename: &'static str,
    pub description: &'static str,
    pub size_mb: u32,
    pub download_url: &'static str,
}

const WHISPER_MODEL_SPECS: &[WhisperModelSpec] = &[
    // Recommended: near large-v3 accuracy at ~6x speed; runs well quantized
    // on CPU and flies on GPU. Free (MIT-licensed OpenAI weights, ggml conversion).
    WhisperModelSpec {
        id: "large-v3-turbo-q5_1",
        name: "Whisper Large v3 Turbo (quantized)",
        filename: "ggml-large-v3-turbo-q5_1.bin",
        description: "Recommended — best accuracy/speed balance",
        size_mb: 574,
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_1.bin",
    },
    WhisperModelSpec {
        id: "large-v3-turbo",
        name: "Whisper Large v3 Turbo (full)",
        filename: "ggml-large-v3-turbo.bin",
        description: "Max accuracy, needs more RAM/GPU",
        size_mb: 1620,
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
    },
    WhisperModelSpec {
        id: "tiny.en",
        name: "Whisper Tiny (English)",
        filename: "ggml-tiny.en.bin",
        description: "Fastest, lowest accuracy",
        size_mb: 75,
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
    },
    WhisperModelSpec {
        id: "base.en",
        name: "Whisper Base (English)",
        filename: "ggml-base.en.bin",
        description: "Better accuracy, still fast",
        size_mb: 142,
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    },
    WhisperModelSpec {
        id: "small.en",
        name: "Whisper Small (English)",
        filename: "ggml-small.en.bin",
        description: "Good quality/speed balance",
        size_mb: 466,
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    },
    WhisperModelSpec {
        id: "medium.en",
        name: "Whisper Medium (English)",
        filename: "ggml-medium.en.bin",
        description: "Legacy mid-tier option",
        size_mb: 1530,
        download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin",
    },
];

#[derive(Serialize, Deserialize)]
struct WhisperSelection {
    model_id: String,
}

fn resolve_model(app: &tauri::AppHandle, filename: &str) -> Result<PathBuf, String> {
    use tauri::Manager;

    // Dev: relative to CWD (src-tauri/models/)
    let dev_path = PathBuf::from("models").join(filename);
    if dev_path.exists() {
        return Ok(dev_path);
    }

    // Also try src-tauri/models/ from project root
    let alt_path = PathBuf::from("src-tauri").join("models").join(filename);
    if alt_path.exists() {
        return Ok(alt_path);
    }

    // User-downloaded models in app data directory
    if let Ok(app_data_dir) = app.path().app_data_dir() {
        let path = app_data_dir.join("models").join(filename);
        if path.exists() {
            return Ok(path);
        }
    }

    // Production bundled resources
    if let Ok(resource_dir) = app.path().resource_dir() {
        let path = resource_dir.join("models").join(filename);
        if path.exists() {
            return Ok(path);
        }
    }

    Err(format!("Model not found: {filename}"))
}

fn selection_file_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    Ok(dir.join("whisper-model-selection.json"))
}

pub fn get_whisper_model_specs() -> &'static [WhisperModelSpec] {
    WHISPER_MODEL_SPECS
}

pub fn find_whisper_model_spec(model_id: &str) -> Option<&'static WhisperModelSpec> {
    WHISPER_MODEL_SPECS.iter().find(|m| m.id == model_id)
}

pub fn get_selected_whisper_model_id(app: &tauri::AppHandle) -> String {
    let selection_path = match selection_file_path(app) {
        Ok(p) => p,
        Err(_) => return best_installed_model_id(app),
    };

    if let Ok(text) = std::fs::read_to_string(selection_path) {
        if let Ok(selection) = serde_json::from_str::<WhisperSelection>(&text) {
            if find_whisper_model_spec(&selection.model_id).is_some() {
                return selection.model_id;
            }
        }
    }

    best_installed_model_id(app)
}

/// With no explicit selection, use the highest-quality model that is
/// actually installed (specs are ordered best-first). Fresh installs fall
/// back to the bundled tiny model so transcription works immediately.
fn best_installed_model_id(app: &tauri::AppHandle) -> String {
    for spec in WHISPER_MODEL_SPECS {
        if resolve_model(app, spec.filename).is_ok() {
            return spec.id.to_string();
        }
    }
    "tiny.en".to_string()
}

pub fn set_selected_whisper_model_id(app: &tauri::AppHandle, model_id: &str) -> Result<(), String> {
    if find_whisper_model_spec(model_id).is_none() {
        return Err(format!("Unknown whisper model id: {model_id}"));
    }

    let path = selection_file_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create app data dir: {e}"))?;
    }

    let payload = WhisperSelection {
        model_id: model_id.to_string(),
    };
    let json = serde_json::to_string_pretty(&payload)
        .map_err(|e| format!("Failed to serialize model selection: {e}"))?;
    std::fs::write(path, json).map_err(|e| format!("Failed to save model selection: {e}"))?;
    Ok(())
}

pub fn list_whisper_models(app: &tauri::AppHandle) -> Vec<WhisperModelInfo> {
    let selected_id = get_selected_whisper_model_id(app);
    WHISPER_MODEL_SPECS
        .iter()
        .map(|spec| WhisperModelInfo {
            id: spec.id.to_string(),
            name: spec.name.to_string(),
            filename: spec.filename.to_string(),
            description: spec.description.to_string(),
            size_mb: spec.size_mb,
            installed: resolve_model(app, spec.filename).is_ok(),
            selected: spec.id == selected_id,
        })
        .collect()
}

pub fn resolve_model_path(
    app: &tauri::AppHandle,
    selected_model_id: Option<&str>,
) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("PRMPTR_WHISPER_MODEL_PATH") {
        let p = PathBuf::from(path);
        if p.exists() {
            return Ok(p);
        }
    }

    let model_id = selected_model_id
        .map(|s| s.to_string())
        .unwrap_or_else(|| get_selected_whisper_model_id(app));

    if let Some(spec) = find_whisper_model_spec(&model_id) {
        return resolve_model(app, spec.filename).map_err(|_| {
            format!(
                "Whisper model '{}' is not installed. Download it from Settings -> Transcription.",
                spec.name
            )
        });
    }

    resolve_model(app, "ggml-tiny.en.bin")
}

pub fn resolve_vad_model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    resolve_model(app, VAD_MODEL_FILENAME)
}

pub fn resolve_speaker_model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    resolve_model(app, SPEAKER_MODEL_FILENAME)
}
