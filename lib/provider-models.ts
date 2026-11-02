// Live model catalogs for each provider (replaces the old /api/provider-models
// route). Every function resolves to [] rather than throwing so pickers fall
// back to the static catalog in lib/types.ts.

import { fetchJson } from "./http";
import { localHttpBaseUrl, normalizeV1BaseUrl } from "./local-url";
import { listLocalAiModels, type LocalAiModel } from "./tauri";
import type { LLMProvider, LocalAiRoute } from "./types";

export interface ProviderModel {
    id: string;
    name?: string;
    /** Display group within a provider (for "local-ai": the AI app, e.g. "Claude Code"). */
    group?: string;
    /** OriginLM route for "local-ai" models. */
    localAi?: LocalAiRoute;
    /** OriginLM marks each app's default model. */
    isDefault?: boolean;
    supportsImageInput?: boolean;
}

const NON_CHAT = /(embed|embedding|rerank|bge|nomic-embed|whisper|tts|transcribe|moderation|dall-e|image-|audio|realtime|search-preview)/i;

export function filterChatModels(models: ProviderModel[]): ProviderModel[] {
    return models.filter((m) => !NON_CHAT.test(m.id));
}

/** Read image-input capability from the many shapes providers report it in. */
export function normalizeModelCapability(raw: unknown): boolean | undefined {
    const obj = raw as Record<string, unknown> | undefined;
    if (!obj || typeof obj !== "object") return undefined;
    if (typeof obj.supports_image_input === "boolean") return obj.supports_image_input;

    const capabilities = obj.capabilities as Record<string, unknown> | undefined;
    if (capabilities && typeof capabilities === "object") {
        const imageInput = (capabilities.image_input as { supported?: unknown } | undefined)?.supported;
        if (typeof imageInput === "boolean") return imageInput;
    }

    const asList = (value: unknown): string[] =>
        Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").map((v) => v.toLowerCase()) : [];
    const candidates: unknown[] = [
        obj.modalities,
        obj.input_modalities,
        capabilities?.modalities,
        capabilities?.input_modalities,
        (obj.architecture as Record<string, unknown> | undefined)?.input_modalities,
    ];
    for (const candidate of candidates) {
        const values = asList(candidate);
        if (values.length === 0) continue;
        if (values.includes("image") || values.includes("vision")) return true;
        if (values.length === 1 && values[0] === "text") return false;
    }
    return undefined;
}

function toModels(data: { data?: Array<Record<string, unknown>> } | null): ProviderModel[] {
    return filterChatModels(
        (data?.data ?? []).flatMap((m) => {
            const id = typeof m?.id === "string" ? m.id : "";
            if (!id) return [];
            const name = typeof m.display_name === "string" ? m.display_name : undefined;
            const supportsImageInput = normalizeModelCapability(m);
            return [{ id, ...(name ? { name } : {}), ...(supportsImageInput !== undefined ? { supportsImageInput } : {}) }];
        })
    );
}

async function openAiCompatibleModels(baseUrl: string, apiKey?: string): Promise<ProviderModel[]> {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    return toModels(await fetchJson(`${baseUrl.replace(/\/+$/, "")}/models`, { headers }));
}

async function anthropicModels(apiKey: string): Promise<ProviderModel[]> {
    return toModels(
        await fetchJson("https://api.anthropic.com/v1/models?limit=100", {
            headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        })
    );
}

async function zenModels(apiKey?: string): Promise<ProviderModel[]> {
    return openAiCompatibleModels("https://opencode.ai/zen/v1", apiKey);
}

export function localAiToProviderModel(m: LocalAiModel): ProviderModel {
    return {
        id: m.modelId,
        name: m.name || m.nativeId || m.modelId,
        group: m.providerName,
        isDefault: m.isDefault,
        supportsImageInput: m.supportsImageInput,
        localAi: {
            routeId: m.routeId,
            revision: m.revision,
            nativeId: m.nativeId,
            providerName: m.providerName,
            name: m.name || m.nativeId || m.modelId,
            supportsImageInput: m.supportsImageInput,
        },
    };
}

export async function fetchProviderModels(params: {
    provider: LLMProvider;
    apiKey?: string;
    baseUrl?: string;
}): Promise<ProviderModel[]> {
    const { provider, apiKey, baseUrl } = params;
    try {
        switch (provider) {
            case "anthropic":
                return apiKey ? await anthropicModels(apiKey) : [];
            case "openai":
                return apiKey ? await openAiCompatibleModels("https://api.openai.com/v1", apiKey) : [];
            case "groq":
                return apiKey ? await openAiCompatibleModels("https://api.groq.com/openai/v1", apiKey) : [];
            case "cerebras":
                return apiKey ? await openAiCompatibleModels("https://api.cerebras.ai/v1", apiKey) : [];
            case "zen":
                return await zenModels(apiKey);
            case "lmstudio": {
                const validated = localHttpBaseUrl(normalizeV1BaseUrl(baseUrl, "http://localhost:1234"));
                return validated ? await openAiCompatibleModels(validated) : [];
            }
            case "local-ai":
                return (await listLocalAiModels()).map(localAiToProviderModel);
            default:
                return [];
        }
    } catch {
        return [];
    }
}
