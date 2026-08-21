import { NextRequest } from "next/server";
import { rejectUntrustedRequest, localHttpBaseUrl } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

type Provider = "anthropic" | "openai" | "groq" | "cerebras" | "lmstudio";

type ProviderModel = {
    id: string;
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

async function fetchAnthropicModels(apiKey: string): Promise<ProviderModel[]> {
    const resp = await fetch("https://api.anthropic.com/v1/models", {
        method: "GET",
        headers: {
            "x-api-key": apiKey,
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
        } else if (provider === "openai") {
            if (!body.apiKey) models = [];
            else models = await fetchOpenAiCompatibleModels("https://api.openai.com/v1", body.apiKey);
        } else if (provider === "groq") {
            if (!body.apiKey) models = [];
            else models = await fetchOpenAiCompatibleModels("https://api.groq.com/openai/v1", body.apiKey);
        } else if (provider === "cerebras") {
            if (!body.apiKey) models = [];
            else models = await fetchOpenAiCompatibleModels("https://api.cerebras.ai/v1", body.apiKey);
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
