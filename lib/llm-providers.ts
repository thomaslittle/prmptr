import { appFetch } from "./http";
import {
    LlmRequestError,
    RateLimitError,
    classifyProviderError,
    isAbortLike,
    isNetworkFailure,
    llmErrorFor,
    type ClassifyInput,
} from "./llm-errors";
import { LLMProvider, LLMRequest } from "./types";

export { LlmRequestError, RateLimitError };

export function retryAfterMsFrom(response: Response | null, bodyText: string): number {
    const header = response?.headers.get("retry-after");
    if (header) {
        const secs = Number(header);
        if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000);
        const date = Date.parse(header);
        if (Number.isFinite(date)) return Math.max(1000, date - Date.now());
    }
    const match = bodyText.match(/try again in ([\d.]+)\s*s/i);
    if (match) return Math.ceil(parseFloat(match[1]) * 1000) + 500;
    return 15_000;
}

/**
 * Turn a non-OK provider response into a classified error. HTTP 429 (and
 * explicit rate-limit language) throws `RateLimitError` so `streamCompletion`
 * can fail over; everything else throws `LlmRequestError`.
 */
async function failResponse(
    response: Response,
    request: LLMRequest,
    extra: Pick<ClassifyInput, "actionOverride" | "baseUrl"> = {}
): Promise<never> {
    const errorText = await response.text().catch(() => "");
    const info = classifyProviderError({
        provider: request.provider,
        model: request.model,
        status: response.status,
        bodyText: errorText || response.statusText,
        retryAfterHeader: response.headers.get("retry-after"),
        ...extra,
    });
    if (response.status === 429) {
        // Keep the established back-off semantics for real 429s.
        throw new RateLimitError({ ...info, kind: "rate_limited", retryAfterMs: retryAfterMsFrom(response, errorText) });
    }
    throw llmErrorFor(info);
}

/** Classify an error reported mid-stream (no HTTP status). */
function streamFailure(request: LLMRequest, message: string): LlmRequestError {
    return llmErrorFor(classifyProviderError({ provider: request.provider, model: request.model, bodyText: message }));
}

/**
 * Yield the `data:` payloads of a server-sent-event stream. Handles CRLF
 * line endings, `data:` with or without a space, and events split across
 * network chunks.
 */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let newline: number;
            while ((newline = buffer.indexOf("\n")) !== -1) {
                const line = buffer.slice(0, newline).replace(/\r$/, "");
                buffer = buffer.slice(newline + 1);
                if (line.startsWith("data:")) yield line.slice(5).trimStart();
            }
        }
        buffer += decoder.decode();
        const tail = buffer.replace(/\r$/, "");
        if (tail.startsWith("data:")) yield tail.slice(5).trimStart();
    } finally {
        reader.releaseLock();
    }
}

function parseJson(data: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(data);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

type TextPart = { text?: string; type?: string };

export function extractOpenAIContent(payload: unknown): string {
    const p = payload as
        | {
              choices?: Array<{
                  text?: string;
                  message?: { content?: string | TextPart[] };
                  delta?: { content?: string | TextPart[] };
              }>;
          }
        | undefined;
    const choice = p?.choices?.[0];
    if (!choice) return "";
    const fromContent = (content: string | TextPart[] | undefined): string => {
        if (typeof content === "string") return content;
        if (Array.isArray(content)) return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
        return "";
    };
    if (typeof choice.text === "string" && choice.text) return choice.text;
    return fromContent(choice.message?.content) || fromContent(choice.delta?.content);
}

export function extractAnthropicContent(payload: unknown): string {
    const p = payload as { content?: Array<{ type?: string; text?: string }> } | undefined;
    if (!Array.isArray(p?.content)) return "";
    return p.content
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text as string)
        .join("");
}

/**
 * Current Claude models (4.6+ / 5.x) reject sampling parameters and always
 * think; latency is controlled with `output_config.effort` instead. Older
 * models (Sonnet/Haiku 4.5) still accept `temperature` but not `effort`.
 */
export function anthropicModelTraits(model: string): { modern: boolean; supportsEffort: boolean } {
    const id = model.toLowerCase().replace(/^anthropic\//, "");
    const legacy =
        /^claude-(2|3|instant)/.test(id) || // Claude 2/3 families
        /^claude-(opus|sonnet|haiku)-4-[0-5](-|$)/.test(id) || // 4.0–4.5
        /^claude-(opus|sonnet|haiku)-4(-\d{8})?$/.test(id); // dated 4.0 snapshots
    const modern = !legacy && /^claude-/.test(id);
    return { modern, supportsEffort: modern };
}

/** Thinking models spend output tokens before the visible answer. */
const THINKING_HEADROOM_TOKENS = 2048;

async function* streamAnthropicResponse(request: LLMRequest): AsyncGenerator<string> {
    // Zen/OpenCode expose Anthropic-protocol models under their own /messages route.
    const isZen = request.provider === "zen";
    const url = isZen ? `${getBaseUrl(request.provider, request.baseUrl)}/messages` : "https://api.anthropic.com/v1/messages";
    const traits = anthropicModelTraits(request.model);
    const requested = request.maxTokens || 1024;

    const headers: Record<string, string> = {
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "x-api-key": request.apiKey,
    };
    if (isZen) headers["Authorization"] = `Bearer ${request.apiKey}`;

    const userContent = request.imageDataUrl
        ? (() => {
              const match = request.imageDataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
              return match
                  ? [
                        { type: "image", source: { type: "base64", media_type: match[1], data: match[2] } },
                        { type: "text", text: request.userMessage },
                    ]
                  : request.userMessage;
          })()
        : request.userMessage;

    const body: Record<string, unknown> = {
        model: request.model,
        max_tokens: traits.modern ? requested + THINKING_HEADROOM_TOKENS : requested,
        system: request.systemPrompt,
        messages: [{ role: "user", content: userContent }],
        stream: true,
    };
    if (!traits.modern) body.temperature = request.temperature ?? 0.4;
    // Real-time suggestions: answer fast, think only as much as needed.
    if (traits.supportsEffort && !isZen) body.output_config = { effort: "low" };

    const response = await appFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: request.signal,
    });
    if (!response.ok) await failResponse(response, request);

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/json")) {
        const content = extractAnthropicContent(await response.json());
        if (content) yield content;
        return;
    }
    if (!response.body) throw new Error("No response body");

    for await (const data of sseData(response.body)) {
        const event = parseJson(data);
        if (!event) continue;
        if (event.type === "content_block_delta") {
            const delta = event.delta as { type?: string; text?: string } | undefined;
            if (delta?.type === "text_delta" && delta.text) yield delta.text;
        } else if (event.type === "error") {
            const err = event.error as { type?: string; message?: string } | undefined;
            const info = classifyProviderError({
                provider: request.provider,
                model: request.model,
                bodyText: JSON.stringify({ error: err ?? { message: "unknown stream error" } }),
            });
            if (err?.type === "rate_limit_error" || err?.type === "overloaded_error") {
                // Both are transient on Anthropic's side: back off / fail over.
                throw new RateLimitError({ ...info, retryAfterMs: info.retryAfterMs ?? 15_000 });
            }
            throw llmErrorFor(info);
        } else if (event.type === "message_stop") {
            return;
        }
    }
}

/** OpenAI's own reasoning-era models take `max_completion_tokens` and reject custom temperature. */
function isOpenAiReasoningModel(provider: LLMProvider, model: string): boolean {
    return provider === "openai" && /^(gpt-[5-9]|o\d)/i.test(model);
}

async function* streamOpenAICompatibleResponse(request: LLMRequest, baseUrl: string): AsyncGenerator<string> {
    const isZenFamily = request.provider === "zen";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (request.apiKey) {
        headers["Authorization"] = `Bearer ${request.apiKey}`;
        // The Zen gateway accepts either auth style; send both for parity.
        if (isZenFamily) headers["x-api-key"] = request.apiKey;
    }

    const url = `${baseUrl}/chat/completions`;
    const userContent = request.imageDataUrl
        ? [
              { type: "text", text: request.userMessage },
              { type: "image_url", image_url: { url: request.imageDataUrl } },
          ]
        : request.userMessage;

    const reasoning = isOpenAiReasoningModel(request.provider, request.model);
    const requestBody: Record<string, unknown> = {
        model: request.model,
        messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: userContent },
        ],
        stream: true,
    };
    if (reasoning) {
        requestBody.max_completion_tokens = (request.maxTokens || 1024) + THINKING_HEADROOM_TOKENS;
        requestBody.reasoning_effort = "low";
    } else {
        requestBody.max_tokens = request.maxTokens || 1024;
        requestBody.temperature = request.temperature ?? 0.4;
    }

    const response = await appFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: request.signal,
    });

    if (!response.ok) {
        await failResponse(response, request, {
            baseUrl: request.provider === "lmstudio" ? baseUrl : undefined,
            actionOverride:
                response.status === 401 && isZenFamily
                    ? "Your saved OpenCode Zen key looks stale — paste a fresh key from opencode.ai in Settings → Providers."
                    : undefined,
        });
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/json")) {
        const content = extractOpenAIContent(await response.json());
        if (content) yield content;
        return;
    }
    if (!response.body) throw new Error("No response body");

    let emittedAny = false;
    for await (const data of sseData(response.body)) {
        if (data === "[DONE]") break;
        const parsed = parseJson(data);
        if (!parsed) continue;
        if (parsed.error) {
            throw streamFailure(request, JSON.stringify({ error: parsed.error }));
        }
        const content = extractOpenAIContent(parsed);
        if (content) {
            emittedAny = true;
            yield content;
        }
    }

    // Some OpenAI-compatible servers occasionally emit no token text in stream
    // mode. Retry once without streaming and use the final message content.
    if (!emittedAny && !request.signal?.aborted) {
        const nonStream = await appFetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({ ...requestBody, stream: false }),
            signal: request.signal,
        });
        if (!nonStream.ok) await failResponse(nonStream, request);
        const content = extractOpenAIContent(await nonStream.json().catch(() => ({})));
        if (content) yield content;
    }
}

export function getBaseUrl(provider: LLMProvider, customBaseUrl?: string): string {
    switch (provider) {
        case "openai":
            return "https://api.openai.com/v1";
        case "groq":
            return "https://api.groq.com/openai/v1";
        case "cerebras":
            return "https://api.cerebras.ai/v1";
        case "zen":
            return customBaseUrl || "https://opencode.ai/zen/v1";
        case "lmstudio":
            return customBaseUrl || "http://localhost:1234/v1";
        default:
            throw new Error(`Provider ${provider} doesn't use an OpenAI-compatible API`);
    }
}

export async function* streamLLMResponse(request: LLMRequest): AsyncGenerator<string> {
    try {
        switch (request.provider) {
            case "anthropic":
                yield* streamAnthropicResponse(request);
                break;
            case "zen":
                // Zen serves Claude/Qwen families over the Anthropic /messages
                // protocol; everything else speaks OpenAI chat completions.
                if (/^(claude|qwen)/i.test(request.model)) {
                    yield* streamAnthropicResponse(request);
                } else {
                    yield* streamOpenAICompatibleResponse(request, getBaseUrl(request.provider, request.baseUrl));
                }
                break;
            case "openai":
            case "groq":
            case "cerebras":
            case "lmstudio":
                yield* streamOpenAICompatibleResponse(request, getBaseUrl(request.provider, request.baseUrl));
                break;
            default:
                throw new Error(`Unknown provider: ${request.provider}`);
        }
    } catch (error) {
        // Already-classified provider errors pass through untouched, as do
        // caller cancellations (the UI reports those itself). Raw transport
        // failures (no HTTP response) become structured errors so the
        // analyzer can name the cause instead of dumping a stack.
        if (error instanceof LlmRequestError || request.signal?.aborted) throw error;
        if (isAbortLike(error)) {
            throw new LlmRequestError(
                classifyProviderError({ provider: request.provider, model: request.model, bodyText: "request aborted or timed out" })
            );
        }
        if (isNetworkFailure(error)) {
            const message = error instanceof Error ? error.message : String(error);
            let baseUrl: string | undefined;
            if (request.provider === "lmstudio" || request.provider === "zen") {
                try {
                    baseUrl = getBaseUrl(request.provider, request.baseUrl);
                } catch {
                    baseUrl = undefined;
                }
            }
            throw new LlmRequestError(
                classifyProviderError({
                    provider: request.provider,
                    model: request.model,
                    bodyText: message || "fetch failed",
                    baseUrl,
                })
            );
        }
        throw error;
    }
}
