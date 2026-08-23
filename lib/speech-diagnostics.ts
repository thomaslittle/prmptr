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
