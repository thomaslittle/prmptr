import type { TranscriptLine } from "@/lib/transcript";

export type SpeechEngineId = "whisper" | "moonshine-sherpa" | "moonshine-voice";
export type MoonshineVoiceArch = "tiny-streaming" | "small-streaming" | "medium-streaming";

export interface MoonshineVoiceSupport {
    compiled: boolean;
    wrapperRevision: string;
    nativeRelease: string;
    defaultArch: MoonshineVoiceArch;
    diarizationDefault: boolean;
    speculativeDecodingDefault: boolean;
    wordTimestampsDefault: boolean;
}

export interface MoonshineVoiceModelStatus {
    arch: MoonshineVoiceArch;
    installed: boolean;
    directory: string;
    modelFiles: string[];
    diarizationFiles: string[];
    integrityManifestPresent: boolean;
}

export interface SpeechStartConfig {
    input_device_name?: string | null;
    output_device_name?: string | null;
    whisper_model_id?: string | null;
    prefer_gpu?: boolean;
    engine: SpeechEngineId;
    mute_input?: boolean;
    mute_output?: boolean;
    queue_capacity?: number;
    moonshine_arch?: MoonshineVoiceArch;
    moonshine_context?: string;
    moonshine_keyterms?: string[];
    moonshine_context_max_terms?: number;
    moonshine_keyterm_boost?: number;
}

function desktop(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (!desktop()) throw new Error(`${command} requires the PRMPTR desktop app`);
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke<T>(command, args);
}

export function getMoonshineVoiceSupport(): Promise<MoonshineVoiceSupport> {
    return invoke("get_moonshine_voice_support");
}

export function getMoonshineVoiceModelStatus(
    arch: MoonshineVoiceArch = "medium-streaming"
): Promise<MoonshineVoiceModelStatus> {
    return invoke("get_moonshine_voice_model_status", { arch });
}

export function installMoonshineVoiceModel(
    arch: MoonshineVoiceArch = "medium-streaming"
): Promise<MoonshineVoiceModelStatus> {
    return invoke("install_moonshine_voice_model", { arch });
}

export function startSpeechTranscription(config: SpeechStartConfig): Promise<void> {
    return invoke("start_speech_transcription", { config });
}

export function stopSpeechTranscription(): Promise<void> {
    return invoke("stop_speech_transcription");
}

export function setSpeechContext(text: string, maxTerms = 200): Promise<void> {
    return invoke("set_speech_context", { text, maxTerms });
}

export function setSpeechKeyterms(keyterms: string[]): Promise<void> {
    return invoke("set_speech_keyterms", { keyterms });
}

export async function onSpeechTranscriptLine(
    callback: (line: TranscriptLine) => void
): Promise<() => void> {
    if (!desktop()) return () => {};
    const { listen } = await import("@tauri-apps/api/event");
    return listen<TranscriptLine>("speech-transcript-line", (event) => callback(event.payload));
}
