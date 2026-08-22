// Client-safe constants/types for local AI CLI subscription integration.
//
// prmptr can reuse the subscriptions users already have authenticated on
// their machine via coding CLIs (same detection approach as t3code):
//   - Claude Code (`claude` CLI, `claude auth login`)
//   - Codex CLI (`codex` CLI, `codex login` — ChatGPT subscription)
//   - OpenCode (`opencode` CLI, `opencode auth login`)
//
// Credentials are never copied into prmptr storage; the loopback API routes
// read them from each tool's own config files at call time (see
// lib/cli-providers-server.ts, which must stay server-only).

import { LLMProvider } from "./types";

export type CliSubscriptionId = "claude-cli" | "codex-cli" | "opencode-cli";

export const CLI_SUBSCRIPTION_IDS: CliSubscriptionId[] = [
    "claude-cli",
    "codex-cli",
    "opencode-cli",
];

export interface CliSubscriptionMeta {
    id: CliSubscriptionId;
    name: string;
    loginHint: string;
}

export const CLI_SUBSCRIPTIONS: CliSubscriptionMeta[] = [
    {
        id: "claude-cli",
        name: "Claude Code",
        loginHint: "Install Claude Code, then run: claude auth login",
    },
    {
        id: "codex-cli",
        name: "Codex (ChatGPT)",
        loginHint: "Install Codex CLI, then run: codex login",
    },
    {
        id: "opencode-cli",
        name: "OpenCode",
        loginHint: "Install OpenCode, then run: opencode auth login",
    },
];

/** Static catalog used when the ChatGPT backend model list is unavailable. */
export const CODEX_CLI_MODELS: Array<{ id: string; name: string; supportsImageInput: boolean }> = [
    { id: "gpt-5-codex", name: "GPT-5-Codex", supportsImageInput: true },
    { id: "gpt-5", name: "GPT-5", supportsImageInput: true },
    { id: "gpt-5-mini", name: "GPT-5 Mini", supportsImageInput: true },
];

export interface CliSubscriptionStatus {
    id: CliSubscriptionId;
    name: string;
    /** Config/auth artifacts for the CLI were found on this machine. */
    detected: boolean;
    /** A usable subscription credential is present. */
    loggedIn: boolean;
    /** Email / account identifier shown in settings. */
    account?: string;
    /** Extra guidance when detected but unusable. */
    hint?: string;
}

export function isCliSubscriptionProvider(provider: LLMProvider): provider is CliSubscriptionId {
    return (CLI_SUBSCRIPTION_IDS as string[]).includes(provider);
}

export function cliSubscriptionMeta(id: CliSubscriptionId): CliSubscriptionMeta | undefined {
    return CLI_SUBSCRIPTIONS.find((meta) => meta.id === id);
}
