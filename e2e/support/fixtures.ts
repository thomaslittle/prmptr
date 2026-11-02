import { test as base, expect, type Page, type Route } from "@playwright/test";
import { DEFAULT_CONFIG, installFakeBackend, type FakeBackendConfig } from "./fake-backend";

export { expect };

type Recorded = { cmd: string; args: Record<string, unknown> };

export interface Backend {
    /** Push a backend → UI event (e.g. a transcript line). */
    emit(event: string, payload: unknown): Promise<void>;
    /** Commands the UI invoked (optionally filtered). */
    calls(cmd?: string): Promise<Recorded[]>;
    state(): Promise<{
        localRunning: boolean;
        mutes: { input: boolean; output: boolean };
        secrets: unknown;
        /** requestIds of in-flight `local_ai_complete` calls. */
        localAiRunning: string[];
        overlay: { enabled: boolean; visible: boolean; content: { currentResponse: string; isStreaming: boolean; responses: Array<{ content: string }> } };
        overlayPublishes: Array<{ currentResponse: string; isStreaming: boolean; responses: Array<{ content: string }> }>;
    }>;
}

interface Options {
    backendConfig: Partial<FakeBackendConfig>;
    /** localStorage entries seeded before the app boots. */
    storage: Record<string, unknown>;
}

export const test = base.extend<Options & { backend: Backend; app: Page }>({
    backendConfig: [{}, { option: true }],
    storage: [{}, { option: true }],
    backend: async ({ page }, use) => {
        await use({
            emit: (event, payload) =>
                page.evaluate(([e, p]) => (window as unknown as { __e2e: { emit: (e: string, p: unknown) => void } }).__e2e.emit(e as string, p), [event, payload] as const),
            calls: (cmd) =>
                page.evaluate((c) => (window as unknown as { __e2e: { calls: (c?: string) => Recorded[] } }).__e2e.calls(c ?? undefined), cmd ?? null),
            state: () => page.evaluate(() => (window as unknown as { __e2e: { state: () => never } }).__e2e.state()),
        });
    },
    app: async ({ page, backendConfig, storage }, use) => {
        const config: FakeBackendConfig = structuredClone({ ...DEFAULT_CONFIG, ...backendConfig });
        await page.addInitScript(installFakeBackend, config);
        await page.addInitScript((entries) => {
            if (sessionStorage.getItem("__e2e_seeded")) return;
            sessionStorage.setItem("__e2e_seeded", "1");
            for (const [key, value] of Object.entries(entries)) {
                localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
            }
        }, storage);
        // Nothing may leave the machine unless a test explicitly allows it.
        await page.route(/^https?:\/\/(?!127\.0\.0\.1:43120)/, (route) =>
            route.abort("blockedbyclient")
        );
        const errors: string[] = [];
        page.on("pageerror", (err) => errors.push(err.message));
        // The static export renders clickable HTML before React hydrates; a
        // click in that window is lost. On the dashboard, wait for a control
        // that only renders after hydration (the overlay toggle) first.
        const goto = page.goto.bind(page);
        page.goto = async (url, options) => {
            const response = await goto(url, options);
            if (new URL(url, "http://x").pathname === "/") {
                await page.getByRole("button", { name: /^Overlay (on|off)$/ }).waitFor();
            }
            return response;
        };
        await use(page);
        expect(errors, "uncaught page errors").toEqual([]);
    },
});

/** Build a server-sent-event body from data payloads. */
export function sse(events: Array<unknown | string>): string {
    return events.map((e) => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\n\n`).join("");
}

export function anthropicStream(text: string): string {
    const chunks = text.match(/[\s\S]{1,12}/g) ?? [];
    return sse([
        { type: "message_start", message: { id: "msg_1", role: "assistant", content: [] } },
        { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "secret reasoning" } },
        { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
        ...chunks.map((t) => ({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: t } })),
        { type: "message_delta", delta: { stop_reason: "end_turn" } },
        { type: "message_stop" },
    ]);
}

export function openAiStream(text: string): string {
    const chunks = text.match(/[\s\S]{1,10}/g) ?? [];
    return sse([...chunks.map((t) => ({ choices: [{ delta: { content: t } }] })), "[DONE]"]);
}

/** Intercept a provider endpoint (overrides the default block for that URL). */
export async function routeProvider(
    page: Page,
    url: string | RegExp,
    handler: (route: Route) => Promise<void> | void
): Promise<void> {
    await page.route(url, handler);
}

/** Emit a finalized local transcript line from the fake Rust engine. */
export function transcript(id: string, text: string, device: "input" | "output" = "output") {
    return {
        id,
        text,
        is_final: true,
        timestamp: new Date().toISOString(),
        device_type: device,
        speaker_id: null,
        speaker_label: null,
    };
}
