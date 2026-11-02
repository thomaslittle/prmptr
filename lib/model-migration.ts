import type { LLMProvider } from "./types";

/** Default model per provider for fresh selections and migrations. */
export const DEFAULT_MODEL_BY_PROVIDER: Record<LLMProvider, string> = {
    lmstudio: "lmstudio-auto",
    anthropic: "claude-haiku-5-5",
    openai: "gpt-6.1-terra",
    groq: "openai/gpt-oss-20b",
    cerebras: "gpt-oss-120b",
    zen: "",
    // OriginLM model ids are per-install; the user must pick one.
    "local-ai": "",
};

/**
 * Model IDs earlier PRMPTR versions shipped as defaults that providers have
 * since retired (or that were never valid). A saved selection matching one of
 * these is moved to the provider's current default instead of failing.
 */
const RETIRED: Partial<Record<LLMProvider, RegExp>> = {
    anthropic: /^claude-(2|3|instant)|^claude-(opus|sonnet|haiku)-4-[0-5](-|$)|^claude-opus-4-5-20250918$/,
    openai: /^(gpt-3\.5|gpt-4($|-|o|\.1)|o1-|o3-mini)/,
    groq: /^(llama-3\.1-8b-instant|llama-3\.3-70b-versatile|llama-4-scout|compound-beta)/,
    cerebras: /^(llama-3\.1-8b|llama3\.1-8b|qwen-3-235b)/,
};

/** CLI-subscription providers replaced by "Your AI apps" (OriginLM). */
const LEGACY_CLI_PROVIDERS = new Set(["codex-cli", "opencode-cli"]);

export interface ModelSelection {
    provider: LLMProvider;
    model: string;
}

/** Map a persisted (provider, model) pair onto something that still works. */
export function migrateModelSelection(provider: string, model: string): ModelSelection {
    // Claude Code subscriptions were removed (Anthropic terms); use the API.
    if (provider === "claude-cli") {
        return { provider: "anthropic", model: DEFAULT_MODEL_BY_PROVIDER.anthropic };
    }
    // Codex / OpenCode token reuse was replaced by OriginLM, whose model ids
    // differ; keep the user on the same family of provider but make them pick.
    if (LEGACY_CLI_PROVIDERS.has(provider)) {
        return { provider: "local-ai", model: "" };
    }
    const p = provider as LLMProvider;
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_MODEL_BY_PROVIDER, p)) {
        return { provider: "lmstudio", model: DEFAULT_MODEL_BY_PROVIDER.lmstudio };
    }
    const retired = RETIRED[p];
    if (retired && retired.test(model)) {
        return { provider: p, model: DEFAULT_MODEL_BY_PROVIDER[p] };
    }
    return { provider: p, model };
}

/**
 * Migrate a whole persisted session config (localStorage or a saved session
 * in IndexedDB): fixes the model selection and drops fields that no longer
 * apply to it.
 */
export function migrateSessionConfig<T extends { provider: string; model: string; localAi?: unknown }>(
    config: T
): T & ModelSelection {
    const { provider, model } = migrateModelSelection(config.provider, config.model);
    const next = { ...config, provider, model } as T & ModelSelection & { subProvider?: unknown };
    // `subProvider` belonged to the removed OpenCode CLI provider.
    delete next.subProvider;
    // A local-ai route only makes sense alongside its model id.
    if (provider !== "local-ai" || provider !== config.provider || !model) delete next.localAi;
    return next;
}
