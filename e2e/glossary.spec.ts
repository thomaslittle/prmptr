import { anthropicStream, expect, test, transcript } from "./support/fixtures";
import { sessionStorageFor } from "./support/seed";

test.use({
    backendConfig: { secrets: { apiKeys: { anthropic: "sk-ant-e2e" } } },
    storage: sessionStorageFor({ provider: "anthropic", model: "claude-haiku-5-5" }),
});

test("the glossary reaches the speech engine on Start and the LLM on Analyze", async ({ app, backend }) => {
    let system = "";
    await app.route("https://api.anthropic.com/v1/messages", async (route) => {
        system = JSON.stringify(route.request().postDataJSON().system);
        await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: anthropicStream("Ask Saoirse.") });
    });

    await app.goto("/");
    await app.getByRole("button", { name: "Settings" }).click();
    const glossary = app.getByRole("textbox", { name: /Glossary/ });
    await glossary.fill("Saoirse = Sayers, Sersha\nKubeflow\n\nQdrant = Drant");
    await expect(app.getByText("3/64")).toBeVisible();
    await app.keyboard.press("Escape");

    await app.getByRole("button", { name: "Start" }).click();
    await expect.poll(async () => (await backend.calls("start_local_transcription")).at(-1)?.args.glossary).toEqual([
        "Saoirse = Sayers, Sersha",
        "Kubeflow",
        "Qdrant = Drant",
    ]);

    await backend.emit("local-transcription", transcript("g1", "Who owns the Qdrant migration?", "output"));
    await app.getByRole("button", { name: "Analyze" }).click();
    await expect(app.getByText("Ask Saoirse.")).toBeVisible();
    expect(system).toContain("use these exact spellings: Saoirse, Kubeflow, Qdrant");
});

test("glossary persists across restarts", async ({ app }) => {
    await app.goto("/");
    await app.getByRole("button", { name: "Settings" }).click();
    await app.getByRole("textbox", { name: /Glossary/ }).fill("Tadhg = Tad");
    await expect.poll(() => app.evaluate(() => localStorage.getItem("prmptr-settings") ?? "")).toContain("Tadhg = Tad");
    await app.reload();
    await app.getByRole("button", { name: "Settings" }).click();
    await expect(app.getByRole("textbox", { name: /Glossary/ })).toHaveValue("Tadhg = Tad");
});
