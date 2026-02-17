import { LLMProvider, LLMRequest } from "./types";

function extractOpenAIContent(payload: unknown): string {
    const p = payload as
        | {
              choices?: Array<{
                  text?: string;
                  message?: { content?: string | Array<{ text?: string; type?: string }> };
                  delta?: { content?: string | Array<{ text?: string; type?: string }> };
              }>;
          }
        | undefined;
    const choice = p?.choices?.[0];
    if (!choice) return "";

    if (typeof choice.text === "string" && choice.text.trim()) return choice.text;

    const msgContent = choice.message?.content;
    if (typeof msgContent === "string" && msgContent.trim()) return msgContent;
    if (Array.isArray(msgContent)) {
        const joined = msgContent
            .map((part) => (typeof part?.text === "string" ? part.text : ""))
            .join("");
        if (joined.trim()) return joined;
    }

    const deltaContent = choice.delta?.content;
    if (typeof deltaContent === "string" && deltaContent.trim()) return deltaContent;
    if (Array.isArray(deltaContent)) {
        const joined = deltaContent
            .map((part) => (typeof part?.text === "string" ? part.text : ""))
            .join("");
        if (joined.trim()) return joined;
    }

    return "";
}

function extractAnthropicContent(payload: unknown): string {
    const p = payload as
        | {
              content?: Array<{ type?: string; text?: string }>;
              output_text?: string;
          }
        | undefined;
    if (typeof p?.output_text === "string" && p.output_text.trim()) {
        return p.output_text;
    }
    if (!Array.isArray(p?.content)) return "";
    return p!.content
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text as string)
        .join("");
}

async function* streamAnthropicResponse(
    request: LLMRequest
): AsyncGenerator<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "x-api-key": request.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        body: JSON.stringify({
            model: request.model,
            max_tokens: request.maxTokens || 1024,
            system: request.systemPrompt,
            messages: [{ role: "user", content: request.userMessage }],
            stream: true,
            temperature: request.temperature ?? 0.4,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/json")) {
        const data = await response.json();
        const content = extractAnthropicContent(data);
        if (content) yield content;
        return;
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (line.startsWith("data: ")) {
                const data = line.slice(6).trim();
                if (data === "[DONE]") return;

                try {
                    const parsed = JSON.parse(data);
                    if (
                        parsed.type === "content_block_delta" &&
                        parsed.delta?.text
                    ) {
                        yield parsed.delta.text;
                    }
                } catch {
                    // skip
                }
            }
        }
    }
}

async function* streamOpenAICompatibleResponse(
    request: LLMRequest,
    baseUrl: string
): AsyncGenerator<string> {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    if (request.apiKey) {
        headers["Authorization"] = `Bearer ${request.apiKey}`;
    }

    const url = `${baseUrl}/chat/completions`;
    const requestBody = {
        model: request.model,
        max_tokens: request.maxTokens || 1024,
        messages: [
            { role: "system", content: request.systemPrompt },
            { role: "user", content: request.userMessage },
        ],
        stream: true,
        temperature: request.temperature ?? 0.4,
    };

    const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error ${response.status}: ${errorText}`);
    }

    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (contentType.includes("application/json")) {
        const data = await response.json();
        const content = extractOpenAIContent(data);
        if (content) yield content;
        return;
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    let emittedAny = false;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (line.startsWith("data: ")) {
                const data = line.slice(6).trim();
                if (data === "[DONE]") return;

                try {
                    const parsed = JSON.parse(data);
                    const content = extractOpenAIContent(parsed);
                    if (content) {
                        emittedAny = true;
                        yield content;
                    }
                } catch {
                    // skip
                }
            }
        }
    }

    // Some Groq models occasionally emit no token text in stream mode.
    // Retry once with non-stream mode and use the final message content.
    if (!emittedAny) {
        const nonStreamResponse = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
                ...requestBody,
                stream: false,
            }),
        });

        if (!nonStreamResponse.ok) {
            const errorText = await nonStreamResponse.text().catch(() => "");
            throw new Error(`API fallback error ${nonStreamResponse.status}: ${errorText}`);
        }

        const data = await nonStreamResponse.json().catch(() => ({}));
        const content = extractOpenAIContent(data);
        if (content) {
            yield content;
        }
    }
}

function getBaseUrl(provider: LLMProvider, customBaseUrl?: string): string {
    switch (provider) {
        case "openai":
            return "https://api.openai.com/v1";
        case "groq":
            return "https://api.groq.com/openai/v1";
        case "lmstudio":
            return customBaseUrl || "http://localhost:1234/v1";
        default:
            throw new Error(`Provider ${provider} doesn't use OpenAI-compatible API`);
    }
}

export async function* streamLLMResponse(
    request: LLMRequest
): AsyncGenerator<string> {
    switch (request.provider) {
        case "anthropic":
            yield* streamAnthropicResponse(request);
            break;
        case "openai":
        case "groq":
        case "lmstudio":
            yield* streamOpenAICompatibleResponse(
                request,
                getBaseUrl(request.provider, request.baseUrl)
            );
            break;
        default:
            throw new Error(`Unknown provider: ${request.provider}`);
    }
}
