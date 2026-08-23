import type { SpeechCapabilities } from "@/lib/speech-capabilities";
import { analyzeCrossChannelEcho, type CrossChannelEchoDiagnostics } from "@/lib/speech-echo";
import type {
    MoonshineModelCatalogEntry,
    MoonshineQualityResolution,
    MoonshineVoiceModelStatus,
    MoonshineVoiceSupport,
    SpeechContextSidecarStatus,
} from "@/lib/speech-tauri";
import { useTranscriptStore } from "@/lib/stores/transcript-store";

export interface SpeechDetectionDiagnostics {
    diarizationEnabled: boolean;
    vadSamplesAccepted: number;
    vadSegmentsPopped: number;
    diarizationCalls: number;
    diarizationSkippedDisabled: number;
    diarizationFailures: number;
    diarizationTotalMs: number;
    diarizationAverageMs?: number | null;
    diarizationNewSpeakers: number;
}

export interface AudioPipelineSnapshot {
    nativeSamplesReceived: number;
    mutedNativeSamples: number;
    conditionedSamplesEmitted: number;
    chunksEnqueued: number;
    chunksDropped: number;
    samplesDropped: number;
    captureErrors: number;
    resamplerErrors: number;
}

export interface RuntimeAudioDiagnostics {
    running: boolean;
    pipeline: AudioPipelineSnapshot;
}

export interface SpeechDiagnosticBundle {
    schemaVersion: number;
    generatedAt: string;
    appVersion: string;
    capabilities: SpeechCapabilities;
    detection: SpeechDetectionDiagnostics;
    localAudio: RuntimeAudioDiagnostics;
    deepgramAudio: RuntimeAudioDiagnostics;
    moonshineVoice: MoonshineVoiceSupport;
    moonshineDefaultModel?: MoonshineVoiceModelStatus | null;
    moonshineAutoResolution: MoonshineQualityResolution;
    moonshineModels: MoonshineModelCatalogEntry[];
    contextSidecar: SpeechContextSidecarStatus;
    crossChannelEcho: CrossChannelEchoDiagnostics;
    rawAudioRetained: boolean;
    privacyNote: string;
}

type NativeSpeechDiagnosticBundle = Omit<SpeechDiagnosticBundle, "crossChannelEcho">;

function isDesktopRuntime(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const EMPTY_DIAGNOSTICS: SpeechDetectionDiagnostics = {
    diarizationEnabled: true,
    vadSamplesAccepted: 0,
    vadSegmentsPopped: 0,
    diarizationCalls: 0,
    diarizationSkippedDisabled: 0,
    diarizationFailures: 0,
    diarizationTotalMs: 0,
    diarizationAverageMs: null,
    diarizationNewSpeakers: 0,
};

export async function getSpeechDetectionDiagnostics(): Promise<SpeechDetectionDiagnostics> {
    if (!isDesktopRuntime()) return { ...EMPTY_DIAGNOSTICS };
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<SpeechDetectionDiagnostics>("get_speech_detection_diagnostics");
}

export async function resetSpeechDetectionDiagnostics(): Promise<SpeechDetectionDiagnostics> {
    if (!isDesktopRuntime()) return { ...EMPTY_DIAGNOSTICS };
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<SpeechDetectionDiagnostics>("reset_speech_detection_diagnostics");
}

export async function getSpeechDiagnosticBundle(): Promise<SpeechDiagnosticBundle | null> {
    if (!isDesktopRuntime()) return null;
    const { invoke } = await import("@tauri-apps/api/core");
    const native = await invoke<NativeSpeechDiagnosticBundle>("get_speech_diagnostic_bundle");
    return {
        ...native,
        // Evidence only: this detects likely dual-capture leakage in the
        // canonical transcript and never suppresses or rewrites lines.
        crossChannelEcho: analyzeCrossChannelEcho(useTranscriptStore.getState().lines),
    };
}
