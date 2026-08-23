export interface CaptureCapability {
    available: boolean;
    backend: string;
    status: "implemented" | "not_implemented" | "unsupported" | string;
    detail: string;
}

export interface SpeechCapabilities {
    platform: string;
    microphoneCapture: CaptureCapability;
    systemCapture: CaptureCapability;
    diarizationAvailable: boolean;
    localEngines: string[];
}

export async function getSpeechCapabilities(): Promise<SpeechCapabilities> {
    const desktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (!desktop) {
        return {
            platform: "browser",
            microphoneCapture: {
                available: false,
                backend: "none",
                status: "unsupported",
                detail: "Native speech capture capability reporting is only available in the desktop app.",
            },
            systemCapture: {
                available: false,
                backend: "none",
                status: "unsupported",
                detail: "Native system-output capture capability reporting is only available in the desktop app.",
            },
            diarizationAvailable: false,
            localEngines: [],
        };
    }

    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<SpeechCapabilities>("get_speech_capabilities");
}
