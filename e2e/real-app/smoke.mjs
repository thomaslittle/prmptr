// Real-app smoke test: drives the actual PRMPTR desktop build (real Rust, real
// IPC, real models) over WebView2's DevTools protocol.
//
//   npx tauri build --debug --no-bundle --config e2e/support/tauri.cdp.conf.json
//   (launch src-tauri/target/debug/prmptr.exe with the Parakeet model installed)
//   node e2e/real-app/smoke.mjs [path/to/speech.wav]
//
// Plays the WAV through the default speakers and expects the on-device engine
// to transcribe it from the system-audio loopback. Set PRMPTR_SMOKE_LLM=1 to
// also run one tiny turn through the first "Your AI apps" model.
import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import { resolve } from "node:path";

const wav = resolve(process.argv[2] ?? "src-tauri/tests/fixtures/speech-16k.wav");
const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
const page = browser.contexts()[0].pages().find((p) => !p.url().includes("overlay")) ?? browser.contexts()[0].pages()[0];
const results = {};
const check = (name, ok, detail) => {
    results[name] = { ok, detail };
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const inv = (cmd, args) => page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [cmd, args ?? {}]);

/** Is a CLI installed? Only used to decide whether a check is meaningful. */
const hasCommand = (cmd) =>
    new Promise((done) => {
        execFile(process.platform === "win32" ? "where" : "which", [cmd], (error) => done(!error));
    });

console.log(`app: ${page.url()}`);
check("static bundle served by Tauri (no dev server)", !page.url().includes("43110"), page.url());

const models = await inv("list_stt_models");
const active = models.find((m) => m.selected);
check("speech model catalog", models.length >= 5 && active?.installed, `${active?.name} active, ${models.length} models`);
const templates = await inv("load_templates");
check("bundled session templates", templates.length >= 6, templates.map((t) => t.name).join(", "));
const devices = await inv("list_system_audio_devices");
check("audio devices", devices.length > 0, `${devices.length} devices`);
const gpu = await inv("get_local_transcription_gpu_status");
console.log(`      gpu: ${gpu.message}`);

// OriginLM: discover the AI apps on this machine.
const t0 = Date.now();
const localAi = await inv("local_ai_models").catch((e) => ({ error: String(e) }));
if (Array.isArray(localAi)) {
    const byApp = {};
    for (const m of localAi) byApp[m.providerName] = (byApp[m.providerName] ?? 0) + 1;
    check("Your AI apps (OriginLM) scan", true, `${localAi.length} models in ${Date.now() - t0} ms: ${JSON.stringify(byApp)}`);
    // When the OpenCode CLI is installed, its models must appear too: the
    // adapter needs the native binary behind the npm shim, and OpenCode 2
    // reports credentials as configured-but-unverified.
    const opencode = Object.entries(byApp).find(([name]) => name.startsWith("OpenCode"));
    check(
        "OpenCode models via OriginLM",
        !(await hasCommand("opencode")) || Boolean(opencode),
        opencode ? `${opencode[1]} models` : "OpenCode CLI not installed"
    );
} else {
    check("Your AI apps (OriginLM) scan", false, localAi.error);
}

// Real transcription through the system-audio loopback.
const output = devices.find((d) => d.name.endsWith("(output)") && d.is_default) ?? devices.find((d) => d.name.endsWith("(output)"));
const input = devices.find((d) => d.name.endsWith("(input)") && d.is_default) ?? devices.find((d) => d.name.endsWith("(input)"));
await page.evaluate(() => {
    window.__smoke = { lines: [], status: [] };
    const i = window.__TAURI_INTERNALS__;
    const on = (event, sink) =>
        i.invoke("plugin:event|listen", { event, target: { kind: "Any" }, handler: i.transformCallback((e) => sink.push(e.payload)) });
    return Promise.all([on("local-transcription", window.__smoke.lines), on("local-transcription-status", window.__smoke.status)]);
});
const startedAt = Date.now();
const GLOSSARY = ["Saoirse = Sayers", "Tadhg = Tad", "Kubeflow", "Grafana", "Qdrant = Drant"];
await inv("start_local_transcription", { inputDeviceName: input?.name ?? null, outputDeviceName: output?.name ?? null, muteInput: true, muteOutput: false, preferGpu: false, glossary: GLOSSARY });
check("local capture starts (model load)", true, `${Date.now() - startedAt} ms, loopback on "${output?.name}"`);
await new Promise((r) => setTimeout(r, 800));
await new Promise((res, rej) =>
    execFile("powershell", ["-NoProfile", "-Command", `(New-Object Media.SoundPlayer '${wav}').PlaySync()`], (e) => (e ? rej(e) : res()))
);
// The VAD may split the clip at its natural pause; wait for the last word.
let lines = [];
for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    lines = await page.evaluate(() => window.__smoke.lines.filter((l) => l.is_final));
    if (/friday/i.test(lines.map((l) => l.text).join(" "))) break;
}
const heard = lines.map((l) => l.text).join(" ");
check(
    "speakers → loopback → Silero VAD v6.2 → Parakeet → UI event",
    /quarterly/i.test(heard) && /kubernetes/i.test(heard),
    `[${lines.map((l) => l.device_type).join(",")}] "${heard}"`
);
// Hard names through the same live path, corrected by the glossary.
const namesWav = resolve("src-tauri/tests/fixtures/names-16k.wav");
const before = lines.length;
await new Promise((res, rej) =>
    execFile("powershell", ["-NoProfile", "-Command", `(New-Object Media.SoundPlayer '${namesWav}').PlaySync()`], (e) => (e ? rej(e) : res()))
);
let named = [];
for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    named = (await page.evaluate(() => window.__smoke.lines.filter((l) => l.is_final))).slice(before);
    if (/Thursday/i.test(named.map((l) => l.text).join(" "))) break;
}
const namedText = named.map((l) => l.text).join(" ");
check(
    "glossary: biasing + mishearing rewrites on live audio",
    ["Saoirse", "Tadhg", "Kubeflow", "Grafana", "Qdrant"].every((t) => namedText.includes(t)),
    `"${namedText}"`
);

const crashes = await page.evaluate(() => window.__smoke.status);
check("no worker crash events", crashes.length === 0, crashes.length ? JSON.stringify(crashes) : "");
await inv("stop_local_transcription");

if (process.env.PRMPTR_SMOKE_LLM && Array.isArray(localAi) && localAi.length) {
    const runTurn = (model) =>
        page.evaluate(async (m) => {
            const i = window.__TAURI_INTERNALS__;
            let streamed = "";
            const id = i.transformCallback((msg) => {
                const payload = msg?.message ?? msg;
                if (payload?.type === "delta") streamed += payload.text;
            });
            const started = performance.now();
            const final = await i.invoke("local_ai_complete", {
                onEvent: `__CHANNEL__:${id}`,
                selection: { routeId: m.routeId, modelId: m.modelId, revision: m.revision },
                prompt: "Reply with exactly one word: ready",
                requestId: `smoke-${Date.now()}`,
                imageDataUrl: null,
            });
            return { final, streamed, ms: Math.round(performance.now() - started) };
        }, model).catch((e) => ({ error: String(e) }));

    const model = localAi.find((m) => /haiku|mini|flash|small/i.test(m.nativeId)) ?? localAi.find((m) => m.isDefault) ?? localAi[0];
    const reply = await runTurn(model);
    check(
        `live turn via ${model.providerName} (${model.nativeId})`,
        !reply.error && /ready/i.test(reply.final ?? ""),
        reply.error ?? `"${reply.final.trim()}" in ${reply.ms} ms (streamed ${reply.streamed.length} chars)`
    );

    // OpenCode runs through its own local service, so prove that path too.
    const opencode = localAi.find((m) => m.providerId === "opencode" && /free|flash|mini/i.test(m.nativeId));
    if (opencode) {
        const reply = await runTurn(opencode);
        check(
            `live turn via ${opencode.providerName} (${opencode.nativeId})`,
            !reply.error && /ready/i.test(reply.final ?? ""),
            reply.error ?? `"${reply.final.trim()}" in ${reply.ms} ms (streamed ${reply.streamed.length} chars)`
        );
    }
}

await browser.close();
const failed = Object.entries(results).filter(([, r]) => !r.ok);
console.log(failed.length ? `\n${failed.length} check(s) failed` : "\nall checks passed");
process.exit(failed.length ? 1 : 0);
