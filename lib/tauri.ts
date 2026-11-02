/**
 * Typed bridge to the Rust backend (Tauri commands + events).
 *
 * Tauri 2 maps command arguments from camelCase JS keys to snake_case Rust
 * parameters, so every call below passes camelCase. Outside the desktop app
 * (plain browser / tests without the IPC mock) calls degrade to safe no-ops
 * or throw a clear "requires the desktop app" error.
 */

import { isTauri } from "./runtime";

export { isTauri };

export type UnlistenFn = () => void;

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(command, args);
}

async function subscribe<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
    if (!isTauri()) return () => {};
    const { listen } = await import("@tauri-apps/api/event");
    return listen<T>(event, (e) => handler(e.payload));
}

function requireDesktop(feature: string): void {
    if (!isTauri()) throw new Error(`${feature} requires the PRMPTR desktop app`);
}

// ─── Audio devices ───

export async function listSystemAudioDevices(): Promise<Array<{ name: string; is_default: boolean }>> {
    if (!isTauri()) return [];
    return call("list_system_audio_devices");
}

// ─── Session ───

export async function startSession(config: {
    context: string;
    trigger_mode: string;
    response_style: string;
    auto_interval_secs: number;
    model: string;
    provider: string;
    temperature: number;
    max_tokens: number;
}): Promise<void> {
    if (!isTauri()) return; // Browser mode: the session is client-side only.
    return call("start_session", { config });
}

export async function endSession(): Promise<{ duration_secs: number; response_count: number } | null> {
    if (!isTauri()) return null;
    return call("end_session");
}

// ─── Provider keys ───

export async function validateApiKey(provider: string, apiKey: string, baseUrl?: string): Promise<boolean> {
    requireDesktop("API key validation");
    return call("validate_api_key", { provider, apiKey, baseUrl: baseUrl ?? null });
}

export async function fetchLmstudioModels(baseUrl?: string): Promise<string[]> {
    if (!isTauri()) return [];
    return call("fetch_lmstudio_models", { baseUrl: baseUrl ?? null });
}

// ─── Templates ───

export interface TemplateData {
    id: string;
    name: string;
    icon: string;
    description: string;
    context: { prefill: string };
    defaults: {
        trigger_mode: string;
        response_style: string;
        auto_interval_secs: number;
        temperature: number;
    };
}

export async function loadTemplates(): Promise<TemplateData[]> {
    if (!isTauri()) return [];
    return call("load_templates");
}

// ─── Local speech-to-text ───

export interface SttModelInfo {
    id: string;
    name: string;
    description: string;
    languages: string;
    size_mb: number;
    installed: boolean;
    selected: boolean;
    recommended: boolean;
}

export interface SttModelDownloadProgress {
    model_id: string;
    stage: string;
    percent: number;
    downloaded_bytes: number;
    total_bytes?: number | null;
}

export async function listSttModels(): Promise<SttModelInfo[]> {
    if (!isTauri()) return [];
    return call("list_stt_models");
}

export async function getSelectedSttModel(): Promise<string> {
    if (!isTauri()) return "parakeet-unified-en";
    return call("get_selected_stt_model");
}

export async function setSelectedSttModel(modelId: string): Promise<void> {
    if (!isTauri()) return;
    return call("set_selected_stt_model", { modelId });
}

export async function downloadSttModel(modelId: string): Promise<void> {
    requireDesktop("Speech model download");
    return call("download_stt_model", { modelId });
}

export function onSttModelDownloadProgress(
    callback: (progress: SttModelDownloadProgress) => void
): Promise<UnlistenFn> {
    return subscribe("stt-model-download-progress", callback);
}

export async function startLocalTranscription(options: {
    inputDeviceName?: string;
    outputDeviceName?: string;
    modelId?: string;
    preferGpu?: boolean;
    muteInput?: boolean;
    muteOutput?: boolean;
    /** Glossary lines (`Term` or `Term = mishearing, …`). */
    glossary?: string[];
}): Promise<void> {
    requireDesktop("Local transcription");
    return call("start_local_transcription", {
        inputDeviceName: options.inputDeviceName ?? null,
        outputDeviceName: options.outputDeviceName ?? null,
        modelId: options.modelId ?? null,
        preferGpu: options.preferGpu ?? false,
        muteInput: options.muteInput ?? false,
        muteOutput: options.muteOutput ?? false,
        glossary: options.glossary ?? [],
    });
}

export async function stopLocalTranscription(): Promise<void> {
    if (!isTauri()) return;
    return call("stop_local_transcription");
}

/** Live per-channel mute — no stop/restart. Channel is "input" or "output". */
export async function setLocalMute(channel: "input" | "output", muted: boolean): Promise<void> {
    if (!isTauri()) return;
    return call("set_local_mute", { channel, muted });
}

export interface LocalActivity {
    input_level: number;
    output_level: number;
    input_muted: boolean;
    output_muted: boolean;
}

export async function getLocalActivity(): Promise<LocalActivity> {
    if (!isTauri()) return { input_level: 0, output_level: 0, input_muted: false, output_muted: false };
    return call("get_local_activity");
}

export function onLocalTranscriptionActivity(handler: (activity: LocalActivity) => void): Promise<UnlistenFn> {
    return subscribe("local-transcription-activity", handler);
}

export interface ComputeDevice {
    kind: string;
    name: string;
    is_gpu: boolean;
}

export interface LocalGpuStatus {
    can_use_gpu: boolean;
    gpu_backends: string[];
    devices: ComputeDevice[];
    message: string;
}

export async function getLocalTranscriptionGpuStatus(): Promise<LocalGpuStatus> {
    if (!isTauri()) {
        return {
            can_use_gpu: false,
            gpu_backends: [],
            devices: [],
            message: "GPU status is only available in the desktop app.",
        };
    }
    return call("get_local_transcription_gpu_status");
}

export interface LocalTranscriptionEvent {
    id: string;
    text: string;
    is_final: boolean;
    timestamp: string;
    device_type: "input" | "output";
    speaker_id: number | null;
    speaker_label: string | null;
}

export function onLocalTranscription(callback: (result: LocalTranscriptionEvent) => void): Promise<UnlistenFn> {
    return subscribe("local-transcription", callback);
}

/**
 * Emitted by the Rust transcription workers when they die unexpectedly
 * (worker thread exit, Deepgram websocket drop). The UI must flip out of its
 * optimistic "running" state and surface the error.
 */
export function onLocalTranscriptionStatus(
    callback: (status: { mode: "local-whisper" | "direct-deepgram"; running: boolean; error?: string }) => void
): Promise<UnlistenFn> {
    return subscribe("local-transcription-status", callback);
}

// ─── Deepgram (cloud) transcription ───

interface DeepgramArgs {
    apiKey: string;
    inputDeviceName?: string;
    outputDeviceName?: string;
    muteInput?: boolean;
    muteOutput?: boolean;
}

function deepgramPayload(args: DeepgramArgs) {
    return {
        apiKey: args.apiKey,
        inputDeviceName: args.inputDeviceName ?? null,
        outputDeviceName: args.outputDeviceName ?? null,
        muteInput: args.muteInput ?? false,
        muteOutput: args.muteOutput ?? false,
    };
}

export async function startDirectDeepgramTranscription(args: DeepgramArgs): Promise<void> {
    requireDesktop("Deepgram transcription");
    return call("start_direct_deepgram_transcription", deepgramPayload(args));
}

export async function updateDirectDeepgramTranscription(args: DeepgramArgs): Promise<void> {
    requireDesktop("Deepgram transcription");
    return call("update_direct_deepgram_transcription", deepgramPayload(args));
}

export async function stopDirectDeepgramTranscription(): Promise<void> {
    if (!isTauri()) return;
    return call("stop_direct_deepgram_transcription");
}

export async function setDeepgramMute(channel: "input" | "output", muted: boolean): Promise<void> {
    if (!isTauri()) return;
    return call("set_deepgram_mute", { channel, muted });
}

// ─── Text to speech ───

export interface TtsProxyResponse {
    audio_base64?: string | null;
    mime?: string | null;
    json?: Record<string, unknown> | null;
}

export async function synthesizeTtsViaTauri(
    endpoint: string,
    text: string,
    voice?: string,
    model?: string,
    rate?: number,
    apiKey?: string
): Promise<TtsProxyResponse> {
    requireDesktop("Text to speech");
    return call("proxy_tts_synthesize", {
        endpoint,
        text,
        voice: voice ?? null,
        model: model ?? null,
        rate: rate ?? null,
        apiKey: apiKey ?? null,
    });
}

export async function listTtsVoicesViaTauri(endpoint: string, apiKey?: string): Promise<string[]> {
    if (!isTauri()) return [];
    return call("proxy_tts_list_voices", { endpoint, apiKey: apiKey ?? null });
}

// ─── Your AI apps (OriginLM) ───
//
// OriginLM runs turns through the AI clients the user already has signed in
// (Claude Code, Codex, OpenCode, Gemini CLI, Ollama, LM Studio, ...). The
// renderer only lists models, starts a completion and cancels it; it never
// sees a credential.

export interface LocalAiModel {
    routeId: string;
    modelId: string;
    revision: string;
    nativeId: string;
    name: string;
    providerId: string;
    providerName: string;
    isDefault: boolean;
    supportsImageInput: boolean;
}

export type LocalAiEvent = { type: "delta"; text: string } | { type: "status"; message: string };

export interface LocalAiCompleteParams {
    selection: { routeId: string; modelId: string; revision: string };
    prompt: string;
    requestId: string;
    imageDataUrl?: string | null;
}

/** Scan installed AI apps and list their models (spawns metadata probes — cache it). */
export async function listLocalAiModels(): Promise<LocalAiModel[]> {
    if (!isTauri()) return [];
    return call("local_ai_models");
}

/**
 * Run one turn through the selected AI app. `onDelta` receives each text
 * chunk as it streams; resolves to the full text. Rejects with "Cancelled"
 * after `localAiCancel(requestId)`.
 */
export async function localAiComplete(
    params: LocalAiCompleteParams,
    onDelta: (text: string) => void,
    onStatus?: (message: string) => void
): Promise<string> {
    requireDesktop("Your AI apps");
    const { Channel } = await import("@tauri-apps/api/core");
    const onEvent = new Channel<LocalAiEvent>();
    onEvent.onmessage = (event) => {
        if (event.type === "delta") onDelta(event.text);
        else if (event.type === "status") onStatus?.(event.message);
    };
    return call("local_ai_complete", {
        onEvent,
        selection: params.selection,
        prompt: params.prompt,
        requestId: params.requestId,
        imageDataUrl: params.imageDataUrl ?? null,
    });
}

export async function localAiCancel(requestId: string): Promise<void> {
    if (!isTauri()) return;
    return call("local_ai_cancel", { requestId });
}

// ─── Misc ───

export async function openExternalUrl(url: string): Promise<void> {
    if (!isTauri()) {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
    }
    return call("open_external_url", { url });
}

export async function captureScreenshot(): Promise<string | null> {
    if (!isTauri()) return null;
    try {
        return await call<string>("capture_screenshot");
    } catch {
        return null;
    }
}
