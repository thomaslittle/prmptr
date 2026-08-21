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
            key = p.slice(3); // keyx -> x
            continue;
        }
        if (p.startsWith("digit") && p.length === 6) {
            key = p.slice(5); // digit2 -> 2
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

    // Tauri mode: register OS-level global shortcuts (work when app is not focused)
    useEffect(() => {
        if (!isTauri()) return;

        let cancelled = false;

        (async () => {
            try {
                const { unregisterAll, register } = await import(
                    "@tauri-apps/plugin-global-shortcut"
                );

                if (cancelled) return;

                await unregisterAll();

                const tauriShortcuts: string[] = [];
                const shortcutToAction: Record<string, ShortcutAction> = {};

                for (const [action, binding] of Object.entries(shortcuts)) {
                    if (cancelled) return;
                    const tauriFormat = toTauriGlobalShortcut(binding.keys);
                    tauriShortcuts.push(tauriFormat);
                    shortcutToAction[normalizeShortcutId(tauriFormat)] = action as ShortcutAction;
                }

                if (tauriShortcuts.length > 0) {
                    await register(tauriShortcuts, (event) => {
                        const state = String(event.state).toLowerCase();
                        if (state !== "pressed") return;
                        const action = shortcutToAction[normalizeShortcutId(event.shortcut)];
                        if (action) {
                            const handlerKey = ACTION_TO_HANDLER[action];
                            handlersRef.current[handlerKey]?.();
                        }
                    });
                }
            } catch (err) {
                console.warn("Global shortcut registration failed:", err);
            }
        })();

        return () => {
            cancelled = true;
            (async () => {
                try {
                    const { unregisterAll } = await import(
                        "@tauri-apps/plugin-global-shortcut"
                    );
                    await unregisterAll();
                } catch {
                    // ignore
                }
            })();
        };
    }, [shortcuts]);

    // Browser mode: keydown listener for in-app shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

            // Check if target has data-shortcut-recorder attribute (recording in progress)
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
