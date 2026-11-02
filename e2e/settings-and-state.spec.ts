import { anthropicStream, expect, test, transcript } from "./support/fixtures";
import { sessionStorageFor, settingsStorage } from "./support/seed";

test.describe("upgrading from an older PRMPTR", () => {
    test.use({
        storage: {
            ...sessionStorageFor({ provider: "claude-cli", model: "claude-sonnet-4-5-20250929" }),
            ...settingsStorage({
                transcriptionMode: "screenpipe",
                screenpipeUrl: "http://localhost:3030",
                defaultProvider: "claude-cli",
                defaultModel: "claude-opus-4-5-20250918",
                // Very old builds kept keys in plaintext localStorage.
                apiKeys: { anthropic: "sk-ant-legacy" },
                cliSubscriptions: { "claude-cli": true, "codex-cli": true },
            }),
        },
    });

    test("moves retired providers/models and plaintext keys onto safe current equivalents", async ({ app, backend }) => {
        await app.goto("/");
        // Claude Code subscription → Anthropic API with the current fast model.
        await expect(app.getByRole("button", { name: /Claude Haiku 5\.5/ })).toBeVisible();
        // Legacy plaintext key migrated into the secure store and scrubbed from localStorage.
        await expect.poll(async () => JSON.stringify((await backend.state()).secrets)).toContain("sk-ant-legacy");
        await expect.poll(() => app.evaluate(() => localStorage.getItem("prmptr-settings") ?? "")).not.toContain("sk-ant-legacy");
        const persisted = await app.evaluate(() => localStorage.getItem("prmptr-settings") ?? "");
        expect(persisted).not.toContain("screenpipe");
        expect(persisted).not.toContain("claude-cli");

        // Screenpipe mode became on-device capture.
        await app.getByRole("button", { name: "Start" }).click();
        await expect.poll(async () => (await backend.calls("start_local_transcription")).length).toBe(1);
    });
});

test.describe("legacy Codex selection", () => {
    test.use({ storage: sessionStorageFor({ provider: "codex-cli", model: "gpt-5-codex" }) });

    test("asks the user to pick a model from Your AI apps instead of crashing", async ({ app }) => {
        await app.goto("/");
        await expect(app.getByRole("button", { name: "Select a model" })).toBeVisible();
        await expect(app.getByRole("button", { name: "Analyze" })).toBeDisabled();
    });
});

test("API keys go to the secure store, never to localStorage", async ({ app, backend }) => {
    await app.goto("/");
    await app.getByRole("button", { name: "Settings" }).click();
    await app.getByRole("tab", { name: /Providers/ }).click();
    await app.getByRole("textbox", { name: "Anthropic key..." }).fill("sk-ant-typed-in-ui");
    await expect.poll(async () => JSON.stringify((await backend.state()).secrets)).toContain("sk-ant-typed-in-ui");
    expect(await app.evaluate(() => JSON.stringify(localStorage))).not.toContain("sk-ant-typed-in-ui");
});

test("Your AI apps models can be picked from the model picker", async ({ app }) => {
    await app.goto("/");
    await app.getByRole("button", { name: /LM Studio|Select a model/ }).click();
    await app.getByRole("button", { name: "Your AI apps" }).click();
    await app.getByRole("listbox", { name: "Models" }).getByText("Claude Haiku 5.5").click();
    await expect.poll(() => app.evaluate(() => localStorage.getItem("prmptr-session") ?? "")).toContain('"provider":"local-ai"');
    const session = JSON.parse((await app.evaluate(() => localStorage.getItem("prmptr-session"))) ?? "{}");
    expect(session.state.config.localAi).toMatchObject({ routeId: "r-claude", revision: "1" });
});

test.describe("OpenCode through OriginLM", () => {
    // OpenCode's local service reports its credentials as configured but not
    // verifiable, so its rows must still reach the picker and keep their route.
    test.use({
        backendConfig: {
            localAiModels: [
                {
                    routeId: "r-opencode",
                    modelId: "m-sonnet-oc",
                    revision: "7",
                    nativeId: "claude-sonnet-5-5",
                    name: "Claude Sonnet 5.5",
                    providerId: "opencode",
                    providerName: "OpenCode · Default profile",
                    isDefault: true,
                    supportsImageInput: true,
                },
                {
                    routeId: "r-opencode",
                    modelId: "m-flash-oc",
                    revision: "7",
                    nativeId: "deepseek-v4.1-flash",
                    name: "DeepSeek V4.1 Flash",
                    providerId: "opencode",
                    providerName: "OpenCode · Default profile",
                    isDefault: false,
                    supportsImageInput: true,
                },
            ],
        },
    });

    test("lists OpenCode models under Your AI apps and selects their route", async ({ app }) => {
        await app.goto("/");
        await app.getByRole("button", { name: /LM Studio|Select a model/ }).click();
        await app.getByRole("button", { name: "Your AI apps" }).click();
        const list = app.getByRole("listbox", { name: "Models" });
        await expect(list.getByText("Claude Sonnet 5.5")).toBeVisible();
        await list.getByText("DeepSeek V4.1 Flash").click();
        await expect.poll(() => app.evaluate(() => localStorage.getItem("prmptr-session") ?? "")).toContain('"provider":"local-ai"');
        const session = JSON.parse((await app.evaluate(() => localStorage.getItem("prmptr-session"))) ?? "{}");
        expect(session.state.config.localAi).toMatchObject({
            routeId: "r-opencode",
            nativeId: "deepseek-v4.1-flash",
            providerName: "OpenCode · Default profile",
        });
    });
});

test.describe("screenshot on analyze", () => {
    test.use({
        backendConfig: { secrets: { apiKeys: { anthropic: "sk-ant-e2e" } } },
        storage: {
            ...sessionStorageFor({ provider: "anthropic", model: "claude-haiku-5-5" }),
            ...settingsStorage({ includeScreenshotOnAnalyze: true }),
        },
    });

    test("attaches a native screen capture as an image block for vision models", async ({ app, backend }) => {
        let content: unknown = null;
        await app.route("https://api.anthropic.com/v1/messages", async (route) => {
            content = route.request().postDataJSON().messages[0].content;
            await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: anthropicStream("Nice slide deck.") });
        });
        await app.goto("/");
        await app.getByRole("button", { name: "Start" }).click();
        await backend.emit("local-transcription", transcript("s1", "Take a look at my screen.", "output"));
        await app.getByRole("button", { name: "Analyze" }).click();
        await expect(app.getByText("Nice slide deck.")).toBeVisible();
        expect(await backend.calls("capture_screenshot")).toHaveLength(1);
        expect(Array.isArray(content)).toBe(true);
        expect((content as Array<{ type: string }>).map((b) => b.type)).toEqual(["image", "text"]);
    });
});

test.describe("session history", () => {
    test.use({
        backendConfig: { secrets: { apiKeys: { anthropic: "sk-ant-e2e" } } },
        storage: sessionStorageFor({ provider: "anthropic", model: "claude-haiku-5-5" }),
    });

    test("responses survive an app restart", async ({ app, backend }) => {
        await app.route("https://api.anthropic.com/v1/messages", (route) =>
            route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: anthropicStream("Remember me after reload.") })
        );
        await app.goto("/");
        await app.getByRole("button", { name: "Start" }).click();
        await backend.emit("local-transcription", transcript("h1", "Quick question about history.", "output"));
        await app.getByRole("button", { name: "Analyze" }).click();
        await expect(app.getByText("Remember me after reload.")).toBeVisible();
        // The response is written to IndexedDB just after it renders; restart
        // only once the session has been persisted.
        await expect
            .poll(() => app.evaluate(() => JSON.parse(localStorage.getItem("prmptr-session") ?? "{}").state?.currentSessionId ?? null))
            .not.toBeNull();
        await expect
            .poll(() =>
                app.evaluate(
                    () =>
                        new Promise<number>((resolve) => {
                            const open = indexedDB.open("prmptr");
                            open.onsuccess = () => {
                                const db = open.result;
                                if (!db.objectStoreNames.contains("responses")) return resolve(0);
                                const count = db.transaction("responses").objectStore("responses").count();
                                count.onsuccess = () => resolve(count.result);
                                count.onerror = () => resolve(0);
                            };
                            open.onerror = () => resolve(0);
                        })
                )
            )
            .toBeGreaterThan(0);

        await app.reload();
        await expect(app.getByText("Remember me after reload.")).toBeVisible();
    });
});

test("the overlay window route renders from the static bundle", async ({ app }) => {
    const response = await app.goto("/overlay");
    expect(response?.status()).toBe(200);
    await expect(app.locator("body")).not.toBeEmpty();
});
