use serde::Serialize;

use crate::speech::moonshine_quality::{self, MoonshineQualityProfile};
use crate::speech::moonshine_voice::{self, MoonshineVoiceArch, MoonshineVoiceModelStatus};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoonshineModelCatalogEntry {
    pub arch: MoonshineVoiceArch,
    pub label: &'static str,
    pub quality_tier: &'static str,
    pub recommended_for_auto: bool,
    pub status: MoonshineVoiceModelStatus,
}

fn all_arches() -> [(MoonshineVoiceArch, &'static str, &'static str); 3] {
    [
        (MoonshineVoiceArch::TinyStreaming, "Tiny Streaming", "low-cpu"),
        (MoonshineVoiceArch::SmallStreaming, "Small Streaming", "balanced"),
        (MoonshineVoiceArch::MediumStreaming, "Medium Streaming", "maximum"),
    ]
}

pub fn catalog(app: &tauri::AppHandle) -> Result<Vec<MoonshineModelCatalogEntry>, String> {
    let auto = moonshine_quality::resolve(MoonshineQualityProfile::Auto).arch;
    all_arches()
        .into_iter()
        .map(|(arch, label, quality_tier)| {
            Ok(MoonshineModelCatalogEntry {
                arch,
                label,
                quality_tier,
                recommended_for_auto: arch == auto,
                status: moonshine_voice::model_status(app, arch)?,
            })
        })
        .collect()
}

fn ensure_owned_model_directory(
    app: &tauri::AppHandle,
    arch: MoonshineVoiceArch,
) -> Result<std::path::PathBuf, String> {
    let target = moonshine_voice::model_dir(app, arch)?;
    let root = target
        .parent()
        .ok_or_else(|| "Moonshine model directory has no parent".to_string())?;
    if target.file_name().and_then(|name| name.to_str()) != Some(arch.id()) {
        return Err("Refusing to manage an unexpected Moonshine model path".to_string());
    }
    if root.file_name().and_then(|name| name.to_str()) != Some("moonshine-voice") {
        return Err("Refusing to manage a path outside PRMPTR's Moonshine model root".to_string());
    }
    Ok(target)
}

pub fn delete_model(
    app: &tauri::AppHandle,
    arch: MoonshineVoiceArch,
) -> Result<MoonshineVoiceModelStatus, String> {
    let target = ensure_owned_model_directory(app, arch)?;
    if target.exists() {
        std::fs::remove_dir_all(&target)
            .map_err(|error| format!("Unable to delete Moonshine model {}: {error}", arch.id()))?;
    }
    moonshine_voice::model_status(app, arch)
}

pub fn prune_except(
    app: &tauri::AppHandle,
    keep: MoonshineVoiceArch,
) -> Result<Vec<MoonshineModelCatalogEntry>, String> {
    for (arch, _, _) in all_arches() {
        if arch != keep {
            delete_model(app, arch)?;
        }
    }
    catalog(app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_all_streaming_architectures() {
        let arches = all_arches().map(|entry| entry.0);
        assert_eq!(arches[0], MoonshineVoiceArch::TinyStreaming);
        assert_eq!(arches[1], MoonshineVoiceArch::SmallStreaming);
        assert_eq!(arches[2], MoonshineVoiceArch::MediumStreaming);
    }
}
