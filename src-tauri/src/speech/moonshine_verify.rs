use crate::speech::moonshine_voice::{self, MoonshineVoiceArch, MoonshineVoiceModelStatus};

#[cfg(feature = "moonshine-voice")]
#[derive(Debug, serde::Deserialize)]
struct DependencyManifest {
    groups: Vec<DependencyGroup>,
}

#[cfg(feature = "moonshine-voice")]
#[derive(Debug, serde::Deserialize)]
struct DependencyGroup {
    files: Vec<DependencyFile>,
}

#[cfg(feature = "moonshine-voice")]
#[derive(Debug, serde::Deserialize)]
struct DependencyFile {
    name: String,
    size: Option<u64>,
    #[serde(default)]
    checksum: String,
    #[serde(default)]
    checksum_type: String,
}

#[cfg(feature = "moonshine-voice")]
fn expected_crc32c(encoded: &str) -> Result<u32, String> {
    use base64::Engine;
    let raw = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|error| format!("Invalid base64 CRC32C: {error}"))?;
    let bytes: [u8; 4] = raw
        .as_slice()
        .try_into()
        .map_err(|_| format!("Expected 4 CRC32C bytes, got {}", raw.len()))?;
    Ok(u32::from_be_bytes(bytes))
}

#[cfg(feature = "moonshine-voice")]
fn verify_manifest(raw: &str, directory: &std::path::Path) -> Result<(), String> {
    let manifest: DependencyManifest = serde_json::from_str(raw)
        .map_err(|error| format!("Invalid Moonshine dependency manifest: {error}"))?;
    for group in manifest.groups {
        for file in group.files {
            if file.checksum_type != "crc32c" || file.checksum.is_empty() {
                return Err(format!("{} has no supported integrity digest", file.name));
            }
            let path = directory.join(&file.name);
            let bytes = std::fs::read(&path)
                .map_err(|error| format!("Unable to read {}: {error}", path.display()))?;
            if let Some(size) = file.size {
                if bytes.len() as u64 != size {
                    return Err(format!(
                        "{} size mismatch: expected {}, got {}",
                        file.name,
                        size,
                        bytes.len()
                    ));
                }
            }
            let expected = expected_crc32c(&file.checksum)?;
            let actual = crc32c::crc32c(&bytes);
            if actual != expected {
                return Err(format!(
                    "{} CRC32C mismatch: expected {:08x}, got {:08x}",
                    file.name, expected, actual
                ));
            }
        }
    }
    Ok(())
}

#[cfg(feature = "moonshine-voice")]
pub fn verify_model(
    app: &tauri::AppHandle,
    arch: MoonshineVoiceArch,
) -> Result<MoonshineVoiceModelStatus, String> {
    use moonshine_rs::{
        get_diarization_dependencies, get_stt_dependencies_with_options, SttDependenciesOptions,
    };

    let status = moonshine_voice::model_status(app, arch)?;
    if !status.installed {
        return Err(format!("Moonshine Voice {} is not installed", arch.id()));
    }
    let model_manifest = get_stt_dependencies_with_options(
        "en",
        &SttDependenciesOptions::new()
            .with_arch(arch.native())
            .with_word_timestamps(true),
    )
    .map_err(|error| format!("Unable to resolve Moonshine STT manifest: {error}"))?;
    let diarization_manifest = get_diarization_dependencies()
        .map_err(|error| format!("Unable to resolve Moonshine diarization manifest: {error}"))?;
    verify_manifest(&model_manifest, &moonshine_voice::model_dir(app, arch)?)?;
    verify_manifest(&diarization_manifest, &moonshine_voice::diarization_dir(app, arch)?)?;
    Ok(status)
}

#[cfg(not(feature = "moonshine-voice"))]
pub fn verify_model(
    _app: &tauri::AppHandle,
    _arch: MoonshineVoiceArch,
) -> Result<MoonshineVoiceModelStatus, String> {
    Err("Moonshine Voice deep verification requires the moonshine-voice feature".to_string())
}
