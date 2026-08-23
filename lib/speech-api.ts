import { isTauri } from "@/lib/tauri";

export type LocalSpeechEngineId = "whisper" | "moonshine-sherpa";

export interface StartSpeechOptions {
    inputDeviceName?: string;
    outputDeviceName?: string;
    whisperModelId?: string;
    preferGpu?: boolean;
    engine: LocalSpeechEngineId;
    muteInput?: boolean;
    muteOutput?: boolean;
    queueCapacity?: number;
}

export interface NativeLocalSpeechConfig {
    input_device_name: string | null;
    output_device_name: string | null;
    whisper_model_id: string | null;
    prefer_gpu: boolean;
    engine: LocalSpeechEngineId;
    mute_input: boolean;
    mute_output: boolean;
    queue_capacity: number;
}

export interface SpeechActivity {
    running: boolean;
    inputLevel: number;
    outputLevel: number;
    inputMuted: boolean;
    outputMuted: boolean;
}

export function toNativeLocalSpeechConfig(options: StartSpeechOptions): NativeLocalSpeechConfig {
    return {
        input_device_name: options.inputDeviceName ?? null,
        output_device_name: options.outputDeviceName ?? null,
        whisper_model_id: options.whisperModelId ?? null,
        prefer_gpu: options.preferGpu ?? false,
        engine: options.engine,
        mute_input: options.muteInput ?? false,
        mute_output: options.muteOutput ?? false,
        queue_capacity: Math.max(8, Math.min(1024, Math.trunc(options.queueCapacity ?? 96))),
    };
}

export async function startSpeechTranscription(options: StartSpeechOptions): Promise<void> {
    if (!isTauri()) throw new Error("Native speech transcription requires Tauri");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("start_speech_transcription", { config: toNativeLocalSpeechConfig(options) });
}

export async function stopSpeechTranscription(): Promise<void> {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("stop_speech_transcription");
}

export async function setSpeechMute(channel: "input" | "output", muted: boolean): Promise<void> {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("set_speech_mute", { channel, muted });
}

export async function getSpeechActivity(): Promise<SpeechActivity> {
    if (!isTauri()) {
        return {
            running: false,
            inputLevel: 0,
            outputLevel: 0,
            inputMuted: false,
            outputMuted: false,
        };
    }
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<SpeechActivity>("get_speech_activity");
}
