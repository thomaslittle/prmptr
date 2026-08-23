/**
 * Tauri bridge layer — wraps @tauri-apps/api calls with browser fallbacks.
 * In Tauri: uses invoke() and event listeners.
 * In browser: falls back to Next.js API routes.
 */

let _isTauri: boolean | null = null;

export function isTauri(): boolean {
    if (_isTauri !== null) return _isTauri;
    _isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    return _isTauri;
}

// ─── Screenpipe Commands ───

export async function startScreenpipe(config?: Record<string, unknown>): Promise<void> {
    if (!isTauri()) throw new Error("Screenpipe management requires Tauri");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("start_screenpipe", { config });
}

export async function stopScreenpipe(): Promise<void> {
    if (!isTauri()) throw new Error("Screenpipe management requires Tauri");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("stop_screenpipe");
}

export async function updateScreenpipeConfig(config: Record<string, unknown>): Promise<void> {
    if (!isTauri()) throw new Error("Screenpipe management requires Tauri");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("update_screenpipe_config", { config });
}

export async function getScreenpipeStatus(): Promise<{
    running: boolean;
    healthy: boolean;
    port: number;
    version: string | null;
}> {
    if (!isTauri()) throw new Error("Screenpipe status requires Tauri");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("get_screenpipe_status");
}

export async function getAudioDevices(): Promise<Array<{ name: string; is_default: boolean }>> {
    if (!isTauri()) throw new Error("Audio devices require Tauri");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("get_audio_devices");
}

// ─── Native Audio Device Enumeration ───

export async function listSystemAudioDevices(): Promise<Array<{ name: string; is_default: boolean }>> {
    if (!isTauri()) return [];
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("list_system_audio_devices");
}

// ─── Screenpipe Install Commands ───

export async function checkScreenpipeInstalled(): Promise<{ installed: boolean; path?: string }> {
    if (!isTauri()) return { installed: false };
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("check_screenpipe_installed");
}

export async function installScreenpipe(): Promise<string> {
    if (!isTauri()) throw new Error("Install requires Tauri");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("install_screenpipe");
}

export async function onInstallProgress(
    callback: (progress: { stage: string; percent: number }) => void
): Promise<UnlistenFn> {
    if (!isTauri()) return () => {};
    const { listen } = await import("@tauri-apps/api/event");
    return listen<{ stage: string; percent: number }>(
        "screenpipe-install-progress",
        (event) => callback(event.payload)
    );
}

// ─── Session Commands ───

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
    if (!isTauri()) return; // Web mode: session is client-side only
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("start_session", { config });
}

export async function endSession(): Promise<{ duration_secs: number; response_count: number } | null> {
    if (!isTauri()) return null;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("end_session");
}

// ─── LLM Commands ───

export async function validateApiKey(
    provider: string,
    apiKey: string,
    baseUrl?: string
): Promise<boolean> {
    if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        return invoke("validate_api_key", {
            provider,
            apiKey,
            baseUrl: baseUrl ?? null,
        });
    }
    // Browser fallback: direct validation
    if (provider === "anthropic") {
        const resp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 1,
                messages: [{ role: "user", content: "hi" }],
            }),
        });
        return resp.ok;
    }
    const base = provider === "groq"
        ? "https://api.groq.com/openai/v1"
        : provider === "cerebras"
            ? "https://api.cerebras.ai/v1"
            : "https://api.openai.com/v1";
    const resp = await fetch(`${base}/models`, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });
    return resp.ok;
}

export async function fetchLmstudioModels(baseUrl?: string): Promise<string[]> {
    if (isTauri()) {
        const { invoke } = await import("@tauri-apps/api/core");
        return invoke("fetch_lmstudio_models", { baseUrl: baseUrl ?? null });
    }
    // Browser fallback
    const url = baseUrl || "http://localhost:1234";
    const resp = await fetch(`${url}/v1/models`);
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.data ?? []).map((m: { id: string }) => m.id);
}

// ─── Template Commands ───

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
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("load_templates");
}

// ─── Local Whisper Commands ───

export async function startLocalTranscription(
    inputDeviceName?: string,
    outputDeviceName?: string,
    whisperModelId?: string,
    preferGpu?: boolean,
    useMoonshine?: boolean,
    muteInput?: boolean,
    muteOutput?: boolean
): Promise<void> {
    if (!isTauri()) throw new Error("Local transcription requires Tauri");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("start_local_transcription", {
        input_device_name: inputDeviceName ?? null,
        output_device_name: outputDeviceName ?? null,
        whisper_model_id: whisperModelId ?? null,
        prefer_gpu: preferGpu ?? null,
        use_moonshine: useMoonshine ?? null,
        mute_input: muteInput ?? null,
        mute_output: muteOutput ?? null,
        // Compatibility: support builds that expect camelCase argument mapping.
        inputDeviceName: inputDeviceName ?? null,
        outputDeviceName: outputDeviceName ?? null,
        whisperModelId: whisperModelId ?? null,
        preferGpu: preferGpu ?? null,
        useMoonshine: useMoonshine ?? null,
        muteInput: muteInput ?? null,
        muteOutput: muteOutput ?? null,
    });
}

export interface LocalGpuStatus {
    nvidia_gpu_detected: boolean;
    cuda_toolkit_installed: boolean;
    cuda_backend_available: boolean;
    can_use_gpu: boolean;
    message: string;
    /** e.g. "v13.3 (via CUDA_PATH)" — which toolkit was found and how */
    cuda_toolkit_version?: string;
    /** Actionable setup steps when GPU is not fully usable */
    hints?: string[];
}

export async function getLocalTranscriptionGpuStatus(): Promise<LocalGpuStatus> {
    if (!isTauri()) {
        return {
            nvidia_gpu_detected: false,
            cuda_toolkit_installed: false,
            cuda_backend_available: false,
            can_use_gpu: false,
            message: "GPU status is only available in the desktop app.",
        };
    }
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("get_local_transcription_gpu_status");
}

export async function openExternalUrl(url: string): Promise<void> {
    if (!isTauri()) {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("open_external_url", { url });
}

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
    if (!isTauri()) throw new Error("TTS proxy requires Tauri");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("proxy_tts_synthesize", {
        endpoint,
        text,
        voice: voice ?? null,
        model: model ?? null,
        rate: rate ?? null,
        api_key: apiKey ?? null,
    });
}

export async function listTtsVoicesViaTauri(endpoint: string, apiKey?: string): Promise<string[]> {
    if (!isTauri()) return [];
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("proxy_tts_list_voices", {
        endpoint,
        api_key: apiKey ?? null,
    });
}

export interface WhisperModelInfo {
    id: string;
    name: string;
    filename: string;
    description: string;
    size_mb: number;
    installed: boolean;
    selected: boolean;
}

export interface WhisperModelDownloadProgress {
    model_id: string;
    stage: string;
    percent: number;
    downloaded_bytes: number;
    total_bytes?: number | null;
}

export async function listWhisperModels(): Promise<WhisperModelInfo[]> {
    if (!isTauri()) return [];
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("list_whisper_models");
}

export async function getSelectedWhisperModel(): Promise<string> {
    if (!isTauri()) return "tiny.en";
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("get_selected_whisper_model");
}

export async function setSelectedWhisperModel(modelId: string): Promise<void> {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("set_selected_whisper_model", {
        model_id: modelId,
        modelId,
    });
}

export async function downloadWhisperModel(modelId: string): Promise<void> {
    if (!isTauri()) throw new Error("Whisper model download requires Tauri");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("download_whisper_model", {
        model_id: modelId,
        modelId,
    });
}

export async function isMoonshineModelInstalled(): Promise<boolean> {
    if (!isTauri()) return false;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("is_moonshine_model_installed");
}

/** Downloads + extracts the Moonshine base int8 model (~200 MB, one-time). */
export async function downloadMoonshineModel(): Promise<void> {
    if (!isTauri()) throw new Error("Moonshine download requires Tauri");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("download_moonshine_model");
}

export async function onWhisperModelDownloadProgress(
    callback: (progress: WhisperModelDownloadProgress) => void
): Promise<UnlistenFn> {
    if (!isTauri()) return () => {};
    const { listen } = await import("@tauri-apps/api/event");
    return listen<WhisperModelDownloadProgress>("whisper-model-download-progress", (event) =>
        callback(event.payload)
    );
}

export async function stopLocalTranscription(): Promise<void> {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("stop_local_transcription");
}

/** Live per-channel mute — no stop/restart. Channel is "input" or "output". */
export async function setLocalMute(channel: "input" | "output", muted: boolean): Promise<void> {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("set_local_mute", { channel, muted });
}

export interface LocalActivity {
    input_level: number;
    output_level: number;
    input_muted: boolean;
    output_muted: boolean;
}

export async function getLocalActivity(): Promise<LocalActivity> {
    if (!isTauri()) {
        return { input_level: 0, output_level: 0, input_muted: false, output_muted: false };
    }
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("get_local_activity");
}

export async function onLocalTranscriptionActivity(
    handler: (activity: LocalActivity) => void
): Promise<() => void> {
    if (!isTauri()) return () => {};
    const { listen } = await import("@tauri-apps/api/event");
    return listen<LocalActivity>("local-transcription-activity", (event) => {
        handler(event.payload);
    });
}

export async function startDirectDeepgramTranscription(
    apiKey: string,
    inputDeviceName?: string,
    outputDeviceName?: string,
    muteInput?: boolean,
    muteOutput?: boolean
): Promise<void> {
    if (!isTauri()) throw new Error("Direct Deepgram transcription requires Tauri");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("start_direct_deepgram_transcription", {
        api_key: apiKey,
        input_device_name: inputDeviceName ?? null,
        output_device_name: outputDeviceName ?? null,
        mute_input: muteInput ?? false,
        mute_output: muteOutput ?? false,
        apiKey,
        inputDeviceName: inputDeviceName ?? null,
        outputDeviceName: outputDeviceName ?? null,
        muteInput: muteInput ?? false,
        muteOutput: muteOutput ?? false,
    });
}

export async function updateDirectDeepgramTranscription(
    apiKey: string,
    inputDeviceName?: string,
    outputDeviceName?: string,
    muteInput?: boolean,
    muteOutput?: boolean
): Promise<void> {
    if (!isTauri()) throw new Error("Direct Deepgram transcription requires Tauri");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("update_direct_deepgram_transcription", {
        api_key: apiKey,
        input_device_name: inputDeviceName ?? null,
        output_device_name: outputDeviceName ?? null,
        mute_input: muteInput ?? false,
        mute_output: muteOutput ?? false,
        apiKey,
        inputDeviceName: inputDeviceName ?? null,
        outputDeviceName: outputDeviceName ?? null,
        muteInput: muteInput ?? false,
        muteOutput: muteOutput ?? false,
    });
}

export async function stopDirectDeepgramTranscription(): Promise<void> {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("stop_direct_deepgram_transcription");
}

export async function setDeepgramMute(channel: "input" | "output", muted: boolean): Promise<void> {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("set_deepgram_mute", { channel, muted });
}

export async function captureNativeScreenshotViaTauri(): Promise<string | null> {
    if (!isTauri()) return null;
    const { invoke } = await import("@tauri-apps/api/core");
    try {
        const payload = await invoke("plugin:mcp-bridge|capture_native_screenshot");
        if (typeof payload === "string" && payload.trim()) {
            const raw = payload.trim();
            if (raw.startsWith("data:image/")) return raw;
            return `data:image/png;base64,${raw}`;
        }
        if (payload && typeof payload === "object") {
            const p = payload as Record<string, unknown>;
            const candidates = [p.data, p.image, p.base64, p.image_base64];
            for (const c of candidates) {
                if (typeof c === "string" && c.trim()) {
                    const raw = c.trim();
                    if (raw.startsWith("data:image/")) return raw;
                    return `data:image/png;base64,${raw}`;
                }
            }
        }
        return null;
    } catch {
        return null;
    }
}

export async function onLocalTranscription(
    callback: (result: {
        id: string;
        text: string;
        is_final: boolean;
        timestamp: string;
        device_type: "input" | "output";
        speaker_id: number | null;
        speaker_label: string | null;
    }) => void
): Promise<UnlistenFn> {
    if (!isTauri()) return () => {};
    const { listen } = await import("@tauri-apps/api/event");
    return listen<{
        id: string;
        text: string;
        is_final: boolean;
        timestamp: string;
        device_type: "input" | "output";
        speaker_id: number | null;
        speaker_label: string | null;
    }>(
        "local-transcription",
        (event) => callback(event.payload)
    );
}

// ─── Event Listeners ───

export type UnlistenFn = () => void;

export async function onScreenpipeStatus(
    callback: (status: { running: boolean; healthy: boolean; message: string }) => void
): Promise<UnlistenFn> {
    if (!isTauri()) return () => {};
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<{ running: boolean; healthy: boolean; message: string }>(
        "screenpipe-status",
        (event) => callback(event.payload)
    );
    return unlisten;
}

export async function onTranscriptUpdate(
    callback: (text: string) => void
): Promise<UnlistenFn> {
    if (!isTauri()) return () => {};
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<string>("transcript-update", (event) => {
        callback(event.payload);
    });
    return unlisten;
}

/**
 * Emitted by the Rust transcription workers when they die unexpectedly
 * (whisper thread exit, Deepgram websocket drop). The UI must flip out of
 * its optimistic "running" state and surface the error.
 */
export async function onLocalTranscriptionStatus(
    callback: (status: { mode: "local-whisper" | "direct-deepgram"; running: boolean; error?: string }) => void
): Promise<UnlistenFn> {
    if (!isTauri()) return () => {};
    const { listen } = await import("@tauri-apps/api/event");
    return listen<{
        mode: "local-whisper" | "direct-deepgram";
        running: boolean;
        error?: string;
    }>("local-transcription-status", (event) => callback(event.payload));
}
