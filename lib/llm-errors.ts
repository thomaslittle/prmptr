/**
 * Structured LLM failure reporting.
 *
 * Provider errors arrive in many shapes (OpenAI `{error:{message,code,type}}`,
 * Anthropic `{type:"error",error:{...}}`, plain text, empty bodies, connection
 * failures, OriginLM `Code: message` strings) but the analyzer must always tell
 * the user *what happened, where, and what to do* — never a bare
 * `API error 500: {...}` dump.
 *
 * Flow: `lib/llm-providers.ts` throws `LlmRequestError` (or its subclass
 * `RateLimitError` for rate limits, which `lib/llm-client.ts` uses for
 * Groq ⇄ Cerebras failover) and `lib/llm-client.ts` classifies local-ai
 * (OriginLM) failures → `components/ai-response.tsx` renders title/detail/action.
 */

export type LlmErrorKind =
    | "rate_limited"
    | "invalid_key"
    | "model_not_found"
    | "bad_request"
    | "context_overflow"
    | "content_blocked"
    | "provider_unavailable"
    | "network_unreachable"
    | "timed_out"
    | "auth_subscription"
    | "unknown";

export interface LlmErrorInfo {
    kind: LlmErrorKind;
    /** Human short title, e.g. "Groq rate limit". */
    title: string;
    /** What happened, naming provider + model + upstream detail. */
    detail: string;
    /** What the user should do about it. */
    action: string;
    status?: number;
    /** Provider error code/type when one was identifiable. */
    code?: string;
    /** Upstream message verbatim (trimmed), when useful for debugging. */
    providerMessage?: string;
    retryAfterMs?: number;
}

export interface ClassifyInput {
    provider: string;
    model?: string;
    status?: number;
    bodyText?: string;
    retryAfterHeader?: string | null;
    baseUrl?: string;
    /** Replaces the default action (used for bespoke cases like Zen 401). */
    actionOverride?: string;
}

const MAX_BODY_SNIPPET = 300;
const RETRY_MS_DEFAULT = 15_000;

function snippet(text: string): string {
    const collapsed = text.replace(/\s+/g, " ").trim();
    return collapsed.length > MAX_BODY_SNIPPET ? `${collapsed.slice(0, MAX_BODY_SNIPPET)}…` : collapsed;
}

/** Pull {message, code/type} out of OpenAI- or Anthropic-style error bodies. */
export function parseProviderBody(bodyText: string): { message: string; code?: string } {
    const text = (bodyText || "").trim();
    if (!text) return { message: "" };
    try {
        const parsed: unknown = JSON.parse(text);
        // Walk envelope layers: some providers nest the real error one level
        // down ({type:"error",error:{...}}), and a top-level `type` of "error"
        // must never shadow the nested message/code.
        const layers: unknown[] = [parsed];
        let cursor: unknown = parsed;
        for (let i = 0; i < 3; i++) {
            if (cursor && typeof cursor === "object" && "error" in cursor) {
                cursor = (cursor as { error: unknown }).error;
                layers.push(cursor);
            } else {
                break;
            }
        }
        const readField = (obj: unknown, key: string): string | undefined => {
            if (obj && typeof obj === "object") {
                const value = (obj as Record<string, unknown>)[key];
                if (typeof value === "string" && value.trim()) return value.trim();
            }
            return undefined;
        };
        let message = "";
        let code: string | undefined;
        for (const layer of layers) {
            if (!message) {
                message = typeof layer === "string" && layer.trim() ? layer.trim() : (readField(layer, "message") ?? "");
            }
            if (!code) {
                const candidate = readField(layer, "code") ?? readField(layer, "type");
                // A bare envelope marker ("error") carries no information.
                if (candidate && candidate !== "error") code = candidate;
            }
            if (message && code) break;
        }
        if (message || code) return { message, code };
    } catch {
        // Not JSON — treat the raw text as the message below.
    }
    return { message: text };
}

function parseRetryAfterMs(bodyMessage: string, header: string | null | undefined): number | undefined {
    if (header) {
        const secs = Number(header);
        if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000);
        const date = Date.parse(header);
        if (Number.isFinite(date)) return Math.max(1000, date - Date.now());
    }
    const match = bodyMessage.match(/(?:try again in|retry (?:in|after)|retry_after|wait)\s*([\d.]+)\s*s/i);
    if (match) {
        const secs = Number.parseFloat(match[1]);
        if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000) + 500;
    }
    return undefined;
}

export function providerLabel(provider: string): string {
    const labels: Record<string, string> = {
        anthropic: "Anthropic",
        openai: "OpenAI",
        groq: "Groq",
        cerebras: "Cerebras",
        lmstudio: "LM Studio",
        zen: "OpenCode Zen",
        "local-ai": "Your AI app",
    };
    return labels[provider] ?? provider;
}

/** Classify a failed provider call into structured, actionable info. */
export function classifyProviderError(input: ClassifyInput): LlmErrorInfo {
    const provider = input.provider || "unknown";
    const label = providerLabel(provider);
    const model = (input.model || "").trim();
    const modelSuffix = model ? ` · model \`${model}\`` : "";
    const { message: providerMessage, code } = parseProviderBody(input.bodyText ?? "");
    const haystack = `${code ?? ""} ${providerMessage}`.toLowerCase();
    const status = input.status;
    const upstream = providerMessage ? ` (upstream: "${snippet(providerMessage)}")` : "";
    const httpTag = status ? ` [HTTP ${status}]` : "";
    const common = { status, code, providerMessage: providerMessage || undefined };

    const has = (...needles: string[]) => needles.some((n) => haystack.includes(n));

    // ——— Rate limits (429, or explicit limit language at any status) ———
    if (
        status === 429 ||
        has("rate_limit", "rate limit", "rate-limit", "ratelimit", "too many requests", "quota", "resource_exhausted")
    ) {
        const retryAfterMs = parseRetryAfterMs(providerMessage, input.retryAfterHeader) ?? RETRY_MS_DEFAULT;
        const wait = `~${Math.max(1, Math.ceil(retryAfterMs / 1000))}s`;
        return {
            kind: "rate_limited",
            title: `${label} rate limit`,
            detail: `${label} refused the request${modelSuffix} — the account/plan allowance is exhausted${upstream}${httpTag}`,
            action: `Wait ${wait} and retry, or switch to another model.`,
            ...common,
            retryAfterMs,
        };
    }

    // ——— Auth: bad/missing key ———
    if (
        status === 401 ||
        status === 403 ||
        has("invalid_api_key", "invalid api key", "incorrect api key", "authentication_error", "unauthorized", "invalid x-api-key", "bad credentials", "token expired", "expired token")
    ) {
        return {
            kind: "invalid_key",
            title: `${label} rejected the credentials`,
            detail: `${label} refused authentication${modelSuffix}${upstream}${httpTag}`,
            action: input.actionOverride ?? `Check the API key in Settings → Providers for ${label}, then retry.`,
            ...common,
        };
    }

    // ——— Unknown model ———
    if (
        status === 404 ||
        has("model_not_found", "model not found", "does not exist", "no such model", "unknown model", "not a valid model")
    ) {
        return {
            kind: "model_not_found",
            title: `${label} does not know this model`,
            detail: `${label} has no model matching ${model ? `\`${model}\`` : "the requested id"}${upstream}${httpTag}`,
            action: "Pick another model from the model picker — this id may be retired, renamed, or unavailable on your plan.",
            ...common,
        };
    }

    // ——— Context overflow ———
    if (has("context_length_exceeded", "maximum context", "max context", "context window", "too many tokens", "prompt is too long", "input too long", "n_ctx", "context size")) {
        return {
            kind: "context_overflow",
            title: `${label} prompt too long`,
            detail: `The prompt exceeded ${label}'s context window${modelSuffix}${upstream}${httpTag}`,
            action: "Lower Context size in the session config, clear old feed items, or switch to a larger-context model.",
            ...common,
        };
    }

    // ——— Safety filter ———
    if (has("content_filter", "content filtered", "safety", "blocked by", "harmful", "policy violation")) {
        return {
            kind: "content_blocked",
            title: `${label} blocked the content`,
            detail: `${label} refused to process this content${modelSuffix}${upstream}${httpTag}`,
            action: "Rephrase the context or question and retry.",
            ...common,
        };
    }

    // ——— Provider-side outage/overload ———
    if (
        (status !== undefined && status >= 500) ||
        has("overloaded", "overload", "internal server error", "internal error", "server error", "bad gateway", "service unavailable", "gateway timeout", "try again later")
    ) {
        return {
            kind: "provider_unavailable",
            title: `${label} had a server error`,
            detail: `${label} failed while handling the request${modelSuffix} — this is on the provider's side${upstream}${httpTag}`,
            action: "Wait a bit and retry, or switch to another model/provider. If it persists, the provider or model may be down.",
            ...common,
        };
    }

    // ——— Other 4xx ———
    if (status !== undefined && status >= 400) {
        return {
            kind: "bad_request",
            title: `${label} rejected the request`,
            detail: `${label} returned an error${modelSuffix}${upstream}${httpTag}`,
            action: input.actionOverride ?? "Check the model id and settings, then retry. If it persists, try another provider.",
            ...common,
        };
    }

    // ——— No HTTP status: network / timeout / unknown transport failure ———
    if (has("abort", "timeout", "timed out", "deadline")) {
        return {
            kind: "timed_out",
            title: `${label} request timed out`,
            detail: `The request to ${label}${modelSuffix} timed out before a response arrived.`,
            action: "Retry — if it keeps timing out, the provider may be slow or unreachable right now.",
            ...common,
        };
    }
    if (providerMessage || code) {
        const isLmStudio = provider === "lmstudio";
        return {
            kind: "network_unreachable",
            title: `Cannot reach ${label}`,
            detail:
                `PRMPTR could not reach ${label}${modelSuffix}` +
                (providerMessage ? ` (${snippet(providerMessage)})` : "") +
                (input.baseUrl ? ` at ${input.baseUrl}` : ""),
            action: isLmStudio
                ? `Is LM Studio running${input.baseUrl ? ` at ${input.baseUrl}` : ""}? Start it and load a chat model, then retry.`
                : "Check your network connection, VPN, or proxy settings, then retry.",
            ...common,
        };
    }

    return {
        kind: "unknown",
        title: `${label} request failed`,
        detail: `The request to ${label}${modelSuffix} failed without further detail.`,
        action: "Retry — if it persists, try another model or provider.",
        ...common,
    };
}

/**
 * Classify an OriginLM ("Your AI apps") failure. The Rust side rejects with
 * either a `DomainError` display string (`AuthRequired: …`) or a plain
 * message from the client's event stream.
 */
export function classifyLocalAiError(input: { appName?: string; model?: string; message: string }): LlmErrorInfo {
    const app = input.appName?.trim() || "your AI app";
    const title = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
    const raw = (input.message || "").trim();
    const codeMatch = raw.match(/^([A-Z][A-Za-z]+):\s*([\s\S]*)$/);
    const code = codeMatch?.[1];
    const message = (codeMatch ? codeMatch[2] : raw).trim() || raw;
    const modelSuffix = input.model ? ` · model \`${input.model}\`` : "";
    const said = message ? ` (${snippet(message)})` : "";
    const base = { code, providerMessage: message || undefined };
    const lower = raw.toLowerCase();

    if (code === "AuthRequired" || /not (signed|logged) in|sign in|log in|login required|unauthori[sz]ed|auth(entication)? required/.test(lower)) {
        return {
            kind: "auth_subscription",
            title: `${title(app)} needs you to sign in`,
            detail: `${title(app)} is not signed in or its login expired${modelSuffix}${said}.`,
            action: `Sign in to ${app} again (open it and log in), then retry.`,
            ...base,
        };
    }
    if (code === "RateLimited" || /rate.?limit|usage limit|too many requests|quota/.test(lower)) {
        return {
            kind: "rate_limited",
            title: `${title(app)} usage limit`,
            detail: `${title(app)} refused the turn${modelSuffix} — the subscription's usage allowance is exhausted${said}.`,
            action: "Wait for the limit to reset, or pick a model from another app or provider.",
            retryAfterMs: RETRY_MS_DEFAULT,
            ...base,
        };
    }
    if (code === "Timeout" || /did not finish within|timed out|timeout/.test(lower)) {
        return {
            kind: "timed_out",
            title: `${title(app)} took too long`,
            detail: `${title(app)} did not answer in time${modelSuffix}${said}.`,
            action: "Retry — if it keeps happening, check that the app works on its own or pick a faster model.",
            ...base,
        };
    }
    if (code === "RuntimeMissing") {
        return {
            kind: "network_unreachable",
            title: `${title(app)} is not available`,
            detail: `PRMPTR could not start ${app}${said}.`,
            action: `Make sure ${app} is installed and runs from your terminal, then rescan Your AI apps in the model picker.`,
            ...base,
        };
    }
    if (code === "SelectionStale" || code === "NotFound") {
        return {
            kind: "model_not_found",
            title: `${title(app)} no longer offers this model`,
            detail: `The selected model is no longer available${modelSuffix}${said}.`,
            action: "Pick the model again from Your AI apps in the model picker.",
            ...base,
        };
    }
    if (code === "ProviderUnavailable" || /unavailable|overloaded|server error/.test(lower)) {
        return {
            kind: "provider_unavailable",
            title: `${title(app)} is unavailable`,
            detail: `${title(app)} could not handle the request right now${modelSuffix}${said}.`,
            action: "Wait a bit and retry, or switch to another model/provider.",
            ...base,
        };
    }
    return {
        kind: "unknown",
        title: `${title(app)} request failed`,
        detail: `${title(app)} reported an error${modelSuffix}${said}.`,
        action: "Retry — if it persists, try another model or provider.",
        ...base,
    };
}

/** Render structured info as plain text (title / detail / → action). */
export function formatLlmError(info: LlmErrorInfo): string {
    return `${info.title}\n${info.detail}\n→ ${info.action}`;
}

/** Markdown rendition for surfaces that render responses as markdown (overlay). */
export function formatLlmErrorMarkdown(info: LlmErrorInfo): string {
    return `**${info.title}**\n\n${info.detail}\n\n→ ${info.action}`;
}

/** Error type thrown by the provider layer; carries structured info. */
export class LlmRequestError extends Error {
    readonly info: LlmErrorInfo;
    constructor(info: LlmErrorInfo) {
        super(formatLlmError(info));
        this.name = "LlmRequestError";
        this.info = info;
    }
}

/**
 * Thrown for rate limits so callers can back off or fail over to another
 * provider (`instanceof RateLimitError`). Still an `LlmRequestError`, so it
 * renders like any other classified failure when there is nowhere to fail over.
 */
export class RateLimitError extends LlmRequestError {
    readonly retryAfterMs: number;
    constructor(info: LlmErrorInfo) {
        super(info);
        this.name = "RateLimitError";
        this.retryAfterMs = info.retryAfterMs ?? RETRY_MS_DEFAULT;
    }
}

/** Build the right error class for classified info (rate limits fail over). */
export function llmErrorFor(info: LlmErrorInfo): LlmRequestError {
    return info.kind === "rate_limited" ? new RateLimitError(info) : new LlmRequestError(info);
}

/** True for transport-level fetch failures (no HTTP response was received). */
export function isNetworkFailure(error: unknown): boolean {
    if (error instanceof LlmRequestError) return false;
    // The Tauri HTTP plugin rejects with plain strings.
    const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    if (error instanceof Error && error.name === "TypeError") return true;
    return /fetch failed|networkerror|failed to fetch|load failed|error sending request|connection refused|econnrefused|enotfound|enetunreach|econnreset|dns error|socket hang up/i.test(
        message
    );
}

/** True for aborts/timeouts (caller-cancelled or deadline exceeded). */
export function isAbortLike(error: unknown): boolean {
    if (!(error instanceof Error) || error instanceof LlmRequestError) return false;
    return error.name === "AbortError" || error.name === "TimeoutError";
}
