const STORAGE_KEY = "prmptr-speaker-diarization";

export function parseSpeakerDiarizationPreference(raw: string | null): boolean {
    if (raw == null) return true;
    const normalized = raw.trim().toLowerCase();
    return !["0", "false", "off", "disabled", "no"].includes(normalized);
}

export function getSpeakerDiarizationPreference(): boolean {
    if (typeof window === "undefined") return true;
    return parseSpeakerDiarizationPreference(window.localStorage.getItem(STORAGE_KEY));
}

function isDesktopRuntime(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function syncSpeakerDiarizationPreference(enabled?: boolean): Promise<boolean> {
    const effective = enabled ?? getSpeakerDiarizationPreference();
    if (!isDesktopRuntime()) return effective;

    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<boolean>("set_speaker_diarization_enabled", { enabled: effective });
}

export async function setSpeakerDiarizationPreference(enabled: boolean): Promise<boolean> {
    if (typeof window !== "undefined") {
        window.localStorage.setItem(STORAGE_KEY, String(enabled));
    }
    return syncSpeakerDiarizationPreference(enabled);
}
