// Real-app overlay check over WebView2 CDP (see smoke.mjs for setup):
// enables the overlay from the main window, confirms the native overlay
// window exists and is visible, runs the built-in "Test overlay" preview, and
// verifies the overlay webview rendered the streamed + completed content.
import { chromium } from "@playwright/test";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const pages = () => browser.contexts().flatMap((c) => c.pages());
const main = pages().find((p) => !p.url().includes("overlay"));
const results = [];
const check = (name, ok, detail = "") => {
    results.push(ok);
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

await main.getByRole("button", { name: /^Overlay (on|off)$/ }).waitFor();
if (await main.getByRole("button", { name: "Overlay off" }).isVisible()) {
    await main.getByRole("button", { name: "Overlay off" }).click();
}
await main.getByRole("button", { name: "Overlay on" }).waitFor();
const state = await main.evaluate(() => window.__TAURI_INTERNALS__.invoke("get_overlay_state"));
check("native overlay window created and visible", state.windowExists && state.visible, `capture-protected=${state.captureProtected} click-through=${state.clickThrough}`);

let overlay;
for (let i = 0; i < 40 && !overlay; i++) {
    overlay = pages().find((p) => p.url().includes("overlay"));
    if (!overlay) await new Promise((r) => setTimeout(r, 250));
}
check("overlay webview loaded from the static bundle", !!overlay, overlay?.url());

if (!(await main.getByRole("button", { name: "Test overlay" }).isVisible())) {
    await main.getByRole("button", { name: "Tune" }).click();
}
await main.getByRole("button", { name: "Test overlay" }).click();
const live = await overlay.getByText("Live response").waitFor({ timeout: 5000 }).then(() => true, () => false);
check("overlay shows the streamed response", live);
const done = await overlay.getByText("Overlay preview complete.").waitFor({ timeout: 5000 }).then(() => true, () => false);
check("overlay shows the completed response", done);
await overlay.screenshot({ path: process.env.OVERLAY_SHOT ?? "test-results/real-overlay.png" });

// Shortcut path: Hide via the main window control, then show again.
await main.getByRole("button", { name: "Hide", exact: true }).click();
const hidden = await main.evaluate(() => window.__TAURI_INTERNALS__.invoke("get_overlay_state"));
check("hide", !hidden.visible);
await main.getByRole("button", { name: "Show", exact: true }).click();
const shown = await main.evaluate(() => window.__TAURI_INTERNALS__.invoke("get_overlay_state"));
check("show", shown.visible);

await browser.close();
const failed = results.filter((ok) => !ok).length;
console.log(failed ? `\n${failed} check(s) failed` : "\nall overlay checks passed");
process.exit(failed ? 1 : 0);
