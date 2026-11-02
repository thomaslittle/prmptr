// Regenerates the landing-page screenshots from the real UI:
//   SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.ts
import { anthropicStream, expect, test, transcript } from "./support/fixtures";
import { sessionStorageFor } from "./support/seed";

test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to regenerate landing screenshots");

test.use({
    backendConfig: { secrets: { apiKeys: { anthropic: "sk-ant-demo" } } },
    storage: sessionStorageFor({ provider: "anthropic", model: "claude-haiku-5-5" }),
});

const OUT = "public/screenshots";

test("landing screenshots", async ({ app, backend }) => {
    await app.route("https://api.anthropic.com/v1/messages", (route) =>
        route.fulfill({
            status: 200,
            headers: { "content-type": "text/event-stream" },
            body: anthropicStream(
                "**Answer:** Lead with the outcome — \"We cut onboarding from 9 days to 2.\" Then the how: one owner, one checklist, weekly review.\n\n**Comeback:** \"Happy to share the playbook — it fits on one slide.\""
            ),
        })
    );
    await app.goto("/");
    await app.getByRole("button", { name: "Start" }).click();
    const lines: Array<[string, "input" | "output"]> = [
        ["Thanks for joining. Walk me through the biggest win on your last team.", "output"],
        ["Sure — we rebuilt how new engineers ramp up.", "input"],
        ["Interesting. What changed, concretely, and how did you measure it?", "output"],
    ];
    for (const [i, [text, device]] of lines.entries()) {
        await backend.emit("local-transcription", transcript(`d${i}`, text, device));
    }
    await app.getByRole("button", { name: "Analyze" }).click();
    await expect(app.getByText("fits on one slide", { exact: false })).toBeVisible();
    await app.waitForTimeout(1500); // let entry animations settle
    await app.screenshot({ path: `${OUT}/main.png` });

    await app.getByRole("button", { name: "Settings" }).click();
    await expect(app.getByRole("radiogroup", { name: "Speech model" })).toBeVisible();
    await app.getByRole("dialog").screenshot({ path: `${OUT}/capture.png` });

    await app.getByRole("tab", { name: "TTS" }).click();
    await app.getByRole("dialog").screenshot({ path: `${OUT}/voice.png` });
});
