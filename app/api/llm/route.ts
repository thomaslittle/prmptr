import { NextRequest } from "next/server";
import { streamLLMResponse } from "@/lib/llm-providers";
import { LLMProvider } from "@/lib/types";
import { rejectUntrustedRequest, localHttpBaseUrl } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

function normalizeOpenAiCompatibleBaseUrl(
    baseUrl: string | undefined,
    fallback: string
): string {
    const raw = (baseUrl || fallback).trim().replace(/\/+$/, "");
    return raw.endsWith("/v1") ? raw : `${raw}/v1`;
}

async function resolveAutoModel(
    baseUrl: string,
    model: string,
    provider: "lmstudio",
    apiKey?: string
): Promise<string> {
    if (model !== `${provider}-auto`) return model;
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const resp = await fetch(`${baseUrl}/models`, { method: "GET", headers, signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) return model;
    const data = (await resp.json()) as { data?: Array<{ id?: string }> };
    const ids = (data?.data ?? [])
        .map((m) => (typeof m?.id === "string" ? m.id : ""))
        .filter((id): id is string => !!id);
    if (ids.length === 0) return model;

    // Avoid embedding/reranker models for chat completions.
    const nonEmbedding = ids.filter((id) => !/(embed|embedding|rerank|bge|nomic-embed)/i.test(id));
    const candidates = nonEmbedding.length > 0 ? nonEmbedding : ids;

    // Prefer explicit chat/instruct model ids when available.
    const preferred =
        candidates.find((id) => /(instruct|chat|assistant)/i.test(id)) ??
        candidates[0];
    return preferred || model;
}

export async function POST(request: NextRequest) {
    const untrusted = rejectUntrustedRequest(request);
    if (untrusted) return untrusted;

    try {
        const body = await request.json();
        const {
            systemPrompt,
            userMessage,
            provider,
            model,
            apiKey,
            baseUrl,
            imageDataUrl,
            maxTokens,
            temperature,
        } = body;

        const needsKey =
            provider === "anthropic" ||
            provider === "openai" ||
            provider === "groq" ||
            provider === "cerebras" ||
            provider === "zen";
        if (!systemPrompt || !userMessage || !provider || !model || (needsKey && !apiKey)) {
            return new Response(
                JSON.stringify({
                    error:
                        "Missing required fields: systemPrompt, userMessage, provider, model" +
                        (needsKey ? ", apiKey" : ""),
                }),
                { status: 400, headers: { "Content-Type": "application/json" } }
            );
        }

        let normalizedBaseUrl: string | undefined;
        if (provider === "lmstudio") {
            const candidate = normalizeOpenAiCompatibleBaseUrl(baseUrl, "http://localhost:1234/v1");
            const validated = localHttpBaseUrl(candidate);
            if (!validated) {
                return new Response(
                    JSON.stringify({
                        error:
                            "Invalid baseUrl: LM Studio requests may only target loopback http(s) hosts",
                    }),
                    { status: 400, headers: { "Content-Type": "application/json" } }
                );
            }
            normalizedBaseUrl = validated;
        }

        const effectiveModel =
            provider === "lmstudio"
                ? await resolveAutoModel(normalizedBaseUrl!, model, provider, apiKey)
                : model;

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                let closed = false;
                const safeEnqueue = (payload: string) => {
                    if (closed) return;
                    try {
                        controller.enqueue(encoder.encode(payload));
                    } catch {
                        closed = true;
                    }
                };
                const onAbort = () => {
                    closed = true;
                    try { controller.close(); } catch { /* already closed */ }
                };
                request.signal.addEventListener("abort", onAbort);

                try {
                    const tokenStream = streamLLMResponse({
                        systemPrompt,
                        userMessage,
                        provider: provider as LLMProvider,
                        model: effectiveModel,
                        apiKey: apiKey || "",
                        imageDataUrl: typeof imageDataUrl === "string" ? imageDataUrl : undefined,
                        baseUrl: normalizedBaseUrl,
                        maxTokens: maxTokens || 1024,
                        temperature: temperature ?? 0.4,
                        signal: request.signal,
                    });

                    for await (const token of tokenStream) {
                        if (closed) break;
                        safeEnqueue(`data: ${JSON.stringify({ type: "token", text: token })}\n\n`);
                    }

                    if (!closed) {
                        safeEnqueue(`data: ${JSON.stringify({ type: "done" })}\n\n`);
                    }
                } catch (error) {
                    if (!closed) {
                        const errorMsg =
                            error instanceof Error ? error.message : "Unknown error";
                        safeEnqueue(
                            `data: ${JSON.stringify({ type: "error", message: errorMsg })}\n\n`
                        );
                    }
                } finally {
                    request.signal.removeEventListener("abort", onAbort);
                    if (!closed) {
                        closed = true;
                        try { controller.close(); } catch { /* already closed */ }
                    }
                }
            },
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            },
        });
    } catch (error) {
        return new Response(
            JSON.stringify({
                error:
                    error instanceof Error ? error.message : "Failed to process request",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}
