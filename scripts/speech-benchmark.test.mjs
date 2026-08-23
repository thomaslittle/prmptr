import { describe, expect, it } from "vitest";
import {
    evaluateManifest,
    levenshteinDistance,
    normalizeText,
    tokenizeWords,
} from "./speech-benchmark-lib.mjs";

describe("speech benchmark evaluator", () => {
    it("normalizes punctuation without deleting spoken words", () => {
        expect(normalizeText("Thank you." )).toBe("thank you");
        expect(tokenizeWords("YOU")).toEqual(["you"]);
    });

    it("computes edit distance deterministically", () => {
        expect(levenshteinDistance(["one", "two"], ["one", "three"])).toBe(1);
        expect(levenshteinDistance([], ["one"])).toBe(1);
    });

    it("aggregates WER, clipping, terms, and speaker confusion", () => {
        const result = evaluateManifest({
            suite: "unit",
            cases: [
                {
                    id: "a",
                    reference: "hello Sarah",
                    hypothesis: "hello Sarah",
                    terms: ["Sarah"],
                    referenceSpeakers: [{ speaker: "1", text: "hello Sarah" }],
                    hypothesisSpeakers: [{ speaker: "2", text: "hello Sarah" }],
                    latencyMs: 100,
                },
                {
                    id: "b",
                    reference: "thank you",
                    hypothesis: "thank",
                    terms: ["thank you"],
                    latencyMs: 300,
                },
            ],
        });
        expect(result.metrics.wer).toBeCloseTo(0.25);
        expect(result.metrics.technicalTermErrorRate).toBeCloseTo(0.5);
        expect(result.metrics.lastWordClippingRate).toBeCloseTo(0.5);
        expect(result.metrics.speakerWordConfusionRate).toBeCloseTo(1);
        expect(result.metrics.latencyP50Ms).toBe(100);
        expect(result.metrics.latencyP95Ms).toBe(300);
    });
});
