import type { Page } from "@playwright/test";
import { anthropicStream, expect, openAiStream, test, transcript, type Backend } from "./support/fixtures";
import { sessionStorageFor } from "./support/seed";

async function startWithConversation(app: Page, backend: Backend) {
    await app.goto("/");
    await app.getByRole("button", { name: "Start" }).click();
    await expect(app.getByRole("button", { name: "Stop" })).toBeVisible();
    await backend.emit("local-transcription", transcript("q1", "What's the capital of Australia?", "output"));
    await expect(app.getByText("What's the capital of Australia?")).toBeVisible();
}

test.describe("Anthropic", () => {
    test.use({
        backendConfig: { secrets: { apiKeys: { anthropic: "sk-ant-e2e" } } },
        storage: sessionStorageFor({ provider: "anthropic", model: "claude-haiku-5-5" }),
    });

    test("Analyze streams a reply using current-model request semantics", async ({ app, backend }) => {
        let body: Record<string, unknown> = {};
        let headers: Record<string, string> = {};
        await app.route("https://api.anthropic.com/v1/messages", async (route) => {
            body = route.request().postDataJSON();
            headers = route.request().headers();
            await route.fulfill({
                status: 200,
                headers: { "content-type": "text/event-stream" },
                body: anthropicStream("It's Canberra — not Sydney, a classic trap."),
            });
        });

        await startWithConversation(app, backend);
        await app.getByRole("button", { name: "Analyze" }).click();
        await expect(app.getByText("It's Canberra — not Sydney, a classic trap.")).toBeVisible();
        // Thinking deltas are never shown to the user.
        await expect(app.getByText("secret reasoning")).toHaveCount(0);

        expect(headers["x-api-key"]).toBe("sk-ant-e2e");
        expect(body.model).toBe("claude-haiku-5-5");
        expect(body.stream).toBe(true);
        // Claude 4.6+/5.x reject sampling params; latency is tuned with effort.
        expect(body).not.toHaveProperty("temperature");
        expect(body.output_config).toEqual({ effort: "low" });
        expect(Number(body.max_tokens)).toBeGreaterThan(2048);
        expect(JSON.stringify(body.messages)).toContain("capital of Australia");
    });

    test("an invalid key surfaces the provider's error message", async ({ app, backend }) => {
        await app.route("https://api.anthropic.com/v1/messages", (route) =>
            route.fulfill({
                status: 401,
                contentType: "application/json",
                body: JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }),
            })
        );
        await startWithConversation(app, backend);
        await app.getByRole("button", { name: "Analyze" }).click();
        await expect(app.getByText(/invalid x-api-key/)).toBeVisible();
        const alert = app.getByRole("alert").filter({ hasText: "Anthropic rejected the credentials" });
        await expect(alert).toContainText("Check the API key in Settings → Providers for Anthropic");
    });

    test("chat questions include the conversation and stream an answer", async ({ app, backend }) => {
        let prompt = "";
        await app.route("https://api.anthropic.com/v1/messages", async (route) => {
            prompt = JSON.stringify(route.request().postDataJSON());
            await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: anthropicStream("Canberra, since 1913.") });
        });
        await startWithConversation(app, backend);
        await app.getByRole("textbox", { name: "Ask about this session..." }).fill("When did it become the capital?");
        await app.getByRole("textbox", { name: "Ask about this session..." }).press("Enter");
        await expect(app.getByText("Canberra, since 1913.")).toBeVisible();
        expect(prompt).toContain("When did it become the capital?");
        expect(prompt).toContain("capital of Australia");
    });
});

test.describe("OpenAI", () => {
    test.use({
        backendConfig: { secrets: { apiKeys: { openai: "sk-openai-e2e" } } },
        storage: sessionStorageFor({ provider: "openai", model: "gpt-6.1-terra" }),
    });

    test("reasoning-era models get max_completion_tokens and no custom temperature", async ({ app, backend }) => {
        let body: Record<string, unknown> = {};
        await app.route("https://api.openai.com/v1/chat/completions", async (route) => {
            body = route.request().postDataJSON();
            await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: openAiStream("Canberra.") });
        });
        await startWithConversation(app, backend);
        await app.getByRole("button", { name: "Analyze" }).click();
        await expect(app.getByText("Canberra.", { exact: true })).toBeVisible();
        expect(body.model).toBe("gpt-6.1-terra");
        expect(body).toHaveProperty("max_completion_tokens");
        expect(body).not.toHaveProperty("max_tokens");
        expect(body).not.toHaveProperty("temperature");
    });

    test("a provider 500 shows a readable explanation instead of a raw dump", async ({ app, backend }) => {
        await app.route("https://api.openai.com/v1/chat/completions", (route) =>
            route.fulfill({
                status: 500,
                contentType: "application/json",
                body: JSON.stringify({ error: { message: "The server had an error while processing your request.", type: "server_error" } }),
            })
        );
        await startWithConversation(app, backend);
        await app.getByRole("button", { name: "Analyze" }).click();
        const alert = app.getByRole("alert").filter({ hasText: "OpenAI had a server error" });
        await expect(alert).toBeVisible();
        await expect(alert).toContainText("The server had an error while processing your request.");
        await expect(alert).toContainText("gpt-6.1-terra");
        await expect(alert).toContainText("Wait a bit and retry, or switch to another model/provider.");
        await expect(app.getByText(/\{"error"/)).toHaveCount(0);
        await expect(app.getByText(/Failed to get response/)).toHaveCount(0);
    });
});

test.describe("rate-limit failover", () => {
    test.use({
        backendConfig: { secrets: { apiKeys: { groq: "gsk-e2e", cerebras: "csk-e2e" } } },
        storage: sessionStorageFor({ provider: "groq", model: "openai/gpt-oss-20b" }),
    });

    test("a Groq 429 fails over to Cerebras transparently", async ({ app, backend }) => {
        await app.route("https://api.groq.com/openai/v1/chat/completions", (route) =>
            route.fulfill({ status: 429, headers: { "retry-after": "20" }, body: "rate limited" })
        );
        let cerebrasModel = "";
        await app.route("https://api.cerebras.ai/v1/chat/completions", async (route) => {
            cerebrasModel = route.request().postDataJSON().model;
            await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: openAiStream("Fallback says Canberra.") });
        });
        await startWithConversation(app, backend);
        await app.getByRole("button", { name: "Analyze" }).click();
        await expect(app.getByText("Fallback says Canberra.")).toBeVisible();
        expect(cerebrasModel).toBe("gpt-oss-120b");
    });
});

test.describe("Your AI apps (OriginLM)", () => {
    test.use({
        backendConfig: { localAiReply: "Canberra — answered via your Claude Code subscription." },
        storage: sessionStorageFor({
            provider: "local-ai",
            model: "m-haiku",
            localAi: { routeId: "r-claude", revision: "1", nativeId: "claude-haiku-5-5", providerName: "Claude Code", name: "Claude Haiku 5.5", supportsImageInput: true },
        }),
    });

    test("runs the turn through the installed client and streams its reply", async ({ app, backend }) => {
        await startWithConversation(app, backend);
        await app.getByRole("button", { name: "Analyze" }).click();
        await expect(app.getByText("Canberra — answered via your Claude Code subscription.")).toBeVisible();

        const [call] = await backend.calls("local_ai_complete");
        expect(call.args.selection).toEqual({ routeId: "r-claude", modelId: "m-haiku", revision: "1" });
        expect(String(call.args.prompt)).toContain("capital of Australia");
        // No credentials ever cross into the webview for this provider.
        expect(JSON.stringify(call.args)).not.toMatch(/token|apiKey/i);
    });
});
