import { describe, expect, it } from "vitest";
import {
    feedItemToTranscriptLine,
    legacyLocalResultToTranscriptLine,
    reduceTranscriptLines,
    resolveTranscriptEngine,
    transcriptLineToFeedItems,
    transcriptLinesRepresentedByFeed,
    type TranscriptLine,
} from "../transcript";

function line(overrides: Partial<TranscriptLine> = {}): TranscriptLine {
    return {
        id: "line-1",
        revision: 0,
        trackId: "system",
        role: "them",
        engine: "moonshine",
        model: "medium-streaming",
        text: "hello there",
        startMs: 100,
        endMs: 900,
        isComplete: false,
        words: [],
        speakerSpans: [],
        createdAt: "2026-08-22T20:00:00.000Z",
        updatedAt: "2026-08-22T20:00:00.000Z",
        ...overrides,
    };
}

describe("canonical transcript reducer", () => {
    it("updates one stable line instead of duplicating revisions", () => {
        const first = line();
        const second = line({
            revision: 1,
            text: "hello there friend",
            isComplete: true,
            updatedAt: "2026-08-22T20:00:01.000Z",
        });
        const result = reduceTranscriptLines(reduceTranscriptLines([], first), second);
        expect(result).toHaveLength(1);
        expect(result[0].revision).toBe(1);
        expect(result[0].text).toBe("hello there friend");
        expect(result[0].isComplete).toBe(true);
    });

    it("ignores stale revisions", () => {
        const current = line({ revision: 4, text: "new", updatedAt: "2026-08-22T20:00:04.000Z" });
        const stale = line({ revision: 3, text: "old", updatedAt: "2026-08-22T20:00:05.000Z" });
        expect(reduceTranscriptLines([current], stale)[0].text).toBe("new");
    });

    it("allows a same-revision correction only when updatedAt advances", () => {
        const current = line({ revision: 2, text: "one", updatedAt: "2026-08-22T20:00:02.000Z" });
        const correction = line({ revision: 2, text: "two", updatedAt: "2026-08-22T20:00:03.000Z" });
        expect(reduceTranscriptLines([current], correction)[0].text).toBe("two");
    });
});

describe("engine provenance", () => {
    it("labels direct Deepgram events as Deepgram instead of the local engine", () => {
        expect(
            resolveTranscriptEngine({
                transcriptionMode: "direct-deepgram",
                localSttEngine: "moonshine",
            })
        ).toEqual({ engine: "deepgram", model: "nova-2" });
    });

    it("keeps Moonshine and Whisper provenance distinct in local mode", () => {
        expect(
            resolveTranscriptEngine({ transcriptionMode: "local-whisper", localSttEngine: "moonshine" })
        ).toEqual({ engine: "moonshine", model: "moonshine-sherpa-base" });
        expect(
            resolveTranscriptEngine({ transcriptionMode: "local-whisper", localSttEngine: "whisper" })
        ).toEqual({ engine: "whisper", model: "selected-whisper" });
    });
});

describe("speaker-aware projection", () => {
    it("splits a single transcript line at speaker character spans", () => {
        const input = line({
            text: "hello alice hi bob",
            isComplete: true,
            speakerSpans: [
                {
                    speakerKey: "system:1",
                    speakerIndex: 1,
                    label: "Alice",
                    startMs: 0,
                    endMs: 400,
                    startChar: 0,
                    endChar: 11,
                },
                {
                    speakerKey: "system:2",
                    speakerIndex: 2,
                    label: "Bob",
                    startMs: 400,
                    endMs: 800,
                    startChar: 12,
                    endChar: 18,
                },
            ],
        });
        const items = transcriptLineToFeedItems(input);
        expect(items.map((item) => item.content)).toEqual(["hello alice", "hi bob"]);
        expect(items.map((item) => item.speakerLabel)).toEqual(["Alice", "Bob"]);
    });

    it("never relabels microphone text as an anonymous speaker", () => {
        const input = line({
            trackId: "mic",
            role: "you",
            speakerSpans: [
                {
                    speakerKey: "mic:7",
                    speakerIndex: 7,
                    label: "Speaker 7",
                    startMs: 0,
                    endMs: 500,
                    startChar: 0,
                    endChar: 11,
                },
            ],
        });
        const [item] = transcriptLineToFeedItems(input);
        expect(item.deviceType).toBe("input");
        expect(item.speaker).toBeUndefined();
        expect(item.speakerLabel).toBeUndefined();
    });

    it("preserves unassigned text between diarized spans", () => {
        const input = line({
            text: "alpha gap beta",
            speakerSpans: [
                {
                    speakerKey: "system:1",
                    speakerIndex: 1,
                    startMs: 0,
                    endMs: 100,
                    startChar: 0,
                    endChar: 5,
                },
                {
                    speakerKey: "system:2",
                    speakerIndex: 2,
                    startMs: 200,
                    endMs: 300,
                    startChar: 10,
                    endChar: 14,
                },
            ],
        });
        expect(transcriptLineToFeedItems(input).map((item) => item.content)).toEqual([
            "alpha",
            "gap",
            "beta",
        ]);
    });

    it("selects canonical lines only when their projected feed rows are present", () => {
        const live = line({ id: "live", isComplete: true });
        const archived = line({ id: "archived", text: "old", isComplete: true });
        const liveItem = transcriptLineToFeedItems(live)[0];
        expect(transcriptLinesRepresentedByFeed([live, archived], [liveItem])).toEqual([live]);
    });
});

describe("legacy adapters", () => {
    it("maps native input/output topology into canonical roles", () => {
        const you = legacyLocalResultToTranscriptLine({
            id: "you",
            text: "hello",
            is_final: true,
            timestamp: "2026-08-22T20:00:00.000Z",
            device_type: "input",
            speaker_id: 4,
            speaker_label: "Speaker 4",
        });
        const them = legacyLocalResultToTranscriptLine({
            id: "them",
            text: "hi",
            is_final: true,
            timestamp: "2026-08-22T20:00:00.000Z",
            device_type: "output",
            speaker_id: 2,
            speaker_label: "Speaker 2",
        });
        expect(you.role).toBe("you");
        expect(you.speakerSpans).toEqual([]);
        expect(them.role).toBe("them");
        expect(them.speakerSpans[0].speakerKey).toBe("system:2");
    });

    it("converts persisted legacy feed rows without losing speaker identity", () => {
        const converted = feedItemToTranscriptLine({
            id: "legacy",
            type: "audio",
            content: "hi",
            timestamp: "2026-08-22T20:00:00.000Z",
            source: "System audio",
            deviceType: "output",
            speaker: 3,
            speakerLabel: "Sarah",
            isFinal: true,
        });
        expect(converted.trackId).toBe("system");
        expect(converted.speakerSpans[0].speakerKey).toBe("system:3");
        expect(converted.speakerSpans[0].label).toBe("Sarah");
    });
});
