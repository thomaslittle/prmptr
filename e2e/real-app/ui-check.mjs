// Drives the real PRMPTR window over CDP: clicks Start, plays a WAV through
// the speakers, waits for the live feed, clicks Stop, then opens the model
// picker and checks OpenCode's catalog is visible.
//
//   node e2e/real-app/ui-check.mjs
import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import { resolve } from "node:path";

const wav = resolve("src-tauri/tests/fixtures/speech-16k.wav");
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const page = browser.contexts()[0].pages().find((p) => !p.url().includes("overlay")) ?? browser.contexts()[0].pages()[0];
const results = {};
const check = (name, ok, detail) => {
    results[name] = ok;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const play = (file) =>
    new Promise((done, fail) =>
        execFile("powershell", ["-NoProfile", "-Command", `(New-Object Media.SoundPlayer '${file}').PlaySync()`], (e) =>
            e ? fail(e) : done()
        )
    );

page.on("console", (m) => {
    if (m.type() === "error") console.log(`  [console] ${m.text()}`);
});

// A previous run may have left a session running.
const stop = page.getByRole("button", { name: /^Stop$/ });
if (await stop.isVisible().catch(() => false)) {
    await stop.click();
    await page.waitForTimeout(600);
}

// 1. Model picker: OpenCode's models must be offered under Your AI apps.
const picker = page.getByRole("button", { name: /LM Studio|Select a model|Claude|GPT|Grok/ }).first();
await picker.click();
await page.getByRole("button", { name: "Your AI apps" }).click();
const list = page.getByRole("listbox", { name: "Models" });
const opencodeRows = await list.getByText(/OpenCode/).count();
const sample = await list.getByText("DeepSeek V4.1 Flash").count();
check("picker shows OpenCode models", opencodeRows > 0 || sample > 0, `${opencodeRows} OpenCode-labelled rows, sample=${sample}`);
await page.keyboard.press("Escape");

// 2. The real Start button, then audio through the speakers.
const start = page.getByRole("button", { name: /^Start$/ });
await start.click();
const running = page.getByRole("button", { name: /^Stop$/ });
// A cold model load can take a while on the first run of the day.
const started = await running
    .waitFor({ state: "visible", timeout: 60000 })
    .then(() => true)
    .catch(() => false);
check("Start button starts capture", started);
await page.waitForTimeout(900);

await play(wav);
const heard = page.getByText(/Kubernetes|quarterly/i).first();
const ok = await heard.isVisible({ timeout: 20000 }).catch(() => false);
check("live feed shows the played sentence", ok);

await running.click();
await page.waitForTimeout(500);
check("Stop button ends capture", await page.getByRole("button", { name: /^Start$/ }).isVisible({ timeout: 5000 }).catch(() => false));

await browser.close();
const failed = Object.entries(results).filter(([, ok]) => !ok);
console.log(failed.length ? `\n${failed.length} check(s) failed` : "\nall checks passed");
process.exit(failed.length ? 1 : 0);
