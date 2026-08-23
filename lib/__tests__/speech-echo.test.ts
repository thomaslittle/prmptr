import { describe, expect, it } from "vitest";
import { analyzeCrossChannelEcho } from "../speech-echo";
import type { TranscriptLine } from "../transcript";

function line(
    id: string,
    trackId: "mic" | "system",
    text: string,
    startMs: number,
    endMs: number
): TranscriptLine {
    return {
        id,
        revision: 0,
        trackId,
        role: trackId === "mic" ? "you" : "them",
        engine: "fixture",
        model: "fixture",
        text,
        startMs,
        endMs,
        isComplete: true,
        words: [],
        speakerSpans: [],
        createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-22T00:00:00.000Z",
    };
}

describe("cross-channel echo diagnostics", () => {
    it("flags near-simultaneous high-overlap mic/system text", () => {
        const result = analyzeCrossChannelEcho([
            line("mic", "mic", "Can you deploy the Kubernetes service now", 1_000, 3_000),
            line("system", "system", "can you deploy the kubernetes service now", 1_150, 3_100),
        ]);
        expect(result.comparablePairs).toBe(1);
        expect(result.duplicateCandidates).toBe(1);
        expect(result.duplicateCandidateRate).toBe(1);
    });

    it("does not compare matching phrases that occur far apart", () => {
        const result = analyzeCrossChannelEcho([
            line("mic", "mic", "thank you very much", 1_000, 2_000),
            line("system", "system", "thank you very much", 20_000, 21_000),
        ]);
        expect(result.comparablePairs).toBe(0);
        expect(result.duplicateCandidates).toBe(0);
        expect(result.duplicateCandidateRate).toBeNull();
    });

    it("measures but never removes legitimate overlapping speech", () => {
        const lines = [
            line("mic", "mic", "yes I can do that", 5_000, 6_000),
            line("system", "system", "no I meant tomorrow morning", 5_200, 6_400),
        ];
        const result = analyzeCrossChannelEcho(lines);
        expect(result.comparablePairs).toBe(1);
        expect(result.duplicateCandidates).toBe(0);
        expect(lines).toHaveLength(2);
    });
});
