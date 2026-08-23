import { describe, expect, it } from "vitest";
import { nativeTranscriptLineToTranscriptLine } from "../speech-runtime";

describe("native speech IPC mapping", () => {
    it("preserves canonical engine, timing, confidence and speaker spans", () => {
        const mapped = nativeTranscriptLineToTranscriptLine({
            id: "native-1",
            revision: 4,
            track_id: "system",
            role: "them",
            engine: "deepgram",
            model: "nova-3",
            model_version: "2026-08",
            text: "hello Sarah",
            start_ms: 1200,
            end_ms: 2200,
            is_complete: true,
            words: [
                { text: "hello", start_ms: 1200, end_ms: 1600, confidence: 0.91 },
                { text: "Sarah", start_ms: 1700, end_ms: 2200, confidence: 0.87 },
            ],
            speaker_spans: [
                {
                    speaker_key: "system:2",
                    speaker_index: 2,
                    label: "Sarah",
                    start_ms: 1200,
                    end_ms: 2200,
                    start_char: 0,
                    end_char: 11,
                },
            ],
            latency_ms: 72,
            created_at: "2026-08-23T01:00:00Z",
            updated_at: "2026-08-23T01:00:01Z",
        });

        expect(mapped.engine).toBe("deepgram");
        expect(mapped.model).toBe("nova-3");
        expect(mapped.startMs).toBe(1200);
        expect(mapped.words[0].confidence).toBe(0.91);
        expect(mapped.speakerSpans[0]).toMatchObject({
            speakerKey: "system:2",
            speakerIndex: 2,
            label: "Sarah",
            startChar: 0,
            endChar: 11,
        });
    });

    it("keeps incomplete revisions incomplete", () => {
        const mapped = nativeTranscriptLineToTranscriptLine({
            id: "partial",
            revision: 1,
            track_id: "mic",
            role: "you",
            engine: "whisper",
            model: "tiny.en",
            text: "working on",
            start_ms: 0,
            end_ms: 600,
            is_complete: false,
            created_at: "2026-08-23T01:00:00Z",
            updated_at: "2026-08-23T01:00:00Z",
        });
        expect(mapped.isComplete).toBe(false);
        expect(mapped.words).toEqual([]);
        expect(mapped.speakerSpans).toEqual([]);
    });
});
