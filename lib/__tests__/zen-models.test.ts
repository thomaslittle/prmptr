import { describe, it, expect } from "vitest";
import { zenModelDisplayName, isFreeZenModel } from "../zen-models";

describe("zenModelDisplayName", () => {
    it("uses curated names for stealth/free models", () => {
        expect(zenModelDisplayName("x-preview-f-free")).toBe("Ox Alpha Free");
        expect(zenModelDisplayName("big-pickle")).toBe("Big Pickle");
    });

    it("prettifies known families correctly", () => {
        expect(zenModelDisplayName("gpt-5.6-sol")).toBe("GPT 5.6 Sol");
        expect(zenModelDisplayName("glm-5.2")).toBe("GLM 5.2");
        expect(zenModelDisplayName("deepseek-v4-pro")).toBe("DeepSeek V4 Pro");
        expect(zenModelDisplayName("minimax-m3")).toBe("MiniMax M3");
        expect(zenModelDisplayName("kimi-k3")).toBe("Kimi K3");
        expect(zenModelDisplayName("qwen3.7-max")).toBe("Qwen3.7 Max");
        expect(zenModelDisplayName("claude-opus-5")).toBe("Claude Opus 5");
        expect(zenModelDisplayName("mimo-v2.5-free")).toBe("MiMo-V2.5 Free");
    });
});

describe("isFreeZenModel", () => {
    it("flags free-tier models", () => {
        expect(isFreeZenModel("x-preview-f-free")).toBe(true);
        expect(isFreeZenModel("big-pickle")).toBe(true);
        expect(isFreeZenModel("nemotron-3-ultra-free")).toBe(true);
    });

    it("does not flag paid models", () => {
        expect(isFreeZenModel("gpt-5.6-sol")).toBe(false);
        expect(isFreeZenModel("claude-opus-5")).toBe(false);
        expect(isFreeZenModel("kimi-k3")).toBe(false);
    });
});
