import { afterEach, describe, expect, it, vi } from "vitest";
import {
    LlmRequestError,
    RateLimitError,
    classifyLocalAiError,
    classifyProviderError,
    formatLlmError,
    formatLlmErrorMarkdown,
    isNetworkFailure,
    llmErrorFor,
} from "../llm-errors";
import { streamLLMResponse } from "../llm-providers";
import type { LLMRequest } from "../types";

describe("classifyProviderError", () => {
    it("classifies a 500 envelope as provider-side with the upstream message", () => {
        const info = classifyProviderError({
            provider: "zen",
            model: "big-pickle",
            status: 500,
            bodyText: '{"type":"error","error":{"type":"error","message":"Internal server error"}}',
        });
        expect(info.kind).toBe("provider_unavailable");
        expect(info.status).toBe(500);
        const text = formatLlmError(info);
        expect(text).toContain("big-pickle");
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

    it("classifies invalid keys with a key action and keeps the provider message", () => {
        const info = classifyProviderError({
            provider: "anthropic",
            model: "claude-haiku-5-5",
            status: 401,
            bodyText: JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }),
        });
        expect(info.kind).toBe("invalid_key");
        expect(info.code).toBe("authentication_error");
        expect(info.detail).toContain("invalid x-api-key");
        expect(info.action).toMatch(/API key/i);
        expect(info.action).toContain("Anthropic");
    });

    it("honours a bespoke action override (Zen 401)", () => {
        const info = classifyProviderError({
            provider: "zen",
            model: "gpt-5.6-sol",
            status: 401,
            bodyText: "Invalid API key",
            actionOverride: "custom zen guidance",
        });
        expect(info.kind).toBe("invalid_key");
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
        const info = classifyProviderError({ provider: "cerebras", model: "llama-3.3-70b", bodyText: "request aborted or timed out" });
        expect(info.kind).toBe("timed_out");
    });

    it("renders markdown with the title emphasised", () => {
        const info = classifyProviderError({ provider: "openai", status: 500, bodyText: "boom" });
        expect(formatLlmErrorMarkdown(info)).toMatch(/^\*\*OpenAI had a server error\*\*\n\n/);
    });
});

describe("error classes", () => {
    it("RateLimitError is an LlmRequestError and keeps retryAfterMs", () => {
        const err = llmErrorFor(classifyProviderError({ provider: "groq", status: 429, bodyText: "", retryAfterHeader: "3" }));
        expect(err).toBeInstanceOf(RateLimitError);
        expect(err).toBeInstanceOf(LlmRequestError);
        expect((err as RateLimitError).retryAfterMs).toBe(3000);
    });

    it("non-rate-limit failures are plain LlmRequestErrors", () => {
        const err = llmErrorFor(classifyProviderError({ provider: "openai", status: 500 }));
        expect(err).not.toBeInstanceOf(RateLimitError);
        expect(err).toBeInstanceOf(LlmRequestError);
    });

    it("recognises transport failures from browser fetch and the Tauri HTTP plugin", () => {
        expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
        expect(isNetworkFailure("error sending request for url (https://api.openai.com/v1/chat/completions)")).toBe(true);
        expect(isNetworkFailure(new Error("Missing prompt or model"))).toBe(false);
    });
});

describe("classifyLocalAiError (OriginLM)", () => {
    it("asks the user to sign in to the app again on AuthRequired", () => {
        const info = classifyLocalAiError({ appName: "Claude Code", model: "Claude Haiku 5.5", message: "AuthRequired: credentials expired" });
        expect(info.kind).toBe("auth_subscription");
        expect(info.code).toBe("AuthRequired");
        expect(info.action).toContain("Sign in to Claude Code again");
        expect(info.detail).toContain("credentials expired");
    });

    it("maps the turn timeout to timed_out and keeps the message", () => {
        const info = classifyLocalAiError({ appName: "Codex", message: "The AI client did not finish within 2 minutes" });
        expect(info.kind).toBe("timed_out");
        expect(formatLlmError(info)).toContain("did not finish within 2 minutes");
    });

    it("maps usage limits, stale selections and missing runtimes", () => {
        expect(classifyLocalAiError({ message: "RateLimited: 5-hour limit reached" }).kind).toBe("rate_limited");
        expect(classifyLocalAiError({ message: "SelectionStale: model gone" }).action).toMatch(/Pick the model again/);
        expect(classifyLocalAiError({ appName: "Gemini CLI", message: "RuntimeMissing: gemini not found" }).action).toContain("Gemini CLI");
    });

    it("falls back to a generic failure that still names the app", () => {
        const info = classifyLocalAiError({ appName: "OpenCode", message: "something odd" });
        expect(info.kind).toBe("unknown");
        expect(info.title).toContain("OpenCode");
        expect(info.detail).toContain("something odd");
    });
});

describe("provider wiring", () => {
    const request: LLMRequest = {
        systemPrompt: "s",
        userMessage: "u",
        provider: "openai",
        model: "gpt-6.1-terra",
        apiKey: "sk",
    };

    async function drain(req: LLMRequest): Promise<unknown> {
        try {
            for await (const token of streamLLMResponse(req)) void token;
        } catch (err) {
            return err;
        }
        throw new Error("expected the stream to fail");
    }

    afterEach(() => vi.unstubAllGlobals());

    it("throws a classified LlmRequestError for HTTP failures", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"message":"The server had an error","type":"server_error"}}', { status: 500 })));
        const err = await drain(request);
        expect(err).toBeInstanceOf(LlmRequestError);
        expect(err).not.toBeInstanceOf(RateLimitError);
        expect((err as LlmRequestError).info.kind).toBe("provider_unavailable");
        expect((err as LlmRequestError).message).not.toContain('{"error"');
    });

    it("keeps throwing RateLimitError on 429 so failover still works", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429, headers: { "retry-after": "20" } })));
        const err = await drain({ ...request, provider: "groq", model: "openai/gpt-oss-20b" });
        expect(err).toBeInstanceOf(RateLimitError);
        expect((err as RateLimitError).retryAfterMs).toBe(20_000);
    });

    it("classifies fetch rejections as unreachable", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => {
            throw new TypeError("Failed to fetch");
        }));
        const err = await drain({ ...request, provider: "lmstudio", model: "qwen", baseUrl: "http://localhost:1234/v1" });
        expect(err).toBeInstanceOf(LlmRequestError);
        expect((err as LlmRequestError).info.kind).toBe("network_unreachable");
        expect((err as LlmRequestError).info.action).toMatch(/LM Studio running at http:\/\/localhost:1234\/v1/);
    });

    it("lets caller cancellation through untouched", async () => {
        const controller = new AbortController();
        controller.abort();
        vi.stubGlobal("fetch", vi.fn(async () => {
            throw new DOMException("aborted", "AbortError");
        }));
        const err = await drain({ ...request, signal: controller.signal });
        expect(err).not.toBeInstanceOf(LlmRequestError);
        expect((err as Error).name).toBe("AbortError");
    });
});
