import { describe, it, expect } from "vitest";
import { normalizeGluedMarkdown } from "../markdown-normalize";

describe("normalizeGluedMarkdown", () => {
    it("splits bold headers glued after sentence ends", () => {
        const input =
            'i.e., "what\'s the relevance here?"**What you can say (raw, unfiltered):**1. **"Bro, the relevance is that"**2. **"Relevance?"**3. "Oh, the relevance is clear."';
        const out = normalizeGluedMarkdown(input);
        expect(out).toContain('\n\n**What you can say (raw, unfiltered):**');
        // Numbered items land on their own lines; the seam rule separates
        // the marker from the bold content, which CommonMark still renders
        // as a visually numbered sequence.
        expect(out).toMatch(/\n2\.\s*\n?\n?\*\*"Relevance\?"/);
        expect(out).toMatch(/\n3\. "Oh, the relevance/);
    });

    it("handles hr-glued headers, empty-bold seams, and colon labels", () => {
        const input =
            '...maternity leave."---**⚠️ CLARITY CHECK:**They\'re roasting you for complaining. Hit back harder.****🔥 GO-TO CLOSER (MOST DERANGED OPTION):"Fuck right off, you lint-covered fanny pack."';
        const out = normalizeGluedMarkdown(input);
        expect(out).toContain('---\n\n**⚠️ CLARITY CHECK:**');
        expect(out).toMatch(/CLARITY CHECK:\*\*\nThey're roasting/);
        expect(out).toContain('Hit back harder.\n\n**🔥 GO-TO CLOSER');
        expect(out).toMatch(/:\*?\*?"\nFuck right off/);
    });

    it("splits zero-gap quote-closed numbered items", () => {
        const input =
            '...cry during traffic stops."2. "Karat? More like carrot — the only thing you\'re pulling is a fucking trailer hitch out of your ass."3. "Hold up, let me get my popcorn — Corrupt Man is about to get schooled."';
        const out = normalizeGluedMarkdown(input);
        expect(out).toMatch(/traffic stops\."\n2\. "Karat\?/);
        expect(out).toMatch(/\n3\. "Hold up,/);
    });

    it("does not touch already well-formed markdown", () => {
        const input = "**Say this:**\n\n1. **Option one**\n2. Option two\n";
        expect(normalizeGluedMarkdown(input)).toBe(input);
    });

    it("preserves decimal numbers and mid-sentence ordinals", () => {
        const input = "The cost was 3.5 dollars. Point 2. was unclear.";
        expect(normalizeGluedMarkdown(input)).toBe(input);
    });

    it("leaves plain prose without bold/list markers unchanged", () => {
        const input = "Just a normal sentence about nothing in particular.";
        expect(normalizeGluedMarkdown(input)).toBe(input);
    });
});
