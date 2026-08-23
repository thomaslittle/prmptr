import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { OverlayRuntimeState, OverlayWindowConfig } from "@/lib/overlay";

export interface OverlayPreferences {
    enabled: boolean;
    autoShowOnResponse: boolean;
    clickThrough: boolean;
    captureProtected: boolean;
    opacity: number;
    fontScale: number;
    maxResponses: number;
    toggleShortcut: string;
    clickThroughShortcut: string;
    width: number;
    height: number;
    x?: number;
    y?: number;
}

const DEFAULTS: OverlayPreferences = {
    enabled: false,
    autoShowOnResponse: true,
    clickThrough: false,
    captureProtected: true,
    opacity: 0.9,
    fontScale: 1,
    maxResponses: 3,
    toggleShortcut: "CommandOrControl+Shift+H",
    clickThroughShortcut: "CommandOrControl+Shift+C",
    width: 420,
    height: 320,
};

interface OverlayStoreState {
    preferences: OverlayPreferences;
    runtime: OverlayRuntimeState | null;
    lastError: string | null;
    update: (patch: Partial<OverlayPreferences>) => void;
    applyRuntime: (runtime: OverlayRuntimeState) => void;
    setLastError: (error: string | null) => void;
    reset: () => void;
}

function clampPreferences(value: OverlayPreferences): OverlayPreferences {
    return {
        ...value,
        opacity: Math.max(0.45, Math.min(value.opacity, 1)),
        fontScale: Math.max(0.8, Math.min(value.fontScale, 1.5)),
        maxResponses: Math.max(1, Math.min(Math.round(value.maxResponses), 8)),
        width: Math.max(280, Math.min(value.width, 1200)),
        height: Math.max(160, Math.min(value.height, 1000)),
    };
}

export function overlayWindowConfig(preferences: OverlayPreferences): OverlayWindowConfig {
    const p = clampPreferences(preferences);
    return {
        width: p.width,
        height: p.height,
        x: p.x,
        y: p.y,
        clickThrough: p.clickThrough,
        autoShowOnResponse: p.autoShowOnResponse,
        captureProtected: p.captureProtected,
    };
}

export const useOverlayStore = create<OverlayStoreState>()(
    persist(
        (set) => ({
            preferences: DEFAULTS,
            runtime: null,
            lastError: null,
            update: (patch) =>
                set((state) => ({
                    preferences: clampPreferences({ ...state.preferences, ...patch }),
                })),
            applyRuntime: (runtime) =>
                set((state) => ({
                    runtime,
                    preferences: clampPreferences({
                        ...state.preferences,
                        enabled: runtime.enabled,
                        clickThrough: runtime.clickThrough,
                        captureProtected: runtime.captureProtected,
                        width: runtime.config.width,
                        height: runtime.config.height,
                        x: runtime.config.x,
                        y: runtime.config.y,
                    }),
                })),
            setLastError: (lastError) => set({ lastError }),
            reset: () => set({ preferences: DEFAULTS, runtime: null, lastError: null }),
        }),
        {
            name: "prmptr-overlay.v1",
            version: 1,
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({ preferences: state.preferences }),
        }
    )
);
