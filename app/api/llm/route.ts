import { NextRequest } from "next/server";
import { streamLLMResponse } from "@/lib/llm-providers";
import { LLMProvider } from "@/lib/types";

export const dynamic = "force-dynamic";

function normalizeLmStudioBaseUrl(baseUrl?: string): string {
    const raw = (baseUrl || "http://localhost:1234/v1").trim().replace(/\/+$/, "");
    return raw.endsWith("/v1") ? raw : `${raw}/v1`;
}

async function resolveLmStudioModel(baseUrl: string, model: string): Promise<string> {
    if (model !== "lmstudio-auto") return model;
    const resp = await fetch(`${baseUrl}/models`, { method: "GET" });
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
    try {
        const body = await request.json();
        const {
            systemPrompt,
            userMessage,
            provider,
            model,
            apiKey,
            baseUrl,
            maxTokens,
            temperature,
        } = body;

        const needsKey = provider !== "lmstudio";
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

        const normalizedBaseUrl =
            provider === "lmstudio"
                ? normalizeLmStudioBaseUrl(baseUrl)
                : baseUrl;
        const effectiveModel =
            provider === "lmstudio"
                ? await resolveLmStudioModel(normalizedBaseUrl, model)
                : model;

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    const tokenStream = streamLLMResponse({
                        systemPrompt,
                        userMessage,
                        provider: provider as LLMProvider,
                        model: effectiveModel,
                        apiKey: apiKey || "",
                        baseUrl: normalizedBaseUrl,
                        maxTokens: maxTokens || 1024,
                        temperature: temperature ?? 0.4,
                    });

                    for await (const token of tokenStream) {
                        const event = `data: ${JSON.stringify({ type: "token", text: token })}\n\n`;
                        controller.enqueue(encoder.encode(event));
                    }

                    controller.enqueue(
                        encoder.encode(
                            `data: ${JSON.stringify({ type: "done" })}\n\n`
                        )
                    );
                } catch (error) {
                    const errorMsg =
                        error instanceof Error ? error.message : "Unknown error";
                    controller.enqueue(
                        encoder.encode(
                            `data: ${JSON.stringify({ type: "error", message: errorMsg })}\n\n`
                        )
                    );
                } finally {
                    controller.close();
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
