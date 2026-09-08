/**
 * Structured LLM failure reporting.
 *
 * Provider errors arrive in many shapes (OpenAI `{error:{message,code,type}}`,
 * Anthropic `{type:"error",error:{...}}`, plain text, empty bodies, connection
 * failures) but the analyzer must always tell the user *what happened, where,
 * and what to do* — never a bare `API error 500: {...}` dump.
 *
 * Flow: `lib/llm-providers.ts` throws `LlmRequestError` (via
 * `throwClassifiedProviderError`) → `app/api/llm/route.ts` forwards the
 * structured fields over SSE → `components/ai-response.tsx` renders the
 * formatted detail.
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

function snippet(text: string): string {
    const collapsed = text.replace(/\s+/g, " ").trim();
    return collapsed.length > MAX_BODY_SNIPPET
        ? `${collapsed.slice(0, MAX_BODY_SNIPPET)}…`
        : collapsed;
}

/** Pull {message, code/type} out of OpenAI- or Anthropic-style error bodies. */
function parseProviderBody(bodyText: string): { message: string; code?: string } {
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
                message =
                    typeof layer === "string" && layer.trim()
                        ? layer.trim()
                        : (readField(layer, "message") ?? "");
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
        const secs = Number.parseFloat(header);
        if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000);
    }
    const match = bodyMessage.match(/(?:try again in|retry (?:in|after)|retry_after|wait)\s*([\d.]+)\s*s/i);
    if (match) {
        const secs = Number.parseFloat(match[1]);
        if (Number.isFinite(secs) && secs >= 0) return Math.ceil(secs * 1000) + 500;
    }
    return undefined;
}

function providerLabel(provider: string): string {
    const labels: Record<string, string> = {
        anthropic: "Anthropic",
        openai: "OpenAI",
        groq: "Groq",
        cerebras: "Cerebras",
        lmstudio: "LM Studio",
        zen: "OpenCode Zen",
        "opencode-cli": "OpenCode",
        "claude-cli": "Claude Code subscription",
        "codex-cli": "Codex subscription",
    };
    return labels[provider] ?? provider;
}

const RETRY_MS_DEFAULT = 15_000;

/** Classify a failed provider call into structured, actionable info. */
export function classifyProviderError(input: ClassifyInput): LlmErrorInfo {
    const provider = input.provider || "unknown";
    const label = providerLabel(provider);
    const model = (input.model || "").trim();
    const modelSuffix = model ? ` · model \`${model}\`` : "";
    const { message: providerMessage, code } = parseProviderBody(input.bodyText ?? "");
    const haystack = `${code ?? ""} ${providerMessage}`.toLowerCase();
    const status = input.status;

    const has = (...needles: string[]) => needles.some((n) => haystack.includes(n));

    // ——— Rate limits (429, or explicit limit language at any status) ———
    if (
        status === 429 ||
        has("rate_limit", "rate limit", "rate-limit", "ratelimit", "too many requests", "quota", "resource_exhausted", "capacity")
    ) {
        const retryAfterMs = parseRetryAfterMs(providerMessage, input.retryAfterHeader) ?? RETRY_MS_DEFAULT;
        const wait = `~${Math.max(1, Math.ceil(retryAfterMs / 1000))}s`;
        return {
            kind: "rate_limited",
            title: `${label} rate limit`,
            detail:
                `${label} refused the request${modelSuffix} — the account/plan allowance is exhausted` +
                (providerMessage ? ` (upstream: "${snippet(providerMessage)}")` : "") +
                (status ? ` [HTTP ${status}]` : ""),
            action:
                `Wait ${wait} — PRMPTR retries automatically, or switch to another model. ` +
                `Free tiers (e.g. Muse Spark Free) allow only a few requests per minute.`,
            status,
            code,
            providerMessage: providerMessage || undefined,
            retryAfterMs,
        };
    }

    // ——— Auth: bad/missing key ———
    if (
        status === 401 ||
        status === 403 ||
        has("invalid_api_key", "invalid api key", "incorrect api key", "authentication_error", "unauthorized", "invalid x-api-key", "bad credentials", "token expired", "expired token")
    ) {
        const isZenFamily = provider === "zen" || provider === "opencode-cli";
        return {
            kind: isZenFamily && status === 401 ? "auth_subscription" : "invalid_key",
            title: `${label} rejected the credentials`,
            detail:
                `${label} refused authentication${modelSuffix}` +
                (providerMessage ? ` (upstream: "${snippet(providerMessage)}")` : "") +
                (status ? ` [HTTP ${status}]` : ""),
            action:
                input.actionOverride ??
                (isZenFamily
                    ? 'Your saved Zen key looks stale — models under the "OpenCode" group use your CLI login instead; otherwise re-run `opencode auth login` or paste a fresh key from console.opencode.ai.'
                    : `Check the API key in Settings → Providers for ${label}, then retry.`),
            status,
            code,
            providerMessage: providerMessage || undefined,
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
            detail:
                `${label} has no model matching ${model ? `\`${model}\`` : "the requested id"}` +
                (providerMessage ? ` (upstream: "${snippet(providerMessage)}")` : "") +
                (status ? ` [HTTP ${status}]` : ""),
            action:
                "Pick another model from the model picker — this id may be retired, renamed, or unavailable on your plan.",
            status,
            code,
            providerMessage: providerMessage || undefined,
        };
    }

    // ——— Context overflow ———
    if (has("context_length_exceeded", "maximum context", "max context", "context window", "too many tokens", "prompt is too long", "input too long", "n_ctx", "context size")) {
        return {
            kind: "context_overflow",
            title: `${label} prompt too long`,
            detail:
                `The prompt exceeded ${label}'s context window${modelSuffix}` +
                (providerMessage ? ` (upstream: "${snippet(providerMessage)}")` : "") +
                (status ? ` [HTTP ${status}]` : ""),
            action:
                "Lower Context size in the session config, clear old feed items, or switch to a larger-context model.",
            status,
            code,
            providerMessage: providerMessage || undefined,
        };
    }

    // ——— Safety filter ———
    if (has("content_filter", "content filtered", "safety", "blocked by", "harmful", "policy violation")) {
        return {
            kind: "content_blocked",
            title: `${label} blocked the content`,
            detail:
                `${label} refused to process this content${modelSuffix}` +
                (providerMessage ? ` (upstream: "${snippet(providerMessage)}")` : "") +
                (status ? ` [HTTP ${status}]` : ""),
            action: "Rephrase the context or question and retry.",
            status,
            code,
            providerMessage: providerMessage || undefined,
        };
    }

    // ——— Provider-side outage/overload ———
    if (
        (status !== undefined && status >= 500) ||
        has("overloaded", "overload", "internal server error", "internal error", "server error", "bad gateway", "service unavailable", "gateway timeout", "try again later")
    ) {
        return {
            kind: "provider_unavailable",
            title: `${label} failed internally`,
            detail:
                `${label} failed while handling the request${modelSuffix} — this is provider-side, not a PRMPTR bug` +
                (providerMessage ? ` (upstream: "${snippet(providerMessage)}")` : "") +
                (status ? ` [HTTP ${status}]` : ""),
            action:
                "Wait a bit and retry, or switch to another model/provider. If it persists for hours, the provider or model may be down.",
            status,
            code,
            providerMessage: providerMessage || undefined,
        };
    }

    // ——— Other 4xx ———
    if (status !== undefined && status >= 400) {
        return {
            kind: "bad_request",
            title: `${label} rejected the request`,
            detail:
                `${label} returned an error${modelSuffix}` +
                (providerMessage ? ` (upstream: "${snippet(providerMessage)}")` : "") +
                ` [HTTP ${status}]`,
            action:
                input.actionOverride ??
                "Check the model id and settings, then retry. If it persists, try another provider.",
            status,
            code,
            providerMessage: providerMessage || undefined,
        };
    }

    // ——— No HTTP status: network / timeout / unknown transport failure ———
    if (has("abort", "aborted", "timeout", "timed out", "exceeded.*deadline")) {
        return {
            kind: "timed_out",
            title: `${label} request timed out`,
            detail: `The request to ${label}${modelSuffix} timed out before a response arrived.`,
            action: "Retry — if it keeps timing out, the provider may be slow or unreachable right now.",
            code,
            providerMessage: providerMessage || undefined,
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
            code,
            providerMessage: providerMessage || undefined,
        };
    }

    return {
        kind: "unknown",
        title: `${label} request failed`,
        detail: `The request to ${label}${modelSuffix} failed without further detail.`,
        action: "Retry — if it persists, try another model or provider.",
        status,
        code,
        providerMessage: providerMessage || undefined,
    };
}

/** Render structured info as the multi-part message shown in the analyzer. */
export function formatLlmError(info: LlmErrorInfo): string {
    return `${info.title}\n${info.detail}\n→ ${info.action}`;
}

const KNOWN_KINDS: ReadonlySet<string> = new Set([
    "rate_limited",
    "invalid_key",
    "model_not_found",
    "bad_request",
    "context_overflow",
    "content_blocked",
    "provider_unavailable",
    "network_unreachable",
    "timed_out",
    "auth_subscription",
    "unknown",
]);

/**
 * Rebuild structured info from an SSE `error` event payload. Returns null
 * unless the payload carries a recognized kind, so callers can fall back to
 * local classification of the message text.
 */
export function toLlmErrorInfo(data: unknown): LlmErrorInfo | null {
    if (!data || typeof data !== "object") return null;
    const record = data as Record<string, unknown>;
    if (typeof record.kind !== "string" || !KNOWN_KINDS.has(record.kind)) return null;
    if (typeof record.title !== "string" || typeof record.detail !== "string" || typeof record.action !== "string") {
        return null;
    }
    const info: LlmErrorInfo = {
        kind: record.kind as LlmErrorKind,
        title: record.title,
        detail: record.detail,
        action: record.action,
    };
    if (typeof record.code === "string") info.code = record.code;
    if (typeof record.status === "number") info.status = record.status;
    if (typeof record.retryAfterMs === "number") info.retryAfterMs = record.retryAfterMs;
    if (typeof record.providerMessage === "string") info.providerMessage = record.providerMessage;
    return info;
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
 * Throw a classified `LlmRequestError` for a failed HTTP provider call.
 * Drop-in replacement for `throw new Error(\`API error ${status}: ...\`)`.
 */
export function throwClassifiedProviderError(input: ClassifyInput): never {
    throw new LlmRequestError(classifyProviderError(input));
}

/** True for transport-level fetch failures (no HTTP response was received). */
export function isNetworkFailure(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    if (error instanceof LlmRequestError) return false;
    return (
        error.name === "TypeError" ||
        /fetch failed|networkerror|failed to fetch|econnrefused|enotfound|enetunreach|econnreset|socket hang up/i.test(
            error.message
        )
    );
}

/** True for aborts/timeouts (caller-cancelled or deadline exceeded). */
export function isAbortLike(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    if (error instanceof LlmRequestError) return false;
    return (
        error.name === "AbortError" ||
        error.name === "TimeoutError" ||
        /aborted|timeout|timed out/i.test(error.message)
    );
}
