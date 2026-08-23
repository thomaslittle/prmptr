import { describe, expect, it } from "vitest";
import { normalizeOverlayProjection, type OverlayRuntimeState } from "../overlay";
import {
    DEFAULT_OVERLAY_PREFERENCES,
    clampOverlayPreferences,
    mergeOverlayRuntimePreferences,
} from "../stores/overlay-store";
import type { ResponseEntry } from "../types";

function response(id: string, content: string): ResponseEntry {
    return {
        id,
        content,
        timestamp: `2026-08-23T00:00:0${id}.000Z`,
        model: "fixture-model",
        type: "analysis",
    };
}

function runtime(overrides: Partial<OverlayRuntimeState> = {}): OverlayRuntimeState {
    return {
        enabled: true,
        windowExists: true,
        visible: true,
        clickThrough: false,
        captureProtected: false,
        capabilities: {
            platform: "linux",
            transparencySupported: true,
            alwaysOnTopSupported: true,
            clickThroughSupported: true,
            captureProtectionSupported: false,
            globalPositionPersistenceSupported: false,
        },
        config: {
            width: 420,
            height: 320,
            clickThrough: false,
            autoShowOnResponse: true,
            captureProtected: true,
        },
        content: {
            responses: [],
            currentResponse: "",
            isStreaming: false,
            appearance: { opacity: 0.9, fontScale: 1 },
        },
        ...overrides,
    };
}

describe("overlay projection", () => {
    it("keeps newest response ordering and bounds history", () => {
        const responses = Array.from({ length: 10 }, (_, index) => response(String(index), `response ${index}`));
        const projected = normalizeOverlayProjection({
            responses,
            currentResponse: "",
            isStreaming: false,
            maxResponses: 3,
        });
        expect(projected.responses.map((item) => item.id)).toEqual(["0", "1", "2"]);
    });

    it("filters empty completed responses", () => {
        const projected = normalizeOverlayProjection({
            responses: [response("1", ""), response("2", "  "), response("3", "hello")],
            currentResponse: "",
            isStreaming: false,
        });
        expect(projected.responses).toHaveLength(1);
        expect(projected.responses[0].id).toBe("3");
    });

    it("clamps opacity font scale and response budget", () => {
        const projected = normalizeOverlayProjection({
            responses: Array.from({ length: 12 }, (_, index) => response(String(index), `response ${index}`)),
            currentResponse: "streaming  ",
            isStreaming: true,
            maxResponses: 99,
            opacity: 0.1,
            fontScale: 3,
        });
        expect(projected.responses).toHaveLength(8);
        expect(projected.appearance.opacity).toBe(0.45);
        expect(projected.appearance.fontScale).toBe(1.5);
        expect(projected.currentResponse).toBe("streaming");
    });

    it("preserves session and streaming state without inventing data", () => {
        const projected = normalizeOverlayProjection({
            responses: [],
            currentResponse: "partial answer",
            isStreaming: true,
            sessionId: "session-1",
        });
        expect(projected.isStreaming).toBe(true);
        expect(projected.sessionId).toBe("session-1");
        expect(projected.currentResponse).toBe("partial answer");
    });
});

describe("overlay preferences", () => {
    it("defaults to opt-in off with capture shield desired", () => {
        expect(DEFAULT_OVERLAY_PREFERENCES.enabled).toBe(false);
        expect(DEFAULT_OVERLAY_PREFERENCES.captureProtected).toBe(true);
        expect(DEFAULT_OVERLAY_PREFERENCES.clickThrough).toBe(false);
    });

    it("clamps user-facing ranges", () => {
        const clamped = clampOverlayPreferences({
            ...DEFAULT_OVERLAY_PREFERENCES,
            opacity: 0,
            fontScale: 99,
            maxResponses: 50,
            width: 10,
            height: 5000,
        });
        expect(clamped.opacity).toBe(0.45);
        expect(clamped.fontScale).toBe(1.5);
        expect(clamped.maxResponses).toBe(8);
        expect(clamped.width).toBe(280);
        expect(clamped.height).toBe(1000);
    });

    it("preserves desired capture shield when the current platform cannot enforce it", () => {
        const merged = mergeOverlayRuntimePreferences(
            { ...DEFAULT_OVERLAY_PREFERENCES, captureProtected: true },
            runtime({ captureProtected: false })
        );
        expect(merged.captureProtected).toBe(true);
    });

    it("accepts native lifecycle and bounds as runtime truth", () => {
        const merged = mergeOverlayRuntimePreferences(
            DEFAULT_OVERLAY_PREFERENCES,
            runtime({
                enabled: true,
                config: {
                    width: 700,
                    height: 500,
                    x: 30,
                    y: 40,
                    clickThrough: true,
                    autoShowOnResponse: false,
                    captureProtected: true,
                },
            })
        );
        expect(merged.enabled).toBe(true);
        expect(merged.clickThrough).toBe(true);
        expect(merged.width).toBe(700);
        expect(merged.height).toBe(500);
        expect(merged.x).toBe(30);
        expect(merged.y).toBe(40);
    });
});
