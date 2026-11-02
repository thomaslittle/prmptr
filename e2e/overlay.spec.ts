import { anthropicStream, expect, test, transcript } from "./support/fixtures";
import { sessionStorageFor } from "./support/seed";

test.describe("always-on-top overlay", () => {
    test.use({
        backendConfig: { secrets: { apiKeys: { anthropic: "sk-ant-e2e" } } },
        storage: sessionStorageFor({ provider: "anthropic", model: "claude-haiku-5-5" }),
    });

    test("is opt-in: off by default, no overlay window until enabled", async ({ app, backend }) => {
        await app.goto("/");
        await expect(app.getByRole("button", { name: /Overlay off/ })).toBeVisible();
        await expect.poll(async () => (await backend.calls("set_overlay_enabled")).at(-1)?.args.enabled).toBe(false);
        expect((await backend.state()).overlay.enabled).toBe(false);
    });

    test("mirrors the live analysis stream into the overlay with a single LLM request", async ({ app, backend }) => {
        let llmRequests = 0;
        await app.route("https://api.anthropic.com/v1/messages", async (route) => {
            llmRequests++;
            await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: anthropicStream("Say: we cut onboarding from nine days to two.") });
        });
        await app.goto("/");
        await app.getByRole("button", { name: /Overlay off/ }).click();
        await expect(app.getByRole("button", { name: /Overlay on/ })).toBeVisible();
        expect((await backend.state()).overlay).toMatchObject({ enabled: true, visible: true });

        await app.getByRole("button", { name: "Start" }).click();
        await backend.emit("local-transcription", transcript("o1", "So what changed on your last team?", "output"));
        await app.getByRole("button", { name: "Analyze" }).click();
        await expect(app.getByText("we cut onboarding from nine days to two").first()).toBeVisible();

        await expect
            .poll(async () => (await backend.state()).overlay.content.responses[0]?.content ?? "")
            .toContain("we cut onboarding from nine days to two");
        const publishes = (await backend.state()).overlayPublishes;
        expect(publishes.some((p) => p.isStreaming), "overlay received the live stream").toBe(true);
        expect(llmRequests, "overlay must not cause a second inference request").toBe(1);
    });

    test("show/hide and click-through controls drive the native window", async ({ app, backend }) => {
        await app.goto("/");
        await app.getByRole("button", { name: /Overlay off/ }).click();
        await app.getByRole("button", { name: "Hide", exact: true }).click();
        await expect.poll(async () => (await backend.state()).overlay.visible).toBe(false);
        await app.getByRole("button", { name: "Show", exact: true }).click();
        await expect.poll(async () => (await backend.state()).overlay.visible).toBe(true);
        await app.getByRole("button", { name: "Interactive" }).click();
        await expect(app.getByRole("button", { name: "Clicks pass" })).toBeVisible();
        expect((await backend.calls("set_overlay_click_through")).at(-1)?.args).toEqual({ enabled: true });
    });

    test("the overlay window renders streamed and completed responses", async ({ app, backend }) => {
        await app.goto("/overlay");
        await expect(app.getByText("Waiting for the next PRMPTR response")).toBeVisible();
        await expect
            .poll(async () => (await backend.calls("plugin:event|listen")).map((c) => c.args.event))
            .toContain("overlay-content");
        await backend.emit("overlay-content", {
            responses: [],
            currentResponse: "Lead with the outcome…",
            isStreaming: true,
            appearance: { opacity: 0.9, fontScale: 1 },
        });
        await expect(app.getByText("Live response")).toBeVisible();
        await expect(app.getByText("thinking")).toBeVisible();
        await backend.emit("overlay-content", {
            responses: [{ id: "r1", content: "**Lead with the outcome.** Then the how.", timestamp: new Date().toISOString(), model: "claude-haiku-5-5", kind: "analysis" }],
            currentResponse: "",
            isStreaming: false,
            appearance: { opacity: 0.9, fontScale: 1 },
        });
        await expect(app.getByText("Lead with the outcome.")).toBeVisible();
        await expect(app.getByText("Suggestion")).toBeVisible();
    });
});
