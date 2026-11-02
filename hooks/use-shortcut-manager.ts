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
    const rawParts = value.toLowerCase().split("+").map((p) => p.trim()).filter(Boolean);
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
        } else if (p.startsWith("key") && p.length === 4) {
            key = p.slice(3);
        } else if (p.startsWith("digit") && p.length === 6) {
            key = p.slice(5);
        } else {
            key = p;
        }
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

    useEffect(() => {
        if (!isTauri()) return;
        let cancelled = false;
        const owned: string[] = [];

        void (async () => {
            try {
                const { register } = await import("@tauri-apps/plugin-global-shortcut");
                const tauriShortcuts = Object.entries(shortcuts).map(([action, binding]) => ({
                    action: action as ShortcutAction,
                    shortcut: toTauriGlobalShortcut(binding.keys),
                }));
                if (cancelled || tauriShortcuts.length === 0) return;

                // Never unregister a shortcut before registration: the exact
                // binding may belong to another optional subsystem. A collision
                // is a configuration error and must fail rather than steal it.
                await register(
                    tauriShortcuts.map((entry) => entry.shortcut),
                    (event) => {
                        if (String(event.state).toLowerCase() !== "pressed") return;
                        const normalized = normalizeShortcutId(event.shortcut);
                        const entry = tauriShortcuts.find(
                            (candidate) => normalizeShortcutId(candidate.shortcut) === normalized
                        );
                        if (!entry) return;
                        handlersRef.current[ACTION_TO_HANDLER[entry.action]]?.();
                    }
                );
                owned.push(...tauriShortcuts.map((entry) => entry.shortcut));
            } catch (err) {
                console.warn("Global shortcut registration failed (possibly a shortcut conflict):", err);
            }
        })();

        return () => {
            cancelled = true;
            const cleanup = [...owned];
            owned.length = 0;
            void (async () => {
                try {
                    const { unregister } = await import("@tauri-apps/plugin-global-shortcut");
                    for (const shortcut of cleanup) {
                        try {
                            await unregister(shortcut);
                        } catch {
                            // already removed by plugin/OS teardown
                        }
                    }
                } catch {
                    // ignore teardown errors
                }
            })();
        };
    }, [shortcuts]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
            if ((e.target as HTMLElement)?.closest("[data-shortcut-recorder]")) return;

            for (const [action, binding] of Object.entries(shortcuts)) {
                if (!matchesKeyboardEvent(parseShortcut(binding.keys), e)) continue;
                e.preventDefault();
                handlersRef.current[ACTION_TO_HANDLER[action as ShortcutAction]]?.();
                return;
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [shortcuts]);
}
