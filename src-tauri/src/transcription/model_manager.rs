use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const VAD_MODEL_FILENAME: &str = "silero_vad.onnx";
const SPEAKER_MODEL_FILENAME: &str = "nemo_en_speakerverification_speakernet.onnx";

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
        description: "Best local accuracy in this list",
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
        Err(_) => return "tiny.en".to_string(),
    };

    if let Ok(text) = std::fs::read_to_string(selection_path) {
        if let Ok(selection) = serde_json::from_str::<WhisperSelection>(&text) {
            if find_whisper_model_spec(&selection.model_id).is_some() {
                return selection.model_id;
            }
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
