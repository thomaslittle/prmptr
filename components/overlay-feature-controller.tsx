"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@/lib/tauri";
import {
    applyOverlayConfig,
    normalizeOverlayProjection,
    onOverlayRuntimeState,
    publishOverlayContent,
    setOverlayClickThrough,
    setOverlayEnabled,
    toggleOverlayVisibility,
} from "@/lib/overlay";
import { overlayWindowConfig, useOverlayStore } from "@/lib/stores/overlay-store";
import { useSessionStore } from "@/lib/stores/session-store";

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
    const [expanded, setExpanded] = useState(false);
    const desktopRuntime = isTauri();

    const nativeConfig = useMemo(() => overlayWindowConfig(preferences), [preferences]);

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
            unlisten?.();
        };
        // Initial ownership synchronization intentionally runs once; subsequent
        // configuration changes use the native config effect below.
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
        if (!desktopRuntime || !preferences.enabled) return;
        const content = normalizeOverlayProjection({
            responses,
            currentResponse,
            isStreaming,
            sessionId,
            maxResponses: preferences.maxResponses,
            opacity: preferences.opacity,
            fontScale: preferences.fontScale,
        });
        const hash = JSON.stringify(content);
        if (hash === lastPayloadHash.current) return;
        lastPayloadHash.current = hash;
        publishOverlayContent(content)
            .then(applyRuntime)
            .catch((error) => {
                lastPayloadHash.current = "";
                setLastError(error instanceof Error ? error.message : String(error));
            });
    }, [desktopRuntime, preferences.enabled, preferences.maxResponses, preferences.opacity, preferences.fontScale, responses, currentResponse, isStreaming, sessionId, applyRuntime, setLastError]);

    const toggleFeature = useCallback(async () => {
        try {
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
            const state = await toggleOverlayVisibility();
            applyRuntime(state);
            setLastError(null);
        } catch (error) {
            setLastError(error instanceof Error ? error.message : String(error));
        }
    }, [preferences.enabled, applyRuntime, setLastError]);

    const toggleClickThrough = useCallback(async () => {
        if (!preferences.enabled) return;
        try {
            const state = await setOverlayClickThrough(!preferences.clickThrough);
            applyRuntime(state);
            setLastError(null);
        } catch (error) {
            setLastError(error instanceof Error ? error.message : String(error));
        }
    }, [preferences.enabled, preferences.clickThrough, applyRuntime, setLastError]);

    useEffect(() => {
        if (!desktopRuntime || !preferences.enabled) return;
        let disposed = false;
        const registered: string[] = [];
        void (async () => {
            try {
                const { register } = await import("@tauri-apps/plugin-global-shortcut");
                // Never pre-unregister exact bindings: they may belong to the
                // main app or another optional subsystem. A collision should
                // surface as an error rather than stealing another shortcut.
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
                        try {
                            await unregister(shortcut);
                        } catch {
                            // best-effort teardown of bindings this controller registered
                        }
                    }
                } catch {
                    // ignore teardown errors
                }
            })();
        };
    }, [desktopRuntime, preferences.enabled, preferences.toggleShortcut, preferences.clickThroughShortcut, toggleVisible, toggleClickThrough, setLastError]);

    if (!desktopRuntime) return null;

    const visible = runtime?.visible ?? false;
    return (
        <div className="fixed bottom-3 right-3 z-[90] flex max-w-[360px] flex-col items-end gap-1">
            {expanded && preferences.enabled && (
                <div className="w-[320px] rounded-lg border border-border/80 bg-background/95 p-3 shadow-xl backdrop-blur-md">
                    <div className="mb-3 flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-foreground/80">Overlay</span>
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
                        <button type="button" onClick={() => updatePreferences({ autoShowOnResponse: !preferences.autoShowOnResponse })} className={`rounded border px-2 py-1.5 ${preferences.autoShowOnResponse ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                            Auto-show {preferences.autoShowOnResponse ? "on" : "off"}
                        </button>
                        <button type="button" onClick={() => updatePreferences({ captureProtected: !preferences.captureProtected })} className={`rounded border px-2 py-1.5 ${preferences.captureProtected ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                            Capture shield {preferences.captureProtected ? "on" : "off"}
                        </button>
                    </div>
                    <div className="mt-2 text-[9px] leading-relaxed text-muted-foreground/60">
                        {preferences.toggleShortcut} show/hide · {preferences.clickThroughShortcut} click-through
                    </div>
                    {lastError && <div className="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-[9px] text-destructive">{lastError}</div>}
                </div>
            )}
            <div className="flex items-center gap-1 rounded-md border border-border/80 bg-background/90 p-1 shadow-lg backdrop-blur-md">
                <button type="button" onClick={toggleFeature} className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${preferences.enabled ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"}`} title={lastError ?? "Optional always-on-top PRMPTR response overlay"}>
                    <span className={`mr-1 inline-block size-1.5 rounded-full ${preferences.enabled ? "bg-emerald-400" : "bg-muted-foreground/40"}`} />
                    Overlay {preferences.enabled ? "on" : "off"}
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
