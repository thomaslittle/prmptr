use serde::{Deserialize, Serialize};
use tauri::Manager;

const WRAPPER_REVISION: &str = "887c89f641d9bf8469099aa1e1f21c65ed72d24d";
const NATIVE_RELEASE: &str = "v0.1.2";
const INSTALL_MARKER: &str = ".prmptr-moonshine-install.json";

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

pub fn diarization_dir(app: &tauri::AppHandle, arch: MoonshineVoiceArch) -> Result<std::path::PathBuf, String> {
    Ok(model_dir(app, arch)?.join("diarization"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallMarker {
    schema_version: u32,
    arch: String,
    wrapper_revision: String,
    native_release: String,
    model_files: Vec<String>,
    diarization_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoonshineVoiceModelStatus {
    pub arch: String,
    pub installed: bool,
    pub directory: String,
    pub model_files: Vec<String>,
    pub diarization_files: Vec<String>,
    pub integrity_manifest_present: bool,
}

fn valid_marker(dir: &std::path::Path, marker: &InstallMarker) -> bool {
    marker.schema_version == 1
        && marker.wrapper_revision == WRAPPER_REVISION
        && marker.native_release == NATIVE_RELEASE
        && !marker.model_files.is_empty()
        && marker.model_files.iter().all(|name| dir.join(name).is_file())
        && ["segmentation.ort", "embedding.ort"]
            .iter()
            .all(|name| dir.join("diarization").join(name).is_file())
}

pub fn model_status(app: &tauri::AppHandle, arch: MoonshineVoiceArch) -> Result<MoonshineVoiceModelStatus, String> {
    let dir = model_dir(app, arch)?;
    let marker_path = dir.join(INSTALL_MARKER);
    let marker = std::fs::read_to_string(&marker_path)
        .ok()
        .and_then(|raw| serde_json::from_str::<InstallMarker>(&raw).ok());
    let installed = marker.as_ref().is_some_and(|value| valid_marker(&dir, value));
    Ok(MoonshineVoiceModelStatus {
        arch: arch.id().to_string(),
        installed,
        directory: dir.to_string_lossy().to_string(),
        model_files: marker.as_ref().map(|value| value.model_files.clone()).unwrap_or_default(),
        diarization_files: marker
            .as_ref()
            .map(|value| value.diarization_files.clone())
            .unwrap_or_default(),
        integrity_manifest_present: marker_path.is_file(),
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
async fn install_manifest(
    client: &reqwest::Client,
    raw_manifest: &str,
    destination_dir: &std::path::Path,
) -> Result<Vec<String>, String> {
    use futures_util::StreamExt;
    let manifest: DependencyManifest = serde_json::from_str(raw_manifest)
        .map_err(|error| format!("Invalid Moonshine dependency manifest: {error}"))?;
    std::fs::create_dir_all(destination_dir)
        .map_err(|error| format!("Unable to create {}: {error}", destination_dir.display()))?;
    let mut installed = Vec::new();

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
            let destination = destination_dir.join(&file.name);
            if let Ok(bytes) = std::fs::read(&destination) {
                let size_ok = file.size.map(|size| size == bytes.len() as u64).unwrap_or(true);
                if size_ok && verify_crc32c(&bytes, &file.checksum).is_ok() {
                    installed.push(file.name);
                    continue;
                }
            }

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
                        file.name, expected, bytes.len()
                    ));
                }
            }
            verify_crc32c(&bytes, &file.checksum)
                .map_err(|error| format!("Moonshine download {} failed integrity check: {error}", file.name))?;
            let part = destination_dir.join(format!("{}.part", file.name));
            std::fs::write(&part, &bytes)
                .map_err(|error| format!("Unable to write {}: {error}", part.display()))?;
            if destination.exists() {
                std::fs::remove_file(&destination)
                    .map_err(|error| format!("Unable to replace {}: {error}", destination.display()))?;
            }
            std::fs::rename(&part, &destination)
                .map_err(|error| format!("Unable to atomically install {}: {error}", destination.display()))?;
            installed.push(file.name);
        }
    }
    installed.sort();
    installed.dedup();
    Ok(installed)
}

#[cfg(feature = "moonshine-voice")]
pub async fn install_model(
    app: &tauri::AppHandle,
    arch: MoonshineVoiceArch,
) -> Result<MoonshineVoiceModelStatus, String> {
    use moonshine_rs::{
        get_diarization_dependencies, get_stt_dependencies_with_options, SttDependenciesOptions,
    };

    let model_manifest = get_stt_dependencies_with_options(
        "en",
        &SttDependenciesOptions::new()
            .with_arch(arch.native())
            .with_word_timestamps(true),
    )
    .map_err(|error| format!("Moonshine STT dependency resolution failed: {error}"))?;
    let diarization_manifest = get_diarization_dependencies()
        .map_err(|error| format!("Moonshine diarization dependency resolution failed: {error}"))?;
    let dir = model_dir(app, arch)?;
    let diarization = diarization_dir(app, arch)?;

    let client = reqwest::Client::builder()
        .user_agent("PRMPTR-MoonshineVoice/0.1")
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|error| format!("Unable to build Moonshine download client: {error}"))?;

    let model_files = install_manifest(&client, &model_manifest, &dir).await?;
    let diarization_files = install_manifest(&client, &diarization_manifest, &diarization).await?;
    if !["segmentation.ort", "embedding.ort"]
        .iter()
        .all(|name| diarization.join(name).is_file())
    {
        return Err("Moonshine diarization manifest completed without both required models".to_string());
    }

    let marker = InstallMarker {
        schema_version: 1,
        arch: arch.id().to_string(),
        wrapper_revision: WRAPPER_REVISION.to_string(),
        native_release: NATIVE_RELEASE.to_string(),
        model_files,
        diarization_files,
    };
    let marker_json = serde_json::to_vec_pretty(&marker)
        .map_err(|error| format!("Unable to serialize Moonshine install marker: {error}"))?;
    let marker_part = dir.join(format!("{INSTALL_MARKER}.part"));
    std::fs::write(&marker_part, marker_json)
        .map_err(|error| format!("Unable to write Moonshine install marker: {error}"))?;
    std::fs::rename(&marker_part, dir.join(INSTALL_MARKER))
        .map_err(|error| format!("Unable to finalize Moonshine install marker: {error}"))?;

    let status = model_status(app, arch)?;
    if !status.installed {
        return Err("Moonshine Voice integrity marker was written but validation still failed".to_string());
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
