use serde::{Deserialize, Serialize};
use tauri::Manager;

const WRAPPER_REVISION: &str = "887c89f641d9bf8469099aa1e1f21c65ed72d24d";
const NATIVE_RELEASE: &str = "v0.1.2";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MoonshineVoiceArch {
    TinyStreaming,
    SmallStreaming,
    MediumStreaming,
}

impl Default for MoonshineVoiceArch {
    fn default() -> Self {
        Self::MediumStreaming
    }
}

impl MoonshineVoiceArch {
    pub fn id(self) -> &'static str {
        match self {
            Self::TinyStreaming => "tiny-streaming",
            Self::SmallStreaming => "small-streaming",
            Self::MediumStreaming => "medium-streaming",
        }
    }

    #[cfg(feature = "moonshine-voice")]
    pub fn native(self) -> moonshine_rs::ModelArch {
        match self {
            Self::TinyStreaming => moonshine_rs::ModelArch::TinyStreaming,
            Self::SmallStreaming => moonshine_rs::ModelArch::SmallStreaming,
            Self::MediumStreaming => moonshine_rs::ModelArch::MediumStreaming,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoonshineVoiceSupport {
    pub compiled: bool,
    pub wrapper_revision: &'static str,
    pub native_release: &'static str,
    pub default_arch: &'static str,
    pub diarization_default: bool,
    pub speculative_decoding_default: bool,
    pub word_timestamps_default: bool,
}

pub fn support() -> MoonshineVoiceSupport {
    MoonshineVoiceSupport {
        compiled: cfg!(feature = "moonshine-voice"),
        wrapper_revision: WRAPPER_REVISION,
        native_release: NATIVE_RELEASE,
        default_arch: MoonshineVoiceArch::default().id(),
        diarization_default: true,
        speculative_decoding_default: true,
        word_timestamps_default: true,
    }
}

pub fn model_dir(app: &tauri::AppHandle, arch: MoonshineVoiceArch) -> Result<std::path::PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve PRMPTR app data directory: {error}"))?;
    Ok(root.join("models").join("moonshine-voice").join(arch.id()))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoonshineVoiceModelStatus {
    pub arch: String,
    pub installed: bool,
    pub directory: String,
    pub files: Vec<String>,
}

pub fn model_status(app: &tauri::AppHandle, arch: MoonshineVoiceArch) -> Result<MoonshineVoiceModelStatus, String> {
    let dir = model_dir(app, arch)?;
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.path().is_file() {
                files.push(entry.file_name().to_string_lossy().to_string());
            }
        }
    }
    files.sort();
    let required = ["encoder.ort", "decoder.ort", "streaming_config.json", "tokenizer.bin"];
    let installed = required.iter().all(|name| dir.join(name).is_file())
        || (dir.join("encoder_model.ort").is_file()
            && dir.join("decoder_model_merged.ort").is_file()
            && dir.join("tokenizer.bin").is_file());
    Ok(MoonshineVoiceModelStatus {
        arch: arch.id().to_string(),
        installed,
        directory: dir.to_string_lossy().to_string(),
        files,
    })
}

#[cfg(feature = "moonshine-voice")]
#[derive(Debug, Deserialize)]
struct DependencyManifest {
    groups: Vec<DependencyGroup>,
}

#[cfg(feature = "moonshine-voice")]
#[derive(Debug, Deserialize)]
struct DependencyGroup {
    files: Vec<DependencyFile>,
}

#[cfg(feature = "moonshine-voice")]
#[derive(Debug, Deserialize)]
struct DependencyFile {
    name: String,
    url: String,
    size: Option<u64>,
    #[serde(default)]
    checksum: String,
    #[serde(default)]
    checksum_type: String,
}

#[cfg(feature = "moonshine-voice")]
fn verify_crc32c(bytes: &[u8], encoded: &str) -> Result<(), String> {
    use base64::Engine;
    if encoded.is_empty() {
        return Err("Moonshine dependency manifest omitted a CRC32C checksum".to_string());
    }
    let raw = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("Invalid base64 CRC32C in Moonshine manifest: {error}"))?;
    let expected: [u8; 4] = raw
        .as_slice()
        .try_into()
        .map_err(|_| format!("Expected a 4-byte CRC32C digest, got {} bytes", raw.len()))?;
    let expected = u32::from_be_bytes(expected);
    let actual = crc32c::crc32c(bytes);
    if actual != expected {
        return Err(format!("CRC32C mismatch: expected {expected:08x}, got {actual:08x}"));
    }
    Ok(())
}

#[cfg(feature = "moonshine-voice")]
pub async fn install_model(
    app: &tauri::AppHandle,
    arch: MoonshineVoiceArch,
) -> Result<MoonshineVoiceModelStatus, String> {
    use futures_util::StreamExt;
    use moonshine_rs::{get_stt_dependencies_with_options, SttDependenciesOptions};

    let manifest_json = get_stt_dependencies_with_options(
        "en",
        &SttDependenciesOptions::new()
            .with_arch(arch.native())
            .with_word_timestamps(true),
    )
    .map_err(|error| format!("Moonshine dependency resolution failed: {error}"))?;
    let manifest: DependencyManifest = serde_json::from_str(&manifest_json)
        .map_err(|error| format!("Invalid Moonshine dependency manifest: {error}"))?;
    let dir = model_dir(app, arch)?;
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Unable to create Moonshine model directory: {error}"))?;

    let client = reqwest::Client::builder()
        .user_agent("PRMPTR-MoonshineVoice/0.1")
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|error| format!("Unable to build Moonshine download client: {error}"))?;

    for group in manifest.groups {
        for file in group.files {
            if file.name.contains('/') || file.name.contains('\\') || file.name == "." || file.name == ".." {
                return Err(format!("Unsafe Moonshine dependency filename: {}", file.name));
            }
            if file.checksum_type != "crc32c" {
                return Err(format!(
                    "Moonshine dependency {} uses unsupported checksum type '{}'",
                    file.name, file.checksum_type
                ));
            }
            let destination = dir.join(&file.name);
            let existing = std::fs::read(&destination).ok();
            if let Some(bytes) = existing.as_deref() {
                let size_ok = file.size.map(|size| size == bytes.len() as u64).unwrap_or(true);
                if size_ok && verify_crc32c(bytes, &file.checksum).is_ok() {
                    continue;
                }
            }

            let part = dir.join(format!("{}.part", file.name));
            let response = client
                .get(&file.url)
                .send()
                .await
                .map_err(|error| format!("Failed downloading {}: {error}", file.name))?;
            if !response.status().is_success() {
                return Err(format!("Moonshine download {} returned HTTP {}", file.name, response.status()));
            }
            let mut bytes = Vec::with_capacity(file.size.unwrap_or(0).min(512 * 1024 * 1024) as usize);
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|error| format!("Moonshine download {} failed: {error}", file.name))?;
                bytes.extend_from_slice(&chunk);
                if let Some(expected) = file.size {
                    if bytes.len() as u64 > expected {
                        return Err(format!("Moonshine download {} exceeded declared size", file.name));
                    }
                }
            }
            if let Some(expected) = file.size {
                if bytes.len() as u64 != expected {
                    return Err(format!(
                        "Moonshine download {} size mismatch: expected {}, got {}",
                        file.name,
                        expected,
                        bytes.len()
                    ));
                }
            }
            verify_crc32c(&bytes, &file.checksum)
                .map_err(|error| format!("Moonshine download {} failed integrity check: {error}", file.name))?;
            std::fs::write(&part, &bytes)
                .map_err(|error| format!("Unable to write {}: {error}", part.display()))?;
            std::fs::rename(&part, &destination)
                .map_err(|error| format!("Unable to atomically install {}: {error}", destination.display()))?;
        }
    }

    let status = model_status(app, arch)?;
    if !status.installed {
        return Err(format!(
            "Moonshine Voice dependencies downloaded but required model files were not found in {}",
            status.directory
        ));
    }
    Ok(status)
}

#[cfg(not(feature = "moonshine-voice"))]
pub async fn install_model(
    _app: &tauri::AppHandle,
    _arch: MoonshineVoiceArch,
) -> Result<MoonshineVoiceModelStatus, String> {
    Err("Moonshine Voice support is not compiled into this build. Rebuild with --features moonshine-voice.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn architecture_ids_are_stable() {
        assert_eq!(MoonshineVoiceArch::TinyStreaming.id(), "tiny-streaming");
        assert_eq!(MoonshineVoiceArch::SmallStreaming.id(), "small-streaming");
        assert_eq!(MoonshineVoiceArch::MediumStreaming.id(), "medium-streaming");
    }

    #[test]
    fn maximum_accuracy_is_the_default_architecture() {
        assert_eq!(MoonshineVoiceArch::default(), MoonshineVoiceArch::MediumStreaming);
    }

    #[test]
    fn support_reports_compile_time_truth() {
        assert_eq!(support().compiled, cfg!(feature = "moonshine-voice"));
        assert!(support().diarization_default);
        assert!(support().speculative_decoding_default);
        assert!(support().word_timestamps_default);
    }
}
