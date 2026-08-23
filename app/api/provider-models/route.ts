import { NextRequest } from "next/server";
import { rejectUntrustedRequest, localHttpBaseUrl } from "@/lib/api-guard";
import { CODEX_CLI_MODELS, CliSubscriptionId } from "@/lib/cli-providers";
import { resolveCliCredential } from "@/lib/cli-providers-server";
import { fetchCodexLiveModels } from "@/lib/codex-app-server";
import { fetchOpencodeCliModels } from "@/lib/opencode-cli";

export const dynamic = "force-dynamic";

type Provider = "anthropic" | "openai" | "groq" | "cerebras" | "lmstudio" | "zen" | CliSubscriptionId;

type ProviderModel = {
    id: string;
    name?: string;
    subProvider?: string;
    supportsImageInput?: boolean;
};

function filterChatModels(models: ProviderModel[]): ProviderModel[] {
    return models.filter((m) => !/(embed|embedding|rerank|bge|nomic-embed|whisper|tts)/i.test(m.id));
}

function normalizeModelCapability(raw: unknown): boolean | undefined {
    const obj = raw as Record<string, unknown> | undefined;
    if (!obj || typeof obj !== "object") return undefined;

    const direct = obj.supports_image_input;
    if (typeof direct === "boolean") return direct;

    const gatherArrays = (value: unknown): string[] => {
        if (!Array.isArray(value)) return [];
        return value
            .map((v) => (typeof v === "string" ? v.toLowerCase() : ""))
            .filter((v): v is string => !!v);
    };

    const candidates: unknown[] = [
        obj.modalities,
        obj.input_modalities,
        (obj.capabilities as Record<string, unknown> | undefined)?.modalities,
        (obj.capabilities as Record<string, unknown> | undefined)?.input_modalities,
        (obj.architecture as Record<string, unknown> | undefined)?.input_modalities,
    ];

    for (const candidate of candidates) {
        const vals = gatherArrays(candidate);
        if (vals.length === 0) continue;
        if (vals.includes("image") || vals.includes("vision")) return true;
        if (vals.includes("text") && vals.length === 1) return false;
    }

    return undefined;
}

async function fetchOpenAiCompatibleModels(baseUrl: string, apiKey?: string): Promise<ProviderModel[]> {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const resp = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { data?: Array<Record<string, unknown>> };
    return filterChatModels(
        (data?.data ?? [])
            .map((m) => {
                const id = typeof m?.id === "string" ? m.id : "";
                if (!id) return null;
                const supportsImageInput = normalizeModelCapability(m);
                return supportsImageInput === undefined
                    ? { id }
                    : { id, supportsImageInput };
            })
            .filter((m): m is ProviderModel => !!m)
    );
}

async function fetchAnthropicModels(apiKey: string, opts?: { bearer?: boolean }): Promise<ProviderModel[]> {
    const headers: Record<string, string> = opts?.bearer
        ? // OAuth (Claude Code subscription) auth instead of x-api-key.
          {
              Authorization: `Bearer ${apiKey}`,
              "anthropic-beta": "oauth-2025-04-20",
          }
        : { "x-api-key": apiKey };
    const resp = await fetch("https://api.anthropic.com/v1/models", {
        method: "GET",
        headers: {
            ...headers,
            "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { data?: Array<Record<string, unknown>> };
    return filterChatModels(
        (data?.data ?? [])
            .map((m) => {
                const id = typeof m?.id === "string" ? m.id : "";
                if (!id) return null;
                const supportsImageInput = normalizeModelCapability(m);
                return supportsImageInput === undefined
                    ? { id }
                    : { id, supportsImageInput };
            })
            .filter((model): model is ProviderModel => !!model)
    );
}

async function fetchZenModels(apiKey?: string): Promise<ProviderModel[]> {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const resp = await fetch("https://opencode.ai/zen/v1/models", {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as { data?: Array<Record<string, unknown>> };
    return filterChatModels(
        (data?.data ?? [])
            .map((m) => {
                const id = typeof m?.id === "string" ? m.id : "";
                if (!id) return null;
                const supportsImageInput = normalizeModelCapability(m);
                return supportsImageInput === undefined
                    ? { id }
                    : { id, supportsImageInput };
            })
            .filter((m): m is ProviderModel => !!m)
    );
}

export async function POST(request: NextRequest) {
    const untrusted = rejectUntrustedRequest(request);
    if (untrusted) return untrusted;

    try {
        const body = (await request.json()) as {
            provider?: Provider;
            apiKey?: string;
            baseUrl?: string;
        };
        const provider = body.provider;
        if (!provider) {
            return new Response(JSON.stringify({ models: [] }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }

        let models: ProviderModel[] = [];
        if (provider === "anthropic") {
            if (!body.apiKey) models = [];
            else models = await fetchAnthropicModels(body.apiKey);
        } else if (provider === "claude-cli") {
            // Claude Code subscription — OAuth bearer against the same API.
            const cred = await resolveCliCredential("claude-cli");
            if (!cred) models = [];
            else {
                models = await fetchAnthropicModels(cred.token, { bearer: true });
                // The models endpoint may reject OAuth tokens; fall back to a
                // static catalog so the picker stays usable.
                if (models.length === 0) {
                    models = [
                        { id: "claude-opus-4-5-20250918", supportsImageInput: true },
                        { id: "claude-sonnet-4-5-20250929", supportsImageInput: true },
                        { id: "claude-haiku-4-5-20251001", supportsImageInput: true },
                    ];
                }
            }
        } else if (provider === "codex-cli") {
            const cred = await resolveCliCredential("codex-cli");
            // Ask the installed Codex CLI (app-server) for its live ChatGPT
            // model catalog — always authoritative. If the CLI isn't present /
            // authenticated / reachable, fall back to the static catalog so
            // the picker stays usable rather than empty.
            const live = cred ? await fetchCodexLiveModels() : [];
            models =
                live.length > 0
                    ? live.map((m) => ({
                          id: m.slug,
                          ...(m.name ? { name: m.name } : {}),
                          ...(m.supportsImageInput !== undefined
                              ? { supportsImageInput: m.supportsImageInput }
                              : {}),
                      }))
                    : CODEX_CLI_MODELS.map((m) => ({ ...m }));
        } else if (provider === "opencode-cli") {
            // Read models directly from the installed OpenCode CLI — no Zen API
            // key needed. This is authoritative and keeps working offline. The
            // static Zen fallback is only a safety net if the CLI is missing.
            const live = await fetchOpencodeCliModels();
            models =
                live.length > 0
                    ? live.map((m) => ({
                          id: m.slug,
                          name: m.name,
                          // The CLI reports each model's gateway group
                          // (`opencode` vs `opencode-go`). Carry it so the
                          // picker can label them and the LLM route can select
                          // the matching auth key.
                          subProvider: m.provider,
                          ...(m.supportsImageInput !== undefined
                              ? { supportsImageInput: m.supportsImageInput }
                              : {}),
                      }))
                    : await fetchZenModels();
        } else if (provider === "openai") {
            if (!body.apiKey) models = [];
            else models = await fetchOpenAiCompatibleModels("https://api.openai.com/v1", body.apiKey);
        } else if (provider === "groq") {
            if (!body.apiKey) models = [];
            else models = await fetchOpenAiCompatibleModels("https://api.groq.com/openai/v1", body.apiKey);
        } else if (provider === "cerebras") {
            if (!body.apiKey) models = [];
            else models = await fetchOpenAiCompatibleModels("https://api.cerebras.ai/v1", body.apiKey);
        } else if (provider === "zen") {
            models = await fetchZenModels(body.apiKey);
        } else if (provider === "lmstudio") {
            const baseUrl = (body.baseUrl || "http://localhost:1234").trim().replace(/\/+$/, "");
            const normalized = baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
            const validated = localHttpBaseUrl(normalized);
            models = validated ? await fetchOpenAiCompatibleModels(validated) : [];
        }

        return new Response(JSON.stringify({ models }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch {
        return new Response(JSON.stringify({ models: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }
}
