use serde::{Deserialize, Serialize};

use crate::speech::moonshine_voice::MoonshineVoiceArch;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum MoonshineQualityProfile {
    #[default]
    Auto,
    Maximum,
    Balanced,
    LowCpu,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoonshineQualityResolution {
    pub profile: MoonshineQualityProfile,
    pub arch: MoonshineVoiceArch,
    pub logical_cpus: usize,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoonshineQualityOption {
    pub id: MoonshineQualityProfile,
    pub label: &'static str,
    pub description: &'static str,
    pub arch: Option<MoonshineVoiceArch>,
}

pub fn logical_cpu_count() -> usize {
    std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(1)
}

pub fn resolve(profile: MoonshineQualityProfile) -> MoonshineQualityResolution {
    resolve_for_cpu_count(profile, logical_cpu_count())
}

pub fn resolve_for_cpu_count(
    profile: MoonshineQualityProfile,
    logical_cpus: usize,
) -> MoonshineQualityResolution {
    let logical_cpus = logical_cpus.max(1);
    let (arch, reason) = match profile {
        MoonshineQualityProfile::Maximum => (
            MoonshineVoiceArch::MediumStreaming,
            "Maximum pins the highest-accuracy streaming architecture.".to_string(),
        ),
        MoonshineQualityProfile::Balanced => (
            MoonshineVoiceArch::SmallStreaming,
            "Balanced favors Small Streaming to reduce CPU cost while retaining strong accuracy.".to_string(),
        ),
        MoonshineQualityProfile::LowCpu => (
            MoonshineVoiceArch::TinyStreaming,
            "Low CPU pins Tiny Streaming for the lowest local inference cost.".to_string(),
        ),
        MoonshineQualityProfile::Auto if logical_cpus >= 8 => (
            MoonshineVoiceArch::MediumStreaming,
            format!("Auto selected Medium Streaming because {logical_cpus} logical CPUs are available."),
        ),
        MoonshineQualityProfile::Auto if logical_cpus >= 4 => (
            MoonshineVoiceArch::SmallStreaming,
            format!("Auto selected Small Streaming because {logical_cpus} logical CPUs are available."),
        ),
        MoonshineQualityProfile::Auto => (
            MoonshineVoiceArch::TinyStreaming,
            format!("Auto selected Tiny Streaming because only {logical_cpus} logical CPUs are available."),
        ),
    };
    MoonshineQualityResolution {
        profile,
        arch,
        logical_cpus,
        reason,
    }
}

pub fn options() -> Vec<MoonshineQualityOption> {
    vec![
        MoonshineQualityOption {
            id: MoonshineQualityProfile::Auto,
            label: "Auto",
            description: "Choose the largest streaming model that is reasonable for this CPU.",
            arch: None,
        },
        MoonshineQualityOption {
            id: MoonshineQualityProfile::Maximum,
            label: "Maximum accuracy",
            description: "Always use Medium Streaming.",
            arch: Some(MoonshineVoiceArch::MediumStreaming),
        },
        MoonshineQualityOption {
            id: MoonshineQualityProfile::Balanced,
            label: "Balanced",
            description: "Use Small Streaming for a lower CPU/latency cost.",
            arch: Some(MoonshineVoiceArch::SmallStreaming),
        },
        MoonshineQualityOption {
            id: MoonshineQualityProfile::LowCpu,
            label: "Low CPU",
            description: "Use Tiny Streaming for constrained machines.",
            arch: Some(MoonshineVoiceArch::TinyStreaming),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_profiles_are_stable() {
        assert_eq!(
            resolve_for_cpu_count(MoonshineQualityProfile::Maximum, 1).arch,
            MoonshineVoiceArch::MediumStreaming
        );
        assert_eq!(
            resolve_for_cpu_count(MoonshineQualityProfile::Balanced, 32).arch,
            MoonshineVoiceArch::SmallStreaming
        );
        assert_eq!(
            resolve_for_cpu_count(MoonshineQualityProfile::LowCpu, 32).arch,
            MoonshineVoiceArch::TinyStreaming
        );
    }

    #[test]
    fn auto_scales_with_cpu_budget() {
        assert_eq!(resolve_for_cpu_count(MoonshineQualityProfile::Auto, 2).arch, MoonshineVoiceArch::TinyStreaming);
        assert_eq!(resolve_for_cpu_count(MoonshineQualityProfile::Auto, 4).arch, MoonshineVoiceArch::SmallStreaming);
        assert_eq!(resolve_for_cpu_count(MoonshineQualityProfile::Auto, 8).arch, MoonshineVoiceArch::MediumStreaming);
    }
}
