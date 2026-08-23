import { describe, expect, it } from "vitest";
import { normalizeOverlayProjection } from "../overlay";
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
