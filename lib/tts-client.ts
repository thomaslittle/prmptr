"use client";

export const LOCAL_SHERPA_TTS_ENDPOINT = "local://sherpa-kokoro";

function b64ToBlob(base64: string, mime = "audio/mpeg"): Blob {
    const clean = base64.includes(",") ? base64.split(",")[1] : base64;
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
}

function coerceAudioUrl(payload: Record<string, unknown>): string | null {
    const urlKeys = ["url", "audio_url", "audioUrl", "output_url", "outputUrl"];
    for (const key of urlKeys) {
        const v = payload[key];
        if (typeof v === "string" && v.trim()) return v;
    }
    return null;
}

function coerceAudioBlob(payload: Record<string, unknown>): Blob | null {
    const b64Keys = ["audio_base64", "audioBase64", "base64", "audio"];
    for (const key of b64Keys) {
        const v = payload[key];
        if (typeof v === "string" && v.trim()) {
            const mime = typeof payload.mime === "string" ? payload.mime : "audio/mpeg";
            return b64ToBlob(v, mime);
        }
    }
    return null;
}

function normalizeTtsModel(model?: string): string | undefined {
    const value = model?.trim();
    if (!value) return undefined;
    if (value === "kokoro" || value === "kokoro-82m") return "model";
    if (value === "kokoro-tts") return "model_q4";
    return value;
}

export function stripTtsText(input: string): string {
    return input
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
        .replace(/[*_~>#-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function toRealtimeSpeakText(input: string, maxChars = 140, maxWords = 22): string {
    const cleaned = stripTtsText(input)
        .replace(/\[(AUDIO|YOU|THEM|SCREEN)\]\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\s*:\s*/gi, " ")
        .replace(/\[(AUDIO|YOU|THEM|SCREEN)\]\s*/gi, " ")
        .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)\s*:\s*/gi, " ")
        .replace(/\b(analysis|summary|key points?|response)\s*:/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
    if (!cleaned) return "";

    const firstSentence = cleaned.split(/(?<=[.!?])\s+/)[0]?.trim() || cleaned;
    const words = firstSentence.split(/\s+/).filter(Boolean).slice(0, Math.max(8, maxWords));
    const short = words.join(" ").slice(0, Math.max(64, maxChars)).trim();
    if (!short) return "";
    if (/[.!?]$/.test(short)) return short;
    return `${short}.`;
}

export async function synthesizeTts(
    endpoint: string,
    text: string,
    voice?: string,
    model?: string,
    rate?: number,
    apiKey?: string,
    signal?: AbortSignal
): Promise<string> {
    const trimmedEndpoint = endpoint.trim();
    if (!trimmedEndpoint) throw new Error("TTS endpoint is empty");

    const isTauriRuntime =
        typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    const normalizedModel = normalizeTtsModel(model);
    if (isTauriRuntime) {
        const { synthesizeTtsViaTauri } = await import("@/lib/tauri");
        const proxied = await synthesizeTtsViaTauri(trimmedEndpoint, text, voice, normalizedModel, rate, apiKey);
        if (proxied.audio_base64) {
            const blob = b64ToBlob(proxied.audio_base64, proxied.mime || "audio/mpeg");
            return URL.createObjectURL(blob);
        }
        if (proxied.json) {
            const directUrl = coerceAudioUrl(proxied.json);
            if (directUrl) return directUrl;
            const blob = coerceAudioBlob(proxied.json);
            if (blob) return URL.createObjectURL(blob);
        }
        throw new Error("TTS proxy response did not contain playable audio");
    }
    if (trimmedEndpoint.startsWith("local://")) {
        throw new Error("Local Sherpa TTS is available only in the desktop app runtime.");
    }

    const body: Record<string, unknown> = { text };
    if (voice?.trim()) body.voice = voice.trim();
    if (normalizedModel) body.model = normalizedModel;
    if (typeof rate === "number" && Number.isFinite(rate)) body.speed = rate;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey?.trim()) {
        headers.Authorization = `Bearer ${apiKey.trim()}`;
        headers["x-api-key"] = apiKey.trim();
    }
    const response = await fetch(trimmedEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
    });
    if (!response.ok) {
        const msg = await response.text().catch(() => "");
        throw new Error(`TTS failed (${response.status}): ${msg || response.statusText}`);
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType.startsWith("audio/")) {
        const blob = await response.blob();
        return URL.createObjectURL(blob);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const directUrl = coerceAudioUrl(data);
    if (directUrl) return directUrl;

    const blob = coerceAudioBlob(data);
    if (blob) return URL.createObjectURL(blob);

    throw new Error("TTS response did not contain playable audio");
}

export async function playTtsUrl(
    url: string,
    opts?: { volume?: number; playbackRate?: number }
): Promise<HTMLAudioElement> {
    const audio = new Audio(url);
    audio.preload = "auto";
    if (typeof opts?.volume === "number" && Number.isFinite(opts.volume)) {
        audio.volume = Math.max(0, Math.min(1, opts.volume));
    }
    if (typeof opts?.playbackRate === "number" && Number.isFinite(opts.playbackRate)) {
        audio.playbackRate = Math.max(0.5, Math.min(2, opts.playbackRate));
    }
    await audio.play();
    return audio;
}
