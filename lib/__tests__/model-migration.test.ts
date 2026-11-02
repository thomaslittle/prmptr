import { describe, it, expect } from "vitest";
import { DEFAULT_MODEL_BY_PROVIDER, migrateModelSelection, migrateSessionConfig } from "../model-migration";

describe("migrateModelSelection", () => {
    it("maps removed Claude Code subscriptions to the Anthropic API default", () => {
        expect(migrateModelSelection("claude-cli", "claude-sonnet-4-5")).toEqual({
            provider: "anthropic",
            model: DEFAULT_MODEL_BY_PROVIDER.anthropic,
        });
    });

    it("moves Codex and OpenCode CLI selections to Your AI apps with no model", () => {
        expect(migrateModelSelection("codex-cli", "gpt-6.1-terra")).toEqual({ provider: "local-ai", model: "" });
        expect(migrateModelSelection("opencode-cli", "big-pickle")).toEqual({ provider: "local-ai", model: "" });
    });

    it("moves retired model ids to the provider's current default", () => {
        expect(migrateModelSelection("anthropic", "claude-3-5-sonnet-20241022")).toEqual({
            provider: "anthropic",
            model: DEFAULT_MODEL_BY_PROVIDER.anthropic,
        });
        expect(migrateModelSelection("openai", "gpt-4o-mini")).toEqual({
            provider: "openai",
            model: DEFAULT_MODEL_BY_PROVIDER.openai,
        });
        expect(migrateModelSelection("groq", "llama-3.3-70b-versatile")).toEqual({
            provider: "groq",
            model: DEFAULT_MODEL_BY_PROVIDER.groq,
        });
        expect(migrateModelSelection("cerebras", "llama3.1-8b")).toEqual({
            provider: "cerebras",
            model: DEFAULT_MODEL_BY_PROVIDER.cerebras,
        });
    });

    it("keeps current selections untouched", () => {
        expect(migrateModelSelection("anthropic", "claude-opus-5-5")).toEqual({ provider: "anthropic", model: "claude-opus-5-5" });
        expect(migrateModelSelection("local-ai", "m-haiku")).toEqual({ provider: "local-ai", model: "m-haiku" });
    });

    it("falls back to LM Studio for unknown providers, including prototype keys", () => {
        const lmstudio = { provider: "lmstudio", model: DEFAULT_MODEL_BY_PROVIDER.lmstudio };
        expect(migrateModelSelection("made-up", "x")).toEqual(lmstudio);
        expect(migrateModelSelection("toString", "x")).toEqual(lmstudio);
    });
});

describe("migrateSessionConfig", () => {
    const route = { routeId: "r-claude", revision: "1", nativeId: "claude-haiku-5-5", providerName: "Claude Code" };

    it("drops the legacy subProvider and keeps a valid local-ai route", () => {
        const migrated = migrateSessionConfig({ provider: "local-ai", model: "m-haiku", localAi: route, subProvider: "x" });
        expect(migrated).toEqual({ provider: "local-ai", model: "m-haiku", localAi: route });
    });

    it("clears the route when a legacy CLI provider is migrated", () => {
        const migrated = migrateSessionConfig({ provider: "opencode-cli", model: "big-pickle", subProvider: "opencode-go" });
        expect(migrated).toEqual({ provider: "local-ai", model: "" });
    });

    it("drops a stray route on non-local-ai providers", () => {
        const migrated = migrateSessionConfig({ provider: "anthropic", model: "claude-opus-5-5", localAi: route });
        expect(migrated).toEqual({ provider: "anthropic", model: "claude-opus-5-5" });
    });
});
