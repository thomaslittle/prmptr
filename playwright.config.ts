import { defineConfig, devices } from "@playwright/test";

const PORT = 43120;

/**
 * End-to-end tests run against the production static export (`out/`) — the
 * exact bundle the desktop app ships — with the Rust backend replaced by an
 * in-page IPC fake (e2e/support/fake-backend.ts) and provider APIs
 * intercepted at the network layer. Build first: `npm run build`.
 */
export default defineConfig({
    testDir: "./e2e",
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
    timeout: 30_000,
    expect: { timeout: 7_000 },
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        viewport: { width: 1400, height: 900 },
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1400, height: 900 } } }],
    webServer: {
        command: `node e2e/support/static-server.mjs out ${PORT}`,
        url: `http://127.0.0.1:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
});
