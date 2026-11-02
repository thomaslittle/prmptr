// High-level LLM calls used by the UI (replaces the old /api/llm route).
//
// Resolves API keys from settings, validates loopback-only targets, resolves
// `lmstudio-auto`, routes "Your AI apps" turns through OriginLM (Rust), streams
// tokens, and fails over to a second provider on rate limits.

import { fetchJson } from "./http";
import { LlmRequestError, RateLimitError, classifyLocalAiError, classifyProviderError } from "./llm-errors";
import { streamLLMResponse } from "./llm-providers";
import { localHttpBaseUrl, normalizeV1BaseUrl } from "./local-url";
import { fetchProviderModels } from "./provider-models";
import { localAiCancel, localAiComplete } from "./tauri";
import type { LLMProvider, LocalAiRoute } from "./types";

export { LlmRequestError, RateLimitError };

export interface LlmCall {
    systemPrompt: string;
    userMessage: string;
    provider: LLMProvider;
    model: string;
    apiKey?: string;
    baseUrl?: string;
    /** Required for provider "local-ai" (`model` is the OriginLM model id). */
    localAi?: LocalAiRoute;
    imageDataUrl?: string;
    maxTokens?: number;
    temperature?: number;
}

/** Providers whose key comes from Settings (Your AI apps and LM Studio don't need one). */
export function providerNeedsApiKey(provider: LLMProvider): boolean {
    return provider !== "lmstudio" && provider !== "local-ai";
}

/** Fast fallback model on the *other* low-latency provider when one is rate limited. */
export function fallbackModelForProvider(provider: "groq" | "cerebras"): string {
    return provider === "groq" ? "openai/gpt-oss-20b" : "gpt-oss-120b";
}

async function resolveLmStudioModel(baseUrl: string, model: string): Promise<string> {
    if (model !== "lmstudio-auto") return model;
    const data = await fetchJson<{ data?: Array<{ id?: string }> }>(`${baseUrl}/models`);
    if (data === null) {
        // fetchJson swallows transport/HTTP failures; most often LM Studio isn't running.
        throw new LlmRequestError(
            classifyProviderError({ provider: "lmstudio", model, bodyText: "could not list models", baseUrl })
        );
    }
    const ids = (data?.data ?? []).map((m) => (typeof m?.id === "string" ? m.id : "")).filter(Boolean);
    if (ids.length === 0) {
        throw new Error("LM Studio has no model loaded. Load a model in LM Studio, then retry.");
    }
    const chat = ids.filter((id) => !/(embed|embedding|rerank|bge|nomic-embed)/i.test(id));
    const candidates = chat.length > 0 ? chat : ids;
    return candidates.find((id) => /(instruct|chat|assistant)/i.test(id)) ?? candidates[0];
}

/** Stream one completion; `onToken` receives the accumulated text so far. */
export async function streamCompletionOnce(
    call: LlmCall,
    onToken: (fullText: string) => void,
    signal?: AbortSignal
): Promise<string> {
    if (call.provider === "local-ai" && call.systemPrompt && call.userMessage && !call.model) {
        throw new Error("Pick a model from Your AI apps in the model picker, then retry.");
    }
    if (!call.systemPrompt || !call.userMessage || !call.model) {
        throw new Error("Missing prompt or model");
    }
    if (providerNeedsApiKey(call.provider) && !call.apiKey) {
        throw new Error(`No API key for ${call.provider}. Add one in Settings → Providers.`);
    }

    if (call.provider === "local-ai") {
        return streamLocalAi(call, onToken, signal);
    }

    const apiKey = call.apiKey ?? "";
    let baseUrl: string | undefined;
    let model = call.model;
    if (call.provider === "lmstudio") {
        baseUrl = localHttpBaseUrl(normalizeV1BaseUrl(call.baseUrl, "http://localhost:1234")) ?? undefined;
        if (!baseUrl) throw new Error("LM Studio URL must point at this machine (localhost / 127.0.0.1)");
        model = await resolveLmStudioModel(baseUrl, model);
    }

    let fullText = "";
    for await (const token of streamLLMResponse({
        systemPrompt: call.systemPrompt,
        userMessage: call.userMessage,
        provider: call.provider,
        model,
        apiKey,
        baseUrl,
        imageDataUrl: call.imageDataUrl,
        maxTokens: call.maxTokens ?? 1024,
        temperature: call.temperature ?? 0.4,
        signal,
    })) {
        if (signal?.aborted) break;
        fullText += token;
        onToken(fullText);
    }
    return fullText;
}

function abortError(): Error {
    const err = new Error("The request was cancelled");
    err.name = "AbortError";
    return err;
}

let localAiRequestSeq = 0;

function newLocalAiRequestId(): string {
    const random =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : Math.random().toString(36).slice(2);
    return `prmptr-${Date.now().toString(36)}-${++localAiRequestSeq}-${random}`;
}

/** One turn through an installed AI app via OriginLM (see src-tauri/src/local_ai.rs). */
async function streamLocalAi(
    call: LlmCall,
    onToken: (fullText: string) => void,
    signal?: AbortSignal
): Promise<string> {
    const route = call.localAi;
    if (!route?.routeId) {
        throw new Error("Pick a model from Your AI apps in the model picker, then retry.");
    }
    if (signal?.aborted) throw abortError();

    // OriginLM turns take a single prompt, so the system prompt leads it.
    const prompt = `${call.systemPrompt}

---

${call.userMessage}`;
    const requestId = newLocalAiRequestId();
    let fullText = "";
    let settled = false;

    return new Promise<string>((resolve, reject) => {
        const onAbort = () => {
            if (settled) return;
            settled = true;
            void localAiCancel(requestId).catch(() => {});
            reject(abortError());
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        localAiComplete(
            {
                selection: { routeId: route.routeId, modelId: call.model, revision: route.revision },
                prompt,
                requestId,
                imageDataUrl: route.supportsImageInput === true && call.imageDataUrl ? call.imageDataUrl : null,
            },
            (delta) => {
                if (settled) return;
                fullText += delta;
                onToken(fullText);
            }
        ).then(
            (text) => {
                signal?.removeEventListener("abort", onAbort);
                if (settled) return;
                settled = true;
                // The resolved text is authoritative (deltas may be coalesced).
                const finalText = typeof text === "string" && text.length > 0 ? text : fullText;
                if (finalText !== fullText) onToken(finalText);
                resolve(finalText);
            },
            (err: unknown) => {
                signal?.removeEventListener("abort", onAbort);
                if (settled) return;
                settled = true;
                const message = err instanceof Error ? err.message : String(err);
                reject(
                    message === "Cancelled"
                        ? abortError()
                        : // Subscription usage limits reset on the app's own schedule, so
                          // show them instead of silently backing off.
                          new LlmRequestError(
                              classifyLocalAiError({
                                  appName: route.providerName,
                                  model: route.name || call.model,
                                  message,
                              })
                          )
                );
            }
        );
    });
}

/**
 * Stream a completion, trying each fallback in order when the previous
 * attempt was rate limited.
 */
export async function streamCompletion(
    call: LlmCall,
    onToken: (fullText: string) => void,
    signal?: AbortSignal,
    fallbacks: LlmCall[] = []
): Promise<string> {
    const attempts = [call, ...fallbacks];
    let lastRateLimit: RateLimitError | null = null;
    for (let i = 0; i < attempts.length; i++) {
        try {
            return await streamCompletionOnce(attempts[i], onToken, signal);
        } catch (err) {
            if (err instanceof RateLimitError && i < attempts.length - 1 && !signal?.aborted) {
                lastRateLimit = err;
                onToken("");
                continue;
            }
            throw err;
        }
    }
    throw lastRateLimit ?? new Error("LLM request failed");
}

// ─── Vision capability ───

const capabilityCache = new Map<string, { expiresAt: number; byId: Record<string, boolean | undefined> }>();
const CAPABILITY_TTL_MS = 5 * 60_000;

/** Heuristic image-input support when the provider doesn't report it. */
export function modelSupportsImageInput(provider: LLMProvider, model: string): boolean {
    const id = model.toLowerCase();
    const hasVisionMarker =
        /\b(vision|vl|multimodal|omni)\b/.test(id) ||
        /(gpt-4o|gpt-4\.1|gpt-[5-9]|llava|pixtral|qwen[23](\.\d)?-vl|gemma-[34]|llama-3\.2-.*vision|llama-4)/.test(id);
    if (provider === "anthropic") return /^claude-/.test(id);
    if (provider === "openai") return hasVisionMarker || /^(gpt-[5-9]|o\d)/.test(id);
    // OriginLM reports image support per model; it travels on the selection.
    if (provider === "local-ai") return false;
    return hasVisionMarker;
}

/** Exact image-input support from the provider's live catalog (cached), or undefined. */
export async function fetchModelImageSupport(params: {
    provider: LLMProvider;
    model: string;
    apiKey?: string;
    baseUrl?: string;
}): Promise<boolean | undefined> {
    const key = `${params.provider}|${params.apiKey || ""}|${params.baseUrl || ""}`;
    const cached = capabilityCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.byId[params.model];
    const models = await fetchProviderModels(params);
    const byId: Record<string, boolean | undefined> = {};
    for (const m of models) byId[m.id] = m.supportsImageInput;
    capabilityCache.set(key, { byId, expiresAt: Date.now() + CAPABILITY_TTL_MS });
    return byId[params.model];
}
