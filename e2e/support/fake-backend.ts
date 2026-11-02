/**
 * In-page stand-in for the Rust backend.
 *
 * Installed with `page.addInitScript` before any app code runs. It implements
 * the same `window.__TAURI_INTERNALS__` contract `@tauri-apps/api` 2.x uses
 * (invoke / transformCallback / event plugin), so the production bundle runs
 * unmodified, exactly as it does inside the Tauri webview. Commands answer
 * from a configurable in-memory state; every call is recorded so tests can
 * assert on what the UI sent to Rust; tests push backend events (transcripts,
 * download progress, crashes) with `window.__e2e.emit`. Channel-based commands
 * (`local_ai_complete`) stream back through `__TAURI_INTERNALS__.runCallback`
 * with the same `{ index, message }` / `{ index, end }` frames real IPC uses.
 */

export interface SttModelFixture {
    id: string;
    name: string;
    description: string;
    languages: string;
    size_mb: number;
    installed: boolean;
    selected: boolean;
    recommended: boolean;
}

/** Mirrors `LocalAiModel` in src-tauri/src/local_ai.rs (camelCase over IPC). */
export interface LocalAiModelFixture {
    routeId: string;
    modelId: string;
    revision: string;
    nativeId: string;
    name: string;
    providerId: string;
    providerName: string;
    isDefault: boolean;
    supportsImageInput: boolean;
}

export const DEFAULT_LOCAL_AI_MODELS: LocalAiModelFixture[] = [
    {
        routeId: "r-claude",
        modelId: "m-haiku",
        revision: "1",
        nativeId: "claude-haiku-5-5",
        name: "Claude Haiku 5.5",
        providerId: "claude_code",
        providerName: "Claude Code",
        isDefault: true,
        supportsImageInput: true,
    },
];

/** 1×1 transparent PNG. */
export const TINY_PNG_DATA_URL =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export interface FakeBackendConfig {
    audioDevices: Array<{ name: string; is_default: boolean }>;
    sttModels: SttModelFixture[];
    gpu: { can_use_gpu: boolean; gpu_backends: string[]; devices: Array<{ kind: string; name: string; is_gpu: boolean }>; message: string };
    /** What `local_ai_models` returns (Your AI apps via OriginLM). */
    localAiModels: LocalAiModelFixture[];
    /** Text `local_ai_complete` streams back, split into several deltas. */
    localAiReply: string;
    /** Delay between streamed deltas, ms. */
    localAiDeltaDelayMs: number;
    /** What `capture_screenshot` returns (`null` makes it reject). */
    screenshotDataUrl: string | null;
    /** Pre-seeded secret store (provider keys etc.). */
    secrets: Record<string, unknown> | null;
    /** Commands that should reject, with the error message. */
    failCommands: Record<string, string>;
    validKeys: Record<string, string>;
}

export const DEFAULT_STT_MODELS: SttModelFixture[] = [
    {
        id: "parakeet-unified-en",
        name: "Parakeet Unified (English)",
        description: "Recommended — best English accuracy, punctuated, fast on any CPU",
        languages: "English",
        size_mb: 731,
        installed: true,
        selected: true,
        recommended: true,
    },
    {
        id: "parakeet-v3",
        name: "Parakeet v3 (Multilingual)",
        description: "25 European languages with automatic language detection",
        languages: "25 European languages",
        size_mb: 739,
        installed: false,
        selected: false,
        recommended: false,
    },
    {
        id: "moonshine-streaming-small",
        name: "Moonshine Small (English)",
        description: "Lightweight 200 MB model for older or low-power machines",
        languages: "English",
        size_mb: 198,
        installed: false,
        selected: false,
        recommended: false,
    },
];

export const DEFAULT_CONFIG: FakeBackendConfig = {
    audioDevices: [
        { name: "Studio Mic (input)", is_default: true },
        { name: "Speakers (output)", is_default: true },
    ],
    sttModels: DEFAULT_STT_MODELS,
    gpu: {
        can_use_gpu: false,
        gpu_backends: [],
        devices: [{ kind: "cpu", name: "Test CPU", is_gpu: false }],
        message: "This build runs speech recognition on the CPU.",
    },
    localAiModels: DEFAULT_LOCAL_AI_MODELS,
    localAiReply: "Sounds good. Ask about the timeline next.",
    localAiDeltaDelayMs: 20,
    screenshotDataUrl: TINY_PNG_DATA_URL,
    secrets: null,
    failCommands: {},
    validKeys: {},
};

/** Serializable body of the init script; `config` is injected as its argument. */
export function installFakeBackend(config: FakeBackendConfig): void {
    type Json = Record<string, unknown>;
    const state = {
        config,
        calls: [] as Array<{ cmd: string; args: Json }>,
        listeners: new Map<string, number[]>(),
        callbacks: new Map<number, (data: unknown) => void>(),
        stores: new Map<number, Map<string, unknown>>(),
        nextRid: 1,
        nextCallback: 1,
        localRunning: false,
        overlayPublishes: [] as Json[],
        overlay: {
            enabled: false,
            visible: false,
            config: { width: 420, height: 320, clickThrough: false, autoShowOnResponse: true, captureProtected: true } as Json,
            content: { responses: [], currentResponse: "", isStreaming: false, appearance: { opacity: 0.9, fontScale: 1 } } as Json,
        },
        deepgramRunning: false,
        mutes: { input: false, output: false },
        /** requestId → cancel hook for in-flight `local_ai_complete` calls. */
        localAiRunning: new Map<string, () => void>(),
    };

    const w = window as unknown as Json & {
        __TAURI_INTERNALS__: Json;
        __TAURI_EVENT_PLUGIN_INTERNALS__: Json;
        __e2e: Json;
        __PRMPTR_E2E_NATIVE_FETCH__: boolean;
    };

    function emit(event: string, payload: unknown) {
        for (const id of state.listeners.get(event) ?? []) {
            state.callbacks.get(id)?.({ event, id, payload });
        }
    }

    /** Callback id of a `Channel` argument (instance or its `__CHANNEL__:<id>` form). */
    function channelId(arg: unknown): number {
        if (typeof arg === "string" && arg.startsWith("__CHANNEL__:")) return Number(arg.slice("__CHANNEL__:".length));
        const id = (arg as { id?: unknown } | null)?.id;
        if (typeof id === "number") return id;
        throw "fake backend: expected a Channel argument";
    }

    /** Deliver channel frames exactly like Tauri's IPC: `{ index, message }`, then `{ index, end }`. */
    function channelSender(id: number) {
        let index = 0;
        const run = (data: unknown) => (w.__TAURI_INTERNALS__.runCallback as (id: number, data: unknown) => void)(id, data);
        return {
            send: (message: unknown) => run({ index: index++, message }),
            end: () => run({ index, end: true }),
        };
    }

    function splitIntoDeltas(text: string): string[] {
        const parts = text.match(/\S+\s*/g) ?? [];
        return parts.length > 0 ? parts : text ? [text] : [];
    }

    async function localAiComplete(args: Json): Promise<string> {
        const channel = channelSender(channelId(args.onEvent));
        const selection = args.selection as { routeId?: string; modelId?: string; revision?: string } | undefined;
        if (!selection?.routeId || !selection.modelId || typeof selection.revision !== "string") {
            throw "invalid args `selection` for command `local_ai_complete`";
        }
        if (typeof args.prompt !== "string" || !args.prompt.trim()) throw "Empty prompt";
        const known = state.config.localAiModels.some(
            (m) => m.routeId === selection.routeId && m.modelId === selection.modelId
        );
        if (!known) throw "That model is no longer available — refresh the model list";

        const requestId = String(args.requestId);
        let cancelled = false;
        state.localAiRunning.set(requestId, () => {
            cancelled = true;
        });
        try {
            let text = "";
            for (const delta of splitIntoDeltas(state.config.localAiReply)) {
                await new Promise((r) => setTimeout(r, state.config.localAiDeltaDelayMs));
                if (cancelled) throw "Cancelled";
                text += delta;
                channel.send({ type: "delta", text: delta });
            }
            return text;
        } finally {
            state.localAiRunning.delete(requestId);
            channel.end();
        }
    }

    function secretStoreFor(path: string): number {
        const rid = state.nextRid++;
        const map = new Map<string, unknown>();
        if (path.includes("secrets") && state.config.secrets) map.set("secrets", state.config.secrets);
        state.stores.set(rid, map);
        return rid;
    }

    async function handle(cmd: string, args: Json): Promise<unknown> {
        const fail = state.config.failCommands[cmd];
        if (fail) throw fail;
        switch (cmd) {
            // ── Tauri event plugin ──
            case "plugin:event|listen": {
                const list = state.listeners.get(args.event as string) ?? [];
                list.push(args.handler as number);
                state.listeners.set(args.event as string, list);
                return args.handler;
            }
            case "plugin:event|unlisten": {
                const list = state.listeners.get(args.event as string) ?? [];
                state.listeners.set(args.event as string, list.filter((id) => id !== args.eventId));
                return null;
            }
            case "plugin:event|emit":
                emit(args.event as string, args.payload);
                return null;

            // ── Store plugin (secrets) ──
            case "plugin:store|load":
                return secretStoreFor(String(args.path));
            case "plugin:store|get_store":
                return null;
            case "plugin:store|get": {
                const map = state.stores.get(args.rid as number);
                const has = !!map?.has(args.key as string);
                return [has ? map!.get(args.key as string) : null, has];
            }
            case "plugin:store|set":
                state.stores.get(args.rid as number)?.set(args.key as string, args.value);
                if (args.key === "secrets") state.config.secrets = args.value as Json;
                return null;
            case "plugin:store|has":
                return !!state.stores.get(args.rid as number)?.has(args.key as string);
            case "plugin:store|delete":
                return state.stores.get(args.rid as number)?.delete(args.key as string) ?? false;
            case "plugin:store|save":
            case "plugin:store|reload":
            case "plugin:store|clear":
            case "plugin:store|reset":
                return null;

            // ── Global shortcuts ──
            case "plugin:global-shortcut|register":
            case "plugin:global-shortcut|unregister":
            case "plugin:global-shortcut|unregister_all":
                return null;
            case "plugin:global-shortcut|is_registered":
                return false;

            // ── Audio ──
            case "list_system_audio_devices":
            case "get_audio_devices":
                return state.config.audioDevices;

            // ── Sessions / templates ──
            case "start_session":
                return null;
            case "end_session":
                return { duration_secs: 1, response_count: 0 };
            case "load_templates":
                return [];
            case "get_transcript":
                return [];
            case "clear_transcript":
                return null;

            // ── Keys ──
            case "validate_api_key":
                return state.config.validKeys[args.provider as string] === args.apiKey;
            case "fetch_lmstudio_models":
                return [];

            // ── Local speech-to-text ──
            case "list_stt_models":
                return state.config.sttModels;
            case "get_selected_stt_model":
                return state.config.sttModels.find((m) => m.selected)?.id ?? "parakeet-unified-en";
            case "set_selected_stt_model":
                state.config.sttModels = state.config.sttModels.map((m) => ({ ...m, selected: m.id === args.modelId }));
                return null;
            case "download_stt_model": {
                const id = args.modelId as string;
                for (const percent of [0, 35, 70, 99]) {
                    emit("stt-model-download-progress", {
                        model_id: id,
                        stage: percent === 99 ? "Verifying…" : "Downloading…",
                        percent,
                        downloaded_bytes: percent * 1000,
                        total_bytes: 100_000,
                    });
                    await new Promise((r) => setTimeout(r, 60));
                }
                state.config.sttModels = state.config.sttModels.map((m) =>
                    m.id === id ? { ...m, installed: true, selected: true } : { ...m, selected: false }
                );
                emit("stt-model-download-progress", { model_id: id, stage: "Complete", percent: 100, downloaded_bytes: 100_000, total_bytes: 100_000 });
                return null;
            }
            case "get_local_transcription_gpu_status":
                return state.config.gpu;
            case "start_local_transcription": {
                const selected = state.config.sttModels.find((m) => m.selected);
                if (!selected?.installed) {
                    throw `Speech model '${selected?.name ?? "?"}' is not downloaded yet. Open Settings → Capture and download it (${selected?.size_mb ?? 0} MB).`;
                }
                state.localRunning = true;
                state.mutes = { input: !!args.muteInput, output: !!args.muteOutput };
                return null;
            }
            case "stop_local_transcription":
                state.localRunning = false;
                return null;
            case "set_local_mute":
                state.mutes[args.channel as "input" | "output"] = !!args.muted;
                return null;
            case "get_local_activity":
                return { input_level: 0, output_level: 0, input_muted: state.mutes.input, output_muted: state.mutes.output, running: state.localRunning };

            // ── Deepgram ──
            case "start_direct_deepgram_transcription":
                state.deepgramRunning = true;
                return null;
            case "update_direct_deepgram_transcription":
                return null;
            case "stop_direct_deepgram_transcription":
                state.deepgramRunning = false;
                return null;
            case "set_deepgram_mute":
                return null;

            // ── Your AI apps (OriginLM) ──
            case "local_ai_models":
                return state.config.localAiModels;
            case "local_ai_complete":
                return localAiComplete(args);
            case "local_ai_cancel":
                state.localAiRunning.get(String(args.requestId))?.();
                return null;

            // ── Screenshot ──
            case "capture_screenshot":
                if (!state.config.screenshotDataUrl) throw "Screen capture unavailable";
                return state.config.screenshotDataUrl;

            // ── Overlay (mirrors src-tauri/src/overlay/mod.rs semantics) ──
            case "set_overlay_enabled":
                state.overlay.enabled = !!args.enabled;
                state.overlay.visible = !!args.enabled;
                state.overlay.config = { ...(args.config as Json) };
                return overlaySnapshot();
            case "apply_overlay_config":
                state.overlay.config = { ...(args.config as Json) };
                return overlaySnapshot();
            case "toggle_overlay_visibility":
                if (!state.overlay.enabled) throw "Overlay is disabled. Enable it explicitly before showing it.";
                state.overlay.visible = !state.overlay.visible;
                return overlaySnapshot();
            case "hide_overlay":
                state.overlay.visible = false;
                return overlaySnapshot();
            case "center_overlay":
                return overlaySnapshot();
            case "set_overlay_click_through":
                if (!state.overlay.enabled) throw "Overlay is disabled; click-through has no active runtime.";
                state.overlay.config = { ...state.overlay.config, clickThrough: !!args.enabled };
                return overlaySnapshot();
            case "publish_overlay_content":
                state.overlay.content = args.content as Json;
                state.overlayPublishes.push(args.content as Json);
                return overlaySnapshot();
            case "get_overlay_state":
                return overlaySnapshot();

            // ── Misc ──
            case "open_external_url":
            case "proxy_tts_list_voices":
                return cmd === "proxy_tts_list_voices" ? [] : null;
            case "proxy_tts_synthesize":
                return { audio_base64: null, mime: null, json: null };
            default:
                if (cmd.startsWith("plugin:window|") || cmd.startsWith("plugin:webview|") || cmd.startsWith("plugin:app|")) return null;
                throw `fake backend: unhandled command ${cmd}`;
        }
    }

    function overlaySnapshot(): Json {
        return {
            enabled: state.overlay.enabled,
            windowExists: state.overlay.enabled,
            visible: state.overlay.visible,
            clickThrough: !!state.overlay.config.clickThrough,
            captureProtected: !!state.overlay.config.captureProtected,
            capabilities: {
                platform: "windows",
                transparencySupported: true,
                alwaysOnTopSupported: true,
                clickThroughSupported: true,
                captureProtectionSupported: true,
                globalPositionPersistenceSupported: true,
            },
            config: state.overlay.config,
            content: state.overlay.content,
        };
    }

    w.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
        invoke: async (cmd: string, args: Json = {}) => {
            state.calls.push({ cmd, args: JSON.parse(JSON.stringify(args ?? {})) });
            return handle(cmd, args ?? {});
        },
        transformCallback: (callback: (data: unknown) => void, once = false) => {
            const id = state.nextCallback++;
            state.callbacks.set(id, (data) => {
                if (once) state.callbacks.delete(id);
                callback?.(data);
            });
            return id;
        },
        unregisterCallback: (id: number) => state.callbacks.delete(id),
        runCallback: (id: number, data: unknown) => state.callbacks.get(id)?.(data),
        callbacks: state.callbacks,
        convertFileSrc: (path: string) => path,
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: (_event: string, id: number) => state.callbacks.delete(id),
    };
    w.__PRMPTR_E2E_NATIVE_FETCH__ = true;
    w.__e2e = {
        emit,
        calls: (cmd?: string) => (cmd ? state.calls.filter((c) => c.cmd === cmd) : state.calls),
        state: () => ({
            localRunning: state.localRunning,
            mutes: state.mutes,
            secrets: state.config.secrets,
            localAiRunning: [...state.localAiRunning.keys()],
            overlay: { enabled: state.overlay.enabled, visible: state.overlay.visible, content: state.overlay.content },
            overlayPublishes: state.overlayPublishes,
        }),
    };
}
