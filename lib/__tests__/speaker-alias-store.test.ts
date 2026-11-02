import { beforeEach, describe, expect, it } from "vitest";
import { applySpeakerAliases, speakerAliasFor, useSpeakerAliasStore } from "../stores/speaker-alias-store";
import { buildUserMessage } from "../prompt-builder";
import type { FeedItem } from "../types";

function line(overrides: Partial<FeedItem>): FeedItem {
    return {
        id: "l1",
        type: "audio",
        content: "hello",
        timestamp: new Date("2026-01-01T10:00:00Z").toISOString(),
        source: "Transcript",
        ...overrides,
    };
}

beforeEach(() => useSpeakerAliasStore.getState().clear());

describe("speaker alias store", () => {
    it("stores a cleaned alias per speaker id", () => {
        useSpeakerAliasStore.getState().setAlias(2, "  Sarah]\n[YOU] ");
        expect(speakerAliasFor(useSpeakerAliasStore.getState().aliases, 2)).toBe("Sarah YOU");
        expect(speakerAliasFor(useSpeakerAliasStore.getState().aliases, 3)).toBeUndefined();
        expect(speakerAliasFor(useSpeakerAliasStore.getState().aliases, undefined)).toBeUndefined();
    });

    it("removes the alias when renamed to blank or back to the default label", () => {
        const { setAlias } = useSpeakerAliasStore.getState();
        setAlias(2, "Sarah");
        setAlias(2, "   ");
        expect(useSpeakerAliasStore.getState().aliases).toEqual({});
        setAlias(3, "Bob");
        setAlias(3, "Speaker 3");
        expect(useSpeakerAliasStore.getState().aliases).toEqual({});
    });

    it("caps aliases at 64 characters", () => {
        useSpeakerAliasStore.getState().setAlias(1, "n".repeat(100));
        expect(useSpeakerAliasStore.getState().aliases["1"]).toHaveLength(64);
    });
});

describe("applySpeakerAliases", () => {
    it("renames every system-audio line of that speaker and flows into prompts", () => {
        const items = [
            line({ id: "a", deviceType: "output", speaker: 2, speakerLabel: "Speaker 2", content: "first" }),
            line({ id: "b", deviceType: "output", speaker: 2, speakerLabel: "Speaker 2", content: "second" }),
            line({ id: "c", deviceType: "output", speaker: 3, speakerLabel: "Speaker 3", content: "other" }),
        ];
        const aliased = applySpeakerAliases(items, { "2": "Sarah" });
        expect(aliased.map((i) => i.speakerLabel)).toEqual(["Sarah", "Sarah", "Speaker 3"]);
        const msg = buildUserMessage(aliased);
        expect(msg.match(/\[THEM: Sarah\]/g)).toHaveLength(2);
        expect(msg).toContain("[THEM: Speaker 3]");
    });

    it("never relabels the microphone", () => {
        const items = [line({ deviceType: "input", speaker: 2, speakerLabel: "Speaker 2" })];
        const aliased = applySpeakerAliases(items, { "2": "Sarah" });
        expect(aliased[0].speakerLabel).toBe("Speaker 2");
        expect(buildUserMessage(aliased)).toContain("[YOU]");
    });

    it("returns the same array when there are no aliases", () => {
        const items = [line({ deviceType: "output", speaker: 1 })];
        expect(applySpeakerAliases(items, {})).toBe(items);
    });
});
