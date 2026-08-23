"use client";

import { useEffect, useRef } from "react";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { isTauri } from "@/lib/tauri";
import { ShortcutAction } from "@/lib/types";
import { parseShortcut, matchesKeyboardEvent, toTauriGlobalShortcut } from "@/lib/shortcuts";

interface ShortcutHandlers {
    onAnalyze?: () => void;
    onClear?: () => void;
    onSettingsPanel?: () => void;
}

const ACTION_TO_HANDLER: Record<ShortcutAction, keyof ShortcutHandlers> = {
    analyze: "onAnalyze",
    clear: "onClear",
    settingsPanel: "onSettingsPanel",
};

function normalizeShortcutId(value: string): string {
    const rawParts = value
        .toLowerCase()
        .split("+")
        .map((p) => p.trim())
        .filter(Boolean);

    const modifiers = new Set<string>();
    let key = "";

    for (const part of rawParts) {
        const p = part
            .replace(/commandorcontrol/g, "ctrl")
            .replace(/^control$/, "ctrl")
            .replace(/^cmd$/, "meta")
            .replace(/^command$/, "meta")
            .replace(/^super$/, "meta");

        if (p === "ctrl" || p === "shift" || p === "alt" || p === "meta") {
            modifiers.add(p);
            continue;
        }

        if (p.startsWith("key") && p.length === 4) {
            key = p.slice(3);
            continue;
        }
        if (p.startsWith("digit") && p.length === 6) {
            key = p.slice(5);
            continue;
        }

        key = p;
    }

    const orderedMods = ["ctrl", "shift", "alt", "meta"].filter((m) => modifiers.has(m));
    return [...orderedMods, key].filter(Boolean).join("+");
}

export function useShortcutManager(handlers: ShortcutHandlers) {
    const { settings } = useSettingsStore();
    const handlersRef = useRef(handlers);
    useEffect(() => {
        handlersRef.current = handlers;
    });

    const shortcuts = settings.shortcuts;

    // Register only the shortcuts owned by this hook. Never call unregisterAll:
    // overlay and future optional subsystems own independent global shortcuts.
    useEffect(() => {
        if (!isTauri()) return;

        let cancelled = false;
        const owned = new Set<string>();

        (async () => {
            try {
                const { register, unregister } = await import(
                    "@tauri-apps/plugin-global-shortcut"
                );

                const tauriShortcuts: string[] = [];
                const shortcutToAction: Record<string, ShortcutAction> = {};

                for (const [action, binding] of Object.entries(shortcuts)) {
                    const tauriFormat = toTauriGlobalShortcut(binding.keys);
                    tauriShortcuts.push(tauriFormat);
                    shortcutToAction[normalizeShortcutId(tauriFormat)] = action as ShortcutAction;
                }

                for (const shortcut of tauriShortcuts) {
                    if (cancelled) return;
                    // Remove only an earlier registration of this exact app-owned binding.
                    // Failure simply means it was not registered yet.
                    try {
                        await unregister(shortcut);
                    } catch {
                        // no-op
                    }
                }

                if (cancelled || tauriShortcuts.length === 0) return;
                await register(tauriShortcuts, (event) => {
                    const state = String(event.state).toLowerCase();
                    if (state !== "pressed") return;
                    const action = shortcutToAction[normalizeShortcutId(event.shortcut)];
                    if (!action) return;
                    const handlerKey = ACTION_TO_HANDLER[action];
                    handlersRef.current[handlerKey]?.();
                });
                tauriShortcuts.forEach((shortcut) => owned.add(shortcut));
            } catch (err) {
                console.warn("Global shortcut registration failed:", err);
            }
        })();

        return () => {
            cancelled = true;
            const cleanup = [...owned];
            owned.clear();
            void (async () => {
                try {
                    const { unregister } = await import(
                        "@tauri-apps/plugin-global-shortcut"
                    );
                    for (const shortcut of cleanup) {
                        try {
                            await unregister(shortcut);
                        } catch {
                            // The OS/plugin may already have removed it.
                        }
                    }
                } catch {
                    // ignore teardown errors
                }
            })();
        };
    }, [shortcuts]);

    // Browser mode: keydown listener for in-app shortcuts.
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
            if ((e.target as HTMLElement)?.closest("[data-shortcut-recorder]")) return;

            for (const [action, binding] of Object.entries(shortcuts)) {
                const parsed = parseShortcut(binding.keys);
                if (matchesKeyboardEvent(parsed, e)) {
                    e.preventDefault();
                    const handlerKey = ACTION_TO_HANDLER[action as ShortcutAction];
                    handlersRef.current[handlerKey]?.();
                    return;
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [shortcuts]);
}
