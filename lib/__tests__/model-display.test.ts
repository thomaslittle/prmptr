import { describe, expect, it } from "vitest";
import { modelVersionInfo } from "../model-display";

// Representative zen/opencode-cli catalog slice, mirroring lib/zen-models.ts.
const ZEN_SIBLINGS = [
    "gpt-5.6-sol",
    "gpt-5.4-mini",
    "nemotron-3-ultra-free",
    "nemotron-3.5-lightning-free",
    "muse-spark-1.3-contributor-free",
    "muse-spark-1.2-contributor-free",
    "mimo-v2.5-free",
    "grok-build-0.1",
    "big-pickle",
    "x-preview-f-free",
    "hy3-free",
];

describe("model legacy classification", () => {
    it("keeps muse-spark 1.3 current against unrelated higher-numbered families", () => {
        expect(
            modelVersionInfo("muse-spark-1.3-contributor-free", "zen", ZEN_SIBLINGS).isLegacy
        ).toBe(false);
    });

    it("orders same-family muse-spark releases (1.2 legacy, 1.3 current)", () => {
        expect(
            modelVersionInfo("muse-spark-1.2-contributor-free", "zen", ZEN_SIBLINGS).isLegacy
        ).toBe(true);
    });

    it("orders same-family gpt releases (5.4 legacy, 5.6 current)", () => {
        expect(modelVersionInfo("gpt-5.4-mini", "zen", ZEN_SIBLINGS).isLegacy).toBe(true);
        expect(modelVersionInfo("gpt-5.6-sol", "zen", ZEN_SIBLINGS).isLegacy).toBe(false);
    });

    it("does not mark lone-family or unversioned models legacy", () => {
        expect(modelVersionInfo("grok-build-0.1", "zen", ZEN_SIBLINGS).isLegacy).toBe(false);
        expect(modelVersionInfo("mimo-v2.5-free", "zen", ZEN_SIBLINGS).isLegacy).toBe(false);
        expect(modelVersionInfo("big-pickle", "zen", ZEN_SIBLINGS).isLegacy).toBe(false);
        expect(modelVersionInfo("x-preview-f-free", "zen", ZEN_SIBLINGS).isLegacy).toBe(false);
        expect(modelVersionInfo("hy3-free", "zen", ZEN_SIBLINGS).isLegacy).toBe(false);
    });

    it("keeps cross-family groq models current (llama vs qwen)", () => {
        const siblings = ["llama-3.3-70b-versatile", "qwen-2.5-72b-instruct"];
        expect(modelVersionInfo("llama-3.3-70b-versatile", "groq", siblings).isLegacy).toBe(false);
        expect(modelVersionInfo("qwen-2.5-72b-instruct", "groq", siblings).isLegacy).toBe(false);
    });

    it("still marks older anthropic generations legacy", () => {
        const siblings = ["claude-opus-4-6", "claude-opus-5-1", "claude-sonnet-5-0"];
        expect(modelVersionInfo("claude-opus-4-6", "anthropic", siblings).isLegacy).toBe(true);
        expect(modelVersionInfo("claude-opus-5-1", "anthropic", siblings).isLegacy).toBe(false);
    });
});
