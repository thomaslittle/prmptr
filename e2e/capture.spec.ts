import { expect, test, transcript } from "./support/fixtures";

test.describe("local capture", () => {
    test("starts the on-device engine with the configured devices and streams transcripts into the feed", async ({ app, backend }) => {
        await app.goto("/");
        await expect(app.getByRole("banner")).toContainText("Idle");

        await app.getByRole("button", { name: "Start" }).click();
        await expect.poll(async () => (await backend.calls("start_local_transcription")).length).toBe(1);
        const [start] = await backend.calls("start_local_transcription");
        expect(start.args).toMatchObject({
            inputDeviceName: "Studio Mic (input)",
            muteInput: false,
            muteOutput: false,
            preferGpu: false,
        });
        await expect(app.getByRole("button", { name: "Stop" })).toBeVisible();

        await backend.emit("local-transcription", transcript("t1", "So what did you think of the demo?", "output"));
        await backend.emit("local-transcription", transcript("t2", "Honestly it was better than I expected.", "input"));
        await expect(app.getByText("So what did you think of the demo?")).toBeVisible();
        await expect(app.getByText("Honestly it was better than I expected.")).toBeVisible();

        await app.getByRole("button", { name: "Stop" }).click();
        await expect.poll(async () => (await backend.calls("stop_local_transcription")).length).toBeGreaterThan(0);
        await expect(app.getByRole("button", { name: "Start" })).toBeVisible();
    });

    test("mute buttons toggle the live channel mute without restarting capture", async ({ app, backend }) => {
        await app.goto("/");
        await app.getByRole("button", { name: "Start" }).click();
        await expect(app.getByRole("button", { name: "Stop" })).toBeVisible();

        await app.getByRole("button", { name: "Them" }).click();
        await expect
            .poll(async () => (await backend.calls("set_local_mute")).map((c) => c.args))
            .toContainEqual({ channel: "output", muted: true });
        expect(await backend.calls("start_local_transcription")).toHaveLength(1);
    });

    test("a worker crash flips the UI out of the running state and shows the error", async ({ app, backend }) => {
        await app.goto("/");
        await app.getByRole("button", { name: "Start" }).click();
        await expect(app.getByRole("button", { name: "Stop" })).toBeVisible();

        await backend.emit("local-transcription-status", {
            mode: "local-whisper",
            running: false,
            error: "Local transcription worker stopped unexpectedly",
        });
        await expect(app.getByRole("button", { name: "Start" })).toBeVisible();
        await expect(app.getByText("Local transcription worker stopped unexpectedly").first()).toBeVisible();
    });

    test.describe("without a downloaded model", () => {
        test.use({
            backendConfig: {
                sttModels: [
                    {
                        id: "parakeet-unified-en",
                        name: "Parakeet Unified (English)",
                        description: "Recommended",
                        languages: "English",
                        size_mb: 731,
                        installed: false,
                        selected: true,
                        recommended: true,
                    },
                ],
            },
        });

        test("explains that the model must be downloaded instead of failing silently", async ({ app }) => {
            await app.goto("/");
            await app.getByRole("button", { name: "Start" }).click();
            await expect(app.getByText(/not downloaded yet/).first()).toBeVisible();
            await expect(app.getByRole("button", { name: "Start" })).toBeVisible();
        });
    });
});

test.describe("speech models", () => {
    test("downloads a model with live progress, then makes it the active model", async ({ app, backend }) => {
        await app.goto("/");
        await app.getByRole("button", { name: "Settings" }).click();
        const settings = app.getByRole("tabpanel", { name: "Capture & Voice" });

        const v3 = settings.getByRole("radio", { name: /Parakeet v3/ });
        await expect(v3).toBeDisabled();
        await settings.getByRole("button", { name: "Download Parakeet v3 (Multilingual)" }).click();

        await expect.poll(async () => (await backend.calls("download_stt_model")).map((c) => c.args)).toEqual([
            { modelId: "parakeet-v3" },
        ]);
        await expect(v3).toBeEnabled();
        await expect(v3).toBeChecked();
        await expect(settings.getByRole("radio", { name: /Parakeet Unified/ })).not.toBeChecked();
    });

    test("selecting an installed model persists the choice in the backend", async ({ app, backend }) => {
        await app.goto("/");
        await app.getByRole("button", { name: "Settings" }).click();
        const settings = app.getByRole("tabpanel", { name: "Capture & Voice" });
        await settings.getByRole("button", { name: "Download Moonshine Small (English)" }).click();
        await expect(settings.getByRole("radio", { name: /Moonshine/ })).toBeChecked();

        await settings.getByRole("radio", { name: /Parakeet Unified/ }).click();
        await expect(settings.getByRole("radio", { name: /Parakeet Unified/ })).toBeChecked();
        expect((await backend.calls("set_selected_stt_model")).at(-1)?.args).toEqual({ modelId: "parakeet-unified-en" });
    });

    test("Deepgram mode hides local models and requires a key", async ({ app }) => {
        await app.goto("/");
        await app.getByRole("button", { name: "Settings" }).click();
        const settings = app.getByRole("tabpanel", { name: "Capture & Voice" });
        await settings.getByRole("button", { name: "Deepgram (cloud)" }).click();
        await expect(settings.getByRole("radiogroup", { name: "Speech model" })).toBeHidden();
        await expect(settings.getByText("Deepgram API key is required.")).toBeVisible();
    });
});
