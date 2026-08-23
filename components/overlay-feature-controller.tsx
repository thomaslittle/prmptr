"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@/lib/tauri";
import {
    applyOverlayConfig,
    centerOverlay,
    normalizeOverlayProjection,
    onOverlayRuntimeState,
    publishOverlayContent,
    setOverlayClickThrough,
    setOverlayEnabled,
    toggleOverlayVisibility,
    type OverlayContent,
} from "@/lib/overlay";
import { overlayWindowConfig, useOverlayStore } from "@/lib/stores/overlay-store";
import { useSessionStore } from "@/lib/stores/session-store";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function OverlayFeatureController() {
    const preferences = useOverlayStore((state) => state.preferences);
    const runtime = useOverlayStore((state) => state.runtime);
    const lastError = useOverlayStore((state) => state.lastError);
    const updatePreferences = useOverlayStore((state) => state.update);
    const applyRuntime = useOverlayStore((state) => state.applyRuntime);
    const setLastError = useOverlayStore((state) => state.setLastError);
    const responses = useSessionStore((state) => state.responses);
    const currentResponse = useSessionStore((state) => state.currentResponse);
    const isStreaming = useSessionStore((state) => state.isStreaming);
    const sessionId = useSessionStore((state) => state.currentSessionId);
    const initialized = useRef(false);
    const lastPayloadHash = useRef("");
    const previewGeneration = useRef(0);
    const previewActive = useRef(false);
    const [expanded, setExpanded] = useState(false);
    const [isPreviewing, setIsPreviewing] = useState(false);
    const desktopRuntime = isTauri();
    const nativeConfig = useMemo(() => overlayWindowConfig(preferences), [preferences]);

    const publishLiveSnapshot = useCallback(async (allowAutoShow = true) => {
        const overlayPreferences = useOverlayStore.getState().preferences;
        if (!overlayPreferences.enabled || previewActive.current) return;
        const session = useSessionStore.getState();
        const content = normalizeOverlayProjection({
            responses: session.responses,
            currentResponse: session.currentResponse,
            isStreaming: session.isStreaming,
            sessionId: session.currentSessionId,
            maxResponses: overlayPreferences.maxResponses,
            opacity: overlayPreferences.opacity,
            fontScale: overlayPreferences.fontScale,
        });
        const hash = JSON.stringify(content);
        if (hash === lastPayloadHash.current) return;
        lastPayloadHash.current = hash;
        try {
            applyRuntime(await publishOverlayContent(content, allowAutoShow));
            setLastError(null);
        } catch (error) {
            lastPayloadHash.current = "";
            setLastError(error instanceof Error ? error.message : String(error));
        }
    }, [applyRuntime, setLastError]);

    useEffect(() => {
        if (!desktopRuntime) return;
        let disposed = false;
        let unlisten: (() => void) | null = null;
        void (async () => {
            try {
                const state = await setOverlayEnabled(preferences.enabled, nativeConfig);
                if (!disposed) {
                    applyRuntime(state);
                    setLastError(null);
                    initialized.current = true;
                }
            } catch (error) {
                if (!disposed) setLastError(error instanceof Error ? error.message : String(error));
            }
            unlisten = await onOverlayRuntimeState((state) => {
                if (!disposed) applyRuntime(state);
            });
        })();
        return () => {
            disposed = true;
            previewGeneration.current += 1;
            unlisten?.();
        };
        // Initial ownership synchronization intentionally runs once.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [desktopRuntime]);

    useEffect(() => {
        if (!desktopRuntime || !initialized.current || !preferences.enabled) return;
        applyOverlayConfig(nativeConfig)
            .then((state) => {
                applyRuntime(state);
                setLastError(null);
            })
            .catch((error) => setLastError(error instanceof Error ? error.message : String(error)));
    }, [desktopRuntime, nativeConfig, preferences.enabled, applyRuntime, setLastError]);

    useEffect(() => {
        if (!desktopRuntime || !preferences.enabled || previewActive.current) return;
        void publishLiveSnapshot();
    }, [desktopRuntime, preferences.enabled, preferences.maxResponses, preferences.opacity, preferences.fontScale, responses, currentResponse, isStreaming, sessionId, publishLiveSnapshot]);

    useEffect(() => {
        if (preferences.enabled) return;
        previewGeneration.current += 1;
        previewActive.current = false;
        // Reset preview UI state asynchronously so a disable event does not
        // trigger a cascading synchronous re-render inside the effect.
        let cancelled = false;
        void Promise.resolve().then(() => {
            if (!cancelled) setIsPreviewing(false);
        });
        return () => {
            cancelled = true;
        };
    }, [preferences.enabled]);

    const toggleFeature = useCallback(async () => {
        try {
            if (preferences.enabled) previewGeneration.current += 1;
            const state = await setOverlayEnabled(!preferences.enabled, nativeConfig);
            applyRuntime(state);
            setExpanded(!preferences.enabled);
            setLastError(null);
        } catch (error) {
            setLastError(error instanceof Error ? error.message : String(error));
        }
    }, [preferences.enabled, nativeConfig, applyRuntime, setLastError]);

    const toggleVisible = useCallback(async () => {
        if (!preferences.enabled) return;
        try {
            applyRuntime(await toggleOverlayVisibility());
            setLastError(null);
        } catch (error) {
            setLastError(error instanceof Error ? error.message : String(error));
        }
    }, [preferences.enabled, applyRuntime, setLastError]);

    const toggleClickThrough = useCallback(async () => {
        if (!preferences.enabled) return;
        try {
            applyRuntime(await setOverlayClickThrough(!preferences.clickThrough));
            setLastError(null);
        } catch (error) {
            setLastError(error instanceof Error ? error.message : String(error));
        }
    }, [preferences.enabled, preferences.clickThrough, applyRuntime, setLastError]);

    const recoverPosition = useCallback(async () => {
        if (!preferences.enabled) return;
        try {
            applyRuntime(await centerOverlay());
            setLastError(null);
        } catch (error) {
            setLastError(error instanceof Error ? error.message : String(error));
        }
    }, [preferences.enabled, applyRuntime, setLastError]);

    const runPreview = useCallback(async () => {
        if (!useOverlayStore.getState().preferences.enabled || previewActive.current) return;
        const generation = ++previewGeneration.current;
        previewActive.current = true;
        setIsPreviewing(true);
        setLastError(null);

        const currentPreferences = useOverlayStore.getState().preferences;
        const appearance = {
            opacity: currentPreferences.opacity,
            fontScale: currentPreferences.fontScale,
        };
        const publishPreview = async (content: OverlayContent) => {
            if (generation !== previewGeneration.current || !useOverlayStore.getState().preferences.enabled) return false;
            applyRuntime(await publishOverlayContent(content));
            return true;
        };

        try {
            if (!await publishPreview({
                responses: [],
                currentResponse: "",
                isStreaming: true,
                sessionId: "overlay-preview",
                appearance,
            })) return;
            await delay(350);
            if (!await publishPreview({
                responses: [],
                currentResponse: "PRMPTR is streaming this overlay preview through the same native response channel used during a real session…",
                isStreaming: true,
                sessionId: "overlay-preview",
                appearance,
            })) return;
            await delay(750);
            if (!await publishPreview({
                responses: [{
                    id: `overlay-preview-${Date.now()}`,
                    content: "**Overlay preview complete.** Drag or resize this window, try click-through, then use **Center / recover window** if needed.",
                    timestamp: new Date().toISOString(),
                    model: "PRMPTR self-test",
                    kind: "analysis",
                }],
                currentResponse: "",
                isStreaming: false,
                sessionId: "overlay-preview",
                appearance,
            })) return;
            await delay(1800);
        } catch (error) {
            setLastError(`Overlay preview failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            if (generation === previewGeneration.current) {
                previewActive.current = false;
                setIsPreviewing(false);
                lastPayloadHash.current = "";
                // Restoring real application content is synchronization, not a
                // new response. Respect a tester who hid the preview window.
                await publishLiveSnapshot(false);
            }
        }
    }, [applyRuntime, publishLiveSnapshot, setLastError]);

    useEffect(() => {
        if (!desktopRuntime || !preferences.enabled) return;
        let disposed = false;
        const registered: string[] = [];
        void (async () => {
            try {
                const { register } = await import("@tauri-apps/plugin-global-shortcut");
                await register(preferences.toggleShortcut, (event) => {
                    if (String(event.state).toLowerCase() === "pressed") void toggleVisible();
                });
                registered.push(preferences.toggleShortcut);
                if (disposed) return;
                await register(preferences.clickThroughShortcut, (event) => {
                    if (String(event.state).toLowerCase() === "pressed") void toggleClickThrough();
                });
                registered.push(preferences.clickThroughShortcut);
            } catch (error) {
                if (!disposed) setLastError(`Overlay shortcut registration failed (possibly a shortcut conflict): ${error instanceof Error ? error.message : String(error)}`);
            }
        })();
        return () => {
            disposed = true;
            const cleanup = [...registered];
            registered.length = 0;
            void (async () => {
                try {
                    const { unregister } = await import("@tauri-apps/plugin-global-shortcut");
                    for (const shortcut of cleanup) {
                        try { await unregister(shortcut); } catch { /* best-effort */ }
                    }
                } catch { /* ignore teardown errors */ }
            })();
        };
    }, [desktopRuntime, preferences.enabled, preferences.toggleShortcut, preferences.clickThroughShortcut, toggleVisible, toggleClickThrough, setLastError]);

    if (!desktopRuntime) return null;
    const visible = runtime?.visible ?? false;
    const capabilities = runtime?.capabilities;
    const captureSupported = capabilities?.captureProtectionSupported ?? true;
    const platform = capabilities?.platform ?? "desktop";

    return (
        <div className="fixed bottom-3 right-3 z-[90] flex max-w-[360px] flex-col items-end gap-1">
            {expanded && preferences.enabled && (
                <div className="w-[320px] rounded-lg border border-border/80 bg-background/95 p-3 shadow-xl backdrop-blur-md">
                    <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-foreground/80">Overlay</span>
                        <span className="text-[9px] text-muted-foreground/60">{platform} · {visible ? "visible" : "hidden"}</span>
                        <button type="button" className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setExpanded(false)}>Done</button>
                    </div>
                    <label className="mb-2 block text-[9px] uppercase tracking-wider text-muted-foreground">
                        Opacity {Math.round(preferences.opacity * 100)}%
                        <input className="mt-1 w-full" type="range" min="45" max="100" value={Math.round(preferences.opacity * 100)} onChange={(e) => updatePreferences({ opacity: Number(e.target.value) / 100 })} />
                    </label>
                    <label className="mb-2 block text-[9px] uppercase tracking-wider text-muted-foreground">
                        Text size {Math.round(preferences.fontScale * 100)}%
                        <input className="mt-1 w-full" type="range" min="80" max="150" value={Math.round(preferences.fontScale * 100)} onChange={(e) => updatePreferences({ fontScale: Number(e.target.value) / 100 })} />
                    </label>
                    <label className="mb-3 block text-[9px] uppercase tracking-wider text-muted-foreground">
                        Recent responses {preferences.maxResponses}
                        <input className="mt-1 w-full" type="range" min="1" max="8" value={preferences.maxResponses} onChange={(e) => updatePreferences({ maxResponses: Number(e.target.value) })} />
                    </label>
                    <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                        <button type="button" onClick={() => updatePreferences({ autoShowOnResponse: !preferences.autoShowOnResponse })} className={`rounded border px-2 py-1.5 ${preferences.autoShowOnResponse ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>Auto-show {preferences.autoShowOnResponse ? "on" : "off"}</button>
                        <button type="button" disabled={!captureSupported} onClick={() => updatePreferences({ captureProtected: !preferences.captureProtected })} className={`rounded border px-2 py-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${captureSupported && preferences.captureProtected ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`} title={captureSupported ? "Prevent PRMPTR overlay content from appearing in supported OS screen captures" : `Capture protection is not supported by Tauri on ${platform}`}>
                            {captureSupported ? `Capture shield ${preferences.captureProtected ? "on" : "off"}` : "Shield unsupported"}
                        </button>
                        <button type="button" onClick={recoverPosition} className="rounded border border-border px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">Center / recover</button>
                        <button type="button" disabled={isPreviewing} onClick={() => void runPreview()} className="rounded border border-border px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-wait disabled:opacity-50">{isPreviewing ? "Testing…" : "Test overlay"}</button>
                    </div>
                    {!captureSupported && (
                        <div className="mt-2 rounded border border-amber-500/20 bg-amber-500/5 p-2 text-[9px] leading-relaxed text-amber-300/80">
                            Capture shield is unavailable on {platform}. The overlay may appear in screenshot/OCR context on this platform.
                        </div>
                    )}
                    {capabilities && !capabilities.globalPositionPersistenceSupported && (
                        <div className="mt-2 text-[9px] leading-relaxed text-muted-foreground/60">Global window position is not persisted on this compositor; Center / recover remains available.</div>
                    )}
                    <div className="mt-2 text-[9px] leading-relaxed text-muted-foreground/60">{preferences.toggleShortcut} show/hide · {preferences.clickThroughShortcut} click-through</div>
                    <div className="mt-1 text-[9px] text-muted-foreground/45">window {runtime?.windowExists ? "created" : "not created"} · shield {runtime?.captureProtected ? "effective" : "inactive"} · clicks {runtime?.clickThrough ? "pass through" : "interactive"}</div>
                    {lastError && <div className="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-[9px] text-destructive">{lastError}</div>}
                </div>
            )}
            <div className="flex items-center gap-1 rounded-md border border-border/80 bg-background/90 p-1 shadow-lg backdrop-blur-md">
                <button type="button" onClick={toggleFeature} className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${preferences.enabled ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`} title={lastError ?? "Optional always-on-top PRMPTR response overlay"}>
                    <span className={`mr-1 inline-block size-1.5 rounded-full ${preferences.enabled ? "bg-emerald-400" : "bg-muted-foreground/40"}`} />Overlay {preferences.enabled ? "on" : "off"}
                </button>
                {preferences.enabled && (
                    <>
                        <button type="button" onClick={() => setExpanded((value) => !value)} className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground">Tune</button>
                        <button type="button" onClick={toggleVisible} className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground" title={`${preferences.toggleShortcut}: show or hide overlay`}>{visible ? "Hide" : "Show"}</button>
                        <button type="button" onClick={toggleClickThrough} className={`rounded px-2 py-1 text-[10px] ${preferences.clickThrough ? "bg-amber-400/10 text-amber-300" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`} title={`${preferences.clickThroughShortcut}: toggle click-through`}>{preferences.clickThrough ? "Clicks pass" : "Interactive"}</button>
                    </>
                )}
            </div>
        </div>
    );
}
