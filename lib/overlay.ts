import type { ResponseEntry } from "@/lib/types";

export interface OverlayBounds {
    x?: number;
    y?: number;
    width: number;
    height: number;
}

export interface OverlayWindowConfig {
    width: number;
    height: number;
    x?: number;
    y?: number;
    clickThrough: boolean;
    autoShowOnResponse: boolean;
    captureProtected: boolean;
}

export interface OverlayAppearance {
    opacity: number;
    fontScale: number;
}

export interface OverlayResponseItem {
    id: string;
    content: string;
    timestamp: string;
    model: string;
    kind?: "analysis" | "chat";
}

export interface OverlayContent {
    responses: OverlayResponseItem[];
    currentResponse: string;
    isStreaming: boolean;
    sessionId?: string;
    appearance: OverlayAppearance;
}

export interface OverlayRuntimeState {
    enabled: boolean;
    windowExists: boolean;
    visible: boolean;
    clickThrough: boolean;
    captureProtected: boolean;
    config: OverlayWindowConfig;
    content: OverlayContent;
}

export interface OverlayProjectionInput {
    responses: ResponseEntry[];
    currentResponse: string;
    isStreaming: boolean;
    sessionId?: string | null;
    maxResponses?: number;
    opacity?: number;
    fontScale?: number;
}

export function normalizeOverlayProjection(input: OverlayProjectionInput): OverlayContent {
    const maxResponses = Math.max(1, Math.min(input.maxResponses ?? 3, 8));
    const opacity = Math.max(0.45, Math.min(input.opacity ?? 0.9, 1));
    const fontScale = Math.max(0.8, Math.min(input.fontScale ?? 1, 1.5));
    const responses = input.responses
        .filter((entry) => entry.content.trim().length > 0)
        .slice(0, maxResponses)
        .map((entry) => ({
            id: entry.id,
            content: entry.content,
            timestamp: entry.timestamp,
            model: entry.model,
            kind: entry.type,
        }));

    return {
        responses,
        currentResponse: input.currentResponse.trimEnd(),
        isStreaming: input.isStreaming,
        sessionId: input.sessionId ?? undefined,
        appearance: { opacity, fontScale },
    };
}

function desktop(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    if (!desktop()) throw new Error(`${command} requires the PRMPTR desktop app`);
    const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
    return tauriInvoke<T>(command, args);
}

export function setOverlayEnabled(enabled: boolean, config: OverlayWindowConfig): Promise<OverlayRuntimeState> {
    return invoke("set_overlay_enabled", { enabled, config });
}

export function applyOverlayConfig(config: OverlayWindowConfig): Promise<OverlayRuntimeState> {
    return invoke("apply_overlay_config", { config });
}

export function toggleOverlayVisibility(): Promise<OverlayRuntimeState> {
    return invoke("toggle_overlay_visibility");
}

export function hideOverlay(): Promise<OverlayRuntimeState> {
    return invoke("hide_overlay");
}

export function setOverlayClickThrough(enabled: boolean): Promise<OverlayRuntimeState> {
    return invoke("set_overlay_click_through", { enabled });
}

export function publishOverlayContent(content: OverlayContent): Promise<OverlayRuntimeState> {
    return invoke("publish_overlay_content", { content });
}

export function getOverlayState(): Promise<OverlayRuntimeState> {
    return invoke("get_overlay_state");
}

export async function onOverlayContent(callback: (content: OverlayContent) => void): Promise<() => void> {
    if (!desktop()) return () => {};
    const { listen } = await import("@tauri-apps/api/event");
    return listen<OverlayContent>("overlay-content", (event) => callback(event.payload));
}

export async function onOverlayRuntimeState(callback: (state: OverlayRuntimeState) => void): Promise<() => void> {
    if (!desktop()) return () => {};
    const { listen } = await import("@tauri-apps/api/event");
    return listen<OverlayRuntimeState>("overlay-runtime-state", (event) => callback(event.payload));
}
