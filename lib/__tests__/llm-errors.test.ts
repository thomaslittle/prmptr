import { describe, expect, it } from "vitest";
import {
    LlmRequestError,
    classifyProviderError,
    formatLlmError,
    toLlmErrorInfo,
} from "../llm-errors";

describe("LLM error classification", () => {
    it("classifies the exact 500 envelope the analyzer used to dump raw", () => {
        const info = classifyProviderError({
            provider: "opencode-cli",
            model: "muse-spark-1.3-contributor-free",
            status: 500,
            bodyText: '{"type":"error","error":{"type":"error","message":"Internal server error"}}',
        });
        expect(info.kind).toBe("provider_unavailable");
        expect(info.status).toBe(500);
        const text = formatLlmError(info);
        expect(text).toContain("muse-spark-1.3-contributor-free");
        expect(text).toContain("Internal server error");
        expect(text).toMatch(/→ /);
        expect(new LlmRequestError(info).message).toBe(text);
    });

    it("classifies OpenAI-style rate limits with retry-after", () => {
        const info = classifyProviderError({
            provider: "groq",
            model: "llama-3.3-70b-versatile",
            status: 429,
            bodyText: '{"error":{"message":"Rate limit reached, try again in 20s","type":"rate_limit_exceeded","code":"rate_limit_exceeded"}}',
            retryAfterHeader: "20",
        });
        expect(info.kind).toBe("rate_limited");
        expect(info.retryAfterMs).toBe(20_000);
        expect(info.code).toBe("rate_limit_exceeded");
        expect(formatLlmError(info)).toContain("llama-3.3-70b-versatile");
    });

    it("detects rate limits from body language without a 429", () => {
        const info = classifyProviderError({
            provider: "cerebras",
            model: "llama-3.3-70b",
            status: 500,
            bodyText: "upstream quota exceeded for this model",
        });
        expect(info.kind).toBe("rate_limited");
    });

    it("classifies invalid keys with a key action", () => {
        const info = classifyProviderError({
            provider: "groq",
            model: "llama-3.3-70b-versatile",
            status: 401,
            bodyText: '{"error":{"message":"Invalid API Key","type":"invalid_request_error","code":"invalid_api_key"}}',
        });
        expect(info.kind).toBe("invalid_key");
        expect(info.code).toBe("invalid_api_key");
        expect(info.action).toMatch(/API key/i);
    });

    it("keeps the bespoke Zen 401 guidance", () => {
        const info = classifyProviderError({
            provider: "zen",
            model: "gpt-5.6-sol",
            status: 401,
            bodyText: "Invalid API key",
            actionOverride: "custom zen guidance",
        });
        expect(info.kind).toBe("auth_subscription");
        expect(info.action).toBe("custom zen guidance");
    });

    it("classifies unknown models and names the id", () => {
        const info = classifyProviderError({
            provider: "openai",
            model: "gpt-9-ultra",
            status: 404,
            bodyText: '{"error":{"message":"The model `gpt-9-ultra` does not exist","type":"invalid_request_error","code":"model_not_found"}}',
        });
        expect(info.kind).toBe("model_not_found");
        expect(info.detail).toContain("gpt-9-ultra");
    });

    it("classifies context overflow with a context-size action", () => {
        const info = classifyProviderError({
            provider: "groq",
            model: "llama-3.3-70b-versatile",
            status: 400,
            bodyText: '{"error":{"message":"Request too large for model context_length_exceeded","code":"context_length_exceeded"}}',
        });
        expect(info.kind).toBe("context_overflow");
        expect(info.action).toMatch(/Context size/i);
    });

    it("classifies Anthropic-style overloads as provider-side", () => {
        const info = classifyProviderError({
            provider: "anthropic",
            model: "claude-opus-4-6",
            status: 529,
            bodyText: '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
        });
        expect(info.kind).toBe("provider_unavailable");
        expect(info.code).toBe("overloaded_error");
    });

    it("classifies connection failures, with an LM Studio hint", () => {
        const info = classifyProviderError({
            provider: "lmstudio",
            model: "lmstudio-auto",
            bodyText: "TypeError: fetch failed",
            baseUrl: "http://localhost:1234/v1",
        });
        expect(info.kind).toBe("network_unreachable");
        expect(info.action).toMatch(/LM Studio running/);
    });

    it("classifies aborts as timeouts", () => {
        const info = classifyProviderError({
            provider: "cerebras",
            model: "llama-3.3-70b",
            bodyText: "request aborted or timed out",
        });
        expect(info.kind).toBe("timed_out");
    });

    it("rebuilds structured info from SSE payloads and rejects junk", () => {
        const info = classifyProviderError({
            provider: "groq",
            model: "llama-3.3-70b-versatile",
            status: 500,
            bodyText: "Internal server error",
        });
        const rebuilt = toLlmErrorInfo({
            type: "error",
            message: formatLlmError(info),
            kind: info.kind,
            title: info.title,
            detail: info.detail,
            action: info.action,
            status: info.status,
            providerMessage: info.providerMessage,
        });
        expect(rebuilt).toEqual(info);
        expect(toLlmErrorInfo({ type: "error", message: "x" })).toBeNull();
        expect(toLlmErrorInfo({ kind: "nope", title: "t", detail: "d", action: "a" })).toBeNull();
        expect(toLlmErrorInfo(null)).toBeNull();
    });
});
