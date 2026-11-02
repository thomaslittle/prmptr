import { anthropicStream, expect, test, transcript } from "./support/fixtures";
import { sessionStorageFor } from "./support/seed";

function speakerLine(id: string, text: string, speaker: number) {
    return { ...transcript(id, text, "output"), speaker_id: speaker, speaker_label: `Speaker ${speaker}` };
}

test.describe("speaker aliases", () => {
    test.use({
        backendConfig: { secrets: { apiKeys: { anthropic: "sk-ant-e2e" } } },
        storage: sessionStorageFor({ provider: "anthropic", model: "claude-haiku-5-5" }),
    });

    test("renaming a speaker relabels all their lines and flows into the prompt", async ({ app, backend }) => {
        let prompt = "";
        await app.route("https://api.anthropic.com/v1/messages", async (route) => {
            prompt = JSON.stringify(route.request().postDataJSON().messages);
            await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: anthropicStream("Ask Sarah about the budget.") });
        });

        await app.goto("/");
        await app.getByRole("button", { name: "Start" }).click();
        await expect(app.getByRole("button", { name: "Stop" })).toBeVisible();
        await backend.emit("local-transcription", speakerLine("s1", "We need to talk about the budget.", 2));
        await backend.emit("local-transcription", speakerLine("s2", "I agree with that.", 3));
        await backend.emit("local-transcription", speakerLine("s3", "It is due on Friday.", 2));
        await backend.emit("local-transcription", transcript("me1", "Sounds good to me.", "input"));
        await expect(app.getByText("It is due on Friday.")).toBeVisible();

        // Keyboard: focus the chip, open the editor, type, confirm with Enter.
        const chips = app.getByRole("button", { name: "Rename Speaker 2" });
        await expect(chips).toHaveCount(2);
        await chips.first().focus();
        await app.keyboard.press("Enter");
        const input = app.getByRole("textbox", { name: "Name for Speaker 2" });
        await expect(input).toBeFocused();
        await input.fill("Sarah");
        await input.press("Enter");

        await expect(app.getByRole("button", { name: "Rename Sarah" })).toHaveCount(2);
        await expect(app.getByRole("button", { name: "Rename Sarah" }).first()).toBeFocused();
        await expect(app.getByRole("button", { name: "Rename Speaker 3" })).toHaveCount(1);

        // Escape cancels without renaming.
        await app.getByRole("button", { name: "Rename Speaker 3" }).click();
        await app.getByRole("textbox", { name: "Name for Speaker 3" }).fill("Nope");
        await app.getByRole("textbox", { name: "Name for Speaker 3" }).press("Escape");
        await expect(app.getByRole("button", { name: "Rename Speaker 3" })).toHaveCount(1);

        await app.getByRole("button", { name: "Analyze" }).click();
        await expect(app.getByText("Ask Sarah about the budget.")).toBeVisible();
        expect(prompt).toContain("[THEM: Sarah]");
        expect(prompt).toContain("[THEM: Speaker 3]");
        expect(prompt).toContain("[YOU]");
        expect(prompt).not.toContain("Nope");
    });
});
