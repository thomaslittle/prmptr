"use client";

import { useEffect, useRef } from "react";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { isTauri } from "@/lib/tauri";
import { ShortcutAction } from "@/lib/types";
import { parseShortcut, matchesKeyboardEvent } from "@/lib/shortcuts";

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

export function useShortcutManager(handlers: ShortcutHandlers) {
    const { settings } = useSettingsStore();
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    const shortcuts = settings.shortcuts;

    // Tauri mode: register OS-level global shortcuts via JS plugin API
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

                for (const [action, binding] of Object.entries(shortcuts)) {
                    if (cancelled) return;
                    const handlerKey = ACTION_TO_HANDLER[action as ShortcutAction];
                    try {
                        await register(binding.keys, () => {
                            handlersRef.current[handlerKey]?.();
                        });
                    } catch {
                        // Shortcut may be invalid or already taken by OS
                    }
                }
            } catch {
                // Plugin not available
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
