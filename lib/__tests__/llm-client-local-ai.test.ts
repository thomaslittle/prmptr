import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalAiCompleteParams } from "../tauri";

const tauri = vi.hoisted(() => ({
    localAiComplete: vi.fn<(params: LocalAiCompleteParams, onDelta: (text: string) => void) => Promise<string>>(),
    localAiCancel: vi.fn<(requestId: string) => Promise<void>>(),
    listLocalAiModels: vi.fn(async () => []),
}));

vi.mock("../tauri", () => tauri);

import { LlmRequestError, providerNeedsApiKey, streamCompletion, streamCompletionOnce, type LlmCall } from "../llm-client";

const route = {
    routeId: "r-claude",
    revision: "1",
    nativeId: "claude-haiku-5-5",
    providerName: "Claude Code",
    name: "Claude Haiku 5.5",
    supportsImageInput: true,
};

function call(overrides: Partial<LlmCall> = {}): LlmCall {
    return {
        systemPrompt: "You are a copilot.",
        userMessage: "What should I say?",
        provider: "local-ai",
        model: "m-haiku",
        localAi: route,
        ...overrides,
    };
}

beforeEach(() => {
    tauri.localAiComplete.mockReset();
    tauri.localAiCancel.mockReset().mockResolvedValue(undefined);
});

describe("local-ai provider", () => {
    it("needs no API key", () => {
        expect(providerNeedsApiKey("local-ai")).toBe(false);
    });

    it("sends one combined prompt with the route selection and streams accumulated deltas", async () => {
        tauri.localAiComplete.mockImplementation(async (_params, onDelta) => {
            onDelta("Hello");
            onDelta(", world");
            return "Hello, world";
        });
        const tokens: string[] = [];
        const text = await streamCompletionOnce(call(), (t) => tokens.push(t));

        expect(text).toBe("Hello, world");
        expect(tokens).toEqual(["Hello", "Hello, world"]);
        const [params] = tauri.localAiComplete.mock.calls[0];
        expect(params.selection).toEqual({ routeId: "r-claude", modelId: "m-haiku", revision: "1" });
        expect(params.prompt).toBe("You are a copilot.\n\n---\n\nWhat should I say?");
        expect(params.requestId).toMatch(/\S/);
        expect(params.imageDataUrl).toBeNull();
    });

    it("uses a fresh request id per call", async () => {
        tauri.localAiComplete.mockResolvedValue("ok");
        await streamCompletionOnce(call(), () => {});
        await streamCompletionOnce(call(), () => {});
        const [a, b] = tauri.localAiComplete.mock.calls.map(([p]) => p.requestId);
        expect(a).not.toBe(b);
    });

    it("attaches the screenshot only when the model supports image input", async () => {
        tauri.localAiComplete.mockResolvedValue("ok");
        const image = "data:image/png;base64,AAAA";
        await streamCompletionOnce(call({ imageDataUrl: image }), () => {});
        await streamCompletionOnce(
            call({ imageDataUrl: image, localAi: { ...route, supportsImageInput: false } }),
            () => {}
        );
        expect(tauri.localAiComplete.mock.calls[0][0].imageDataUrl).toBe(image);
        expect(tauri.localAiComplete.mock.calls[1][0].imageDataUrl).toBeNull();
    });

    it("cancels the backend turn on abort and rejects with an AbortError", async () => {
        let rejectTurn: (err: unknown) => void = () => {};
        tauri.localAiComplete.mockImplementation(
            (_params, onDelta) =>
                new Promise((_resolve, reject) => {
                    onDelta("partial");
                    rejectTurn = reject;
                })
        );
        const controller = new AbortController();
        const pending = streamCompletion(call(), () => {}, controller.signal);
        await Promise.resolve();
        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
        const requestId = tauri.localAiComplete.mock.calls[0][0].requestId;
        expect(tauri.localAiCancel).toHaveBeenCalledWith(requestId);
        // The backend's late "Cancelled" rejection must not surface anywhere.
        rejectTurn("Cancelled");
    });

    it("maps a backend 'Cancelled' error to an AbortError", async () => {
        tauri.localAiComplete.mockRejectedValue("Cancelled");
        await expect(streamCompletionOnce(call(), () => {})).rejects.toMatchObject({ name: "AbortError" });
    });

    it("surfaces other backend errors as plain errors", async () => {
        tauri.localAiComplete.mockRejectedValue("The AI client did not finish within 2 minutes");
        await expect(streamCompletionOnce(call(), () => {})).rejects.toThrow("did not finish within 2 minutes");
    });

    it("classifies backend errors so the analyzer can say what to do", async () => {
        tauri.localAiComplete.mockRejectedValue("AuthRequired: login expired");
        const err = await streamCompletionOnce(call(), () => {}).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(LlmRequestError);
        expect((err as LlmRequestError).info.kind).toBe("auth_subscription");
        expect((err as LlmRequestError).info.action).toContain("Sign in to Claude Code again");
    });

    it("requires a picked model and route", async () => {
        await expect(streamCompletionOnce(call({ model: "" }), () => {})).rejects.toThrow(/Your AI apps/);
        await expect(streamCompletionOnce(call({ localAi: undefined }), () => {})).rejects.toThrow(/Your AI apps/);
        expect(tauri.localAiComplete).not.toHaveBeenCalled();
    });

    it("does not start a turn when already aborted", async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(streamCompletionOnce(call(), () => {}, controller.signal)).rejects.toMatchObject({
            name: "AbortError",
        });
        expect(tauri.localAiComplete).not.toHaveBeenCalled();
    });
});
