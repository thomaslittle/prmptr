import { describe, it, expect } from "vitest";
import {
    buildSystemPrompt,
    buildUserMessage,
    buildChatPrompt,
    buildGatePrompt,
    estimateTokens,
    truncateFeedItems,
} from "../prompt-builder";
import { FeedItem, SessionConfig } from "../types";

function feedItem(overrides: Partial<FeedItem> = {}): FeedItem {
    return {
        id: "item-1",
        type: "audio",
        source: "Mic (input)",
        content: "hello world",
        timestamp: new Date("2026-01-01T10:00:00Z").toISOString(),
        ...overrides,
    };
}

const baseConfig: SessionConfig = {
    context: "",
    personality: "roast",
    responseStyle: "detailed",
    triggerMode: "auto",
    autoIntervalSecs: 30,
    contextSize: 6000,
    model: "test-model",
    provider: "openai",
};

describe("estimateTokens", () => {
    it("ceil-divides length by 4", () => {
        expect(estimateTokens("")).toBe(0);
        expect(estimateTokens("abcd")).toBe(1);
        expect(estimateTokens("abcde")).toBe(2);
    });
});

describe("truncateFeedItems", () => {
    it("returns empty for empty input", () => {
        expect(truncateFeedItems([], 100)).toEqual([]);
    });

    it("keeps items that fit the budget and drops overflow", () => {
        const items = [
            feedItem({ id: "a", content: "a".repeat(400) }), // ~101 tokens
            feedItem({ id: "b", content: "b".repeat(40) }), // ~14 tokens
            feedItem({ id: "c", content: "c".repeat(4000) }), // way over
        ];
        const result = truncateFeedItems(items, 120);
        // newest-first selection: c dropped (too big), a kept, b kept if budget allows
        const ids = result.map((i) => i.id);
        expect(ids).toContain("a");
        expect(ids).not.toContain("c");
    });

    it("restores chronological order after newest-first truncation", () => {
        const items = [
            feedItem({ id: "old", timestamp: new Date("2026-01-01T10:00:00Z").toISOString() }),
            feedItem({ id: "new", timestamp: new Date("2026-01-01T11:00:00Z").toISOString() }),
        ];
        const result = truncateFeedItems(items, 4000);
        expect(result.map((i) => i.id)).toEqual(["old", "new"]);
    });
});

describe("buildSystemPrompt", () => {
    it("includes base instructions and personality", () => {
        const prompt = buildSystemPrompt({ ...baseConfig, personality: "robot" });
        expect(prompt).toContain("You are PRMPTR");
        expect(prompt).toContain("PERSONALITY: ROBOT");
    });

    it("adds interview override only for interview contexts", () => {
        const withInterview = buildSystemPrompt({
            ...baseConfig,
            context: "preparing for a technical interview",
        });
        expect(withInterview).toContain("TECHNICAL INTERVIEW OVERRIDE");

        const withoutInterview = buildSystemPrompt(baseConfig);
        expect(withoutInterview).not.toContain("TECHNICAL INTERVIEW OVERRIDE");
    });

    it("adds ai-voice hard override when responseStyle is ai-voice", () => {
        const prompt = buildSystemPrompt({
            ...baseConfig,
            responseStyle: "ai-voice",
        });
        expect(prompt).toContain("CRITICAL OVERRIDE FOR AI VOICE");
    });

    it("reflects trigger mode", () => {
        expect(buildSystemPrompt({ ...baseConfig, triggerMode: "manual" })).toContain(
            "Manual — the user explicitly asked"
        );
        expect(buildSystemPrompt({ ...baseConfig, triggerMode: "auto" })).toContain(
            "Automatic — you're receiving live transcriptions"
        );
    });
});

describe("buildUserMessage", () => {
    it("returns placeholder when there is no new dialog", () => {
        expect(buildUserMessage([], [])).toBe("(No new dialog since last check)");
    });

    it("labels audio sources [YOU]/[THEM]/[AUDIO] by device match", () => {
        const items = [
            feedItem({ id: "1", source: "Headset Mic (input)" }),
            feedItem({ id: "2", source: "System Audio (output)" }),
            feedItem({ id: "3", source: "Unknown Device" }),
        ];
        const msg = buildUserMessage(items, undefined, undefined, {
            inputDevice: "Headset Mic",
            outputDevice: "System Audio",
        });
        expect(msg).toContain("[YOU]");
        expect(msg).toContain("[THEM]");
        expect(msg).toContain("[AUDIO]");
    });

    it("truncates long item content to 500 chars", () => {
        const msg = buildUserMessage([feedItem({ content: "x".repeat(2000) })]);
        expect(msg).not.toContain("x".repeat(501));
    });

    it("separates earlier context from new dialog", () => {
        const old = feedItem({ id: "old", timestamp: new Date("2026-01-01T10:00:00Z").toISOString() });
        const fresh = feedItem({ id: "fresh", timestamp: new Date("2026-01-01T11:00:00Z").toISOString() });
        const msg = buildUserMessage([fresh], [old]);
        expect(msg.indexOf("EARLIER CONTEXT")).toBeLessThan(msg.indexOf("NEW DIALOG"));
    });
});

describe("buildChatPrompt budget split", () => {
    it("caps history and feed sections by contextSize budget", () => {
        const history = Array.from({ length: 50 }, (_, i) => ({
            id: `h${i}`,
            type: "analysis" as const,
            content: "y".repeat(600),
            timestamp: new Date(Date.now() + i * 1000).toISOString(),
            model: "test-model",
        }));
        const feed = Array.from({ length: 50 }, (_, i) =>
            feedItem({ id: `f${i}`, content: "z".repeat(600), timestamp: new Date(Date.now() + i * 1000).toISOString() })
        );
        const config: SessionConfig = { ...baseConfig, contextSize: 2000 };
        const { userMessage } = buildChatPrompt("what happened?", history, feed, config);

        // Budget: 1200 history + 400 feed tokens; each line ~152 tokens.
        // Total message must stay well under unbounded concatenation size.
        const expectedCeiling = estimateTokens(userMessage);
        expect(expectedCeiling).toBeLessThan(2200);
    });
});

describe("buildGatePrompt", () => {
    it("asks for exactly YES or NO", () => {
        const { systemPrompt, userMessage } = buildGatePrompt([feedItem()], [], baseConfig);
        expect(systemPrompt).toMatch(/Reply with exactly one word: YES or NO/);
        expect(userMessage).toContain("--- NEW DIALOG");
    });
});
