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

export async function triggerLlm(apiKey?: string, baseUrl?: string): Promise<void> {
    if (!isTauri()) throw new Error("Tauri LLM trigger requires Tauri");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("trigger_llm", {
        apiKey: apiKey ?? null,
        baseUrl: baseUrl ?? null,
    });
}

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
        : "https://api.openai.com/v1";
    const resp = await fetch(`${base}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
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
    preferGpu?: boolean
): Promise<void> {
    if (!isTauri()) throw new Error("Local transcription requires Tauri");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("start_local_transcription", {
        input_device_name: inputDeviceName ?? null,
        output_device_name: outputDeviceName ?? null,
        whisper_model_id: whisperModelId ?? null,
        prefer_gpu: preferGpu ?? null,
        // Compatibility: support builds that expect camelCase argument mapping.
        inputDeviceName: inputDeviceName ?? null,
        outputDeviceName: outputDeviceName ?? null,
        whisperModelId: whisperModelId ?? null,
        preferGpu: preferGpu ?? null,
    });
}

export interface LocalGpuStatus {
    nvidia_gpu_detected: boolean;
    cuda_toolkit_installed: boolean;
    cuda_backend_available: boolean;
    can_use_gpu: boolean;
    message: string;
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

export async function startDirectDeepgramTranscription(
    apiKey: string,
    inputDeviceName?: string,
    outputDeviceName?: string
): Promise<void> {
    if (!isTauri()) throw new Error("Direct Deepgram transcription requires Tauri");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("start_direct_deepgram_transcription", {
        api_key: apiKey,
        input_device_name: inputDeviceName ?? null,
        output_device_name: outputDeviceName ?? null,
        apiKey,
        inputDeviceName: inputDeviceName ?? null,
        outputDeviceName: outputDeviceName ?? null,
    });
}

export async function stopDirectDeepgramTranscription(): Promise<void> {
    if (!isTauri()) return;
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke("stop_direct_deepgram_transcription");
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

export interface StreamToken {
    text: string;
    is_complete: boolean;
    usage: { input_tokens?: number; output_tokens?: number } | null;
}

export async function onResponseStream(
    callback: (token: StreamToken) => void
): Promise<UnlistenFn> {
    if (!isTauri()) return () => {};
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<StreamToken>("response-stream", (event) => {
        callback(event.payload);
    });
    return unlisten;
}

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
