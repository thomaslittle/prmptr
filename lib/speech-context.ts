import type { FeedItem } from "@/lib/types";

const STOPWORDS = new Set([
    "about", "after", "again", "also", "because", "before", "being", "between", "could",
    "every", "first", "from", "have", "into", "just", "more", "most", "other", "over",
    "same", "should", "some", "such", "than", "that", "their", "them", "then", "there",
    "these", "they", "this", "those", "through", "very", "what", "when", "where", "which",
    "while", "with", "would", "your",
]);

export interface SpeechBiasContext {
    context: string;
    keyterms: string[];
}

function clean(value: string): string {
    return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenScore(token: string): number {
    const plain = token.replace(/^[^\p{L}\p{N}_@#]+|[^\p{L}\p{N}_@#.+/-]+$/gu, "");
    if (plain.length < 3 || plain.length > 96) return -1;
    if (STOPWORDS.has(plain.toLowerCase())) return -1;
    let score = 0;
    if (/[A-Z].*[A-Z]|[a-z][A-Z]/.test(plain)) score += 5; // acronym/camelCase
    if (/[_@#./+-]/.test(plain)) score += 4; // code/path/product-like
    if (/\d/.test(plain)) score += 3;
    if (/^[A-Z][\p{L}\d-]{2,}$/u.test(plain)) score += 3; // proper noun
    if (plain.length >= 8) score += 2;
    if (plain.length >= 12) score += 1;
    return score;
}

export function extractSpeechKeyterms(text: string, maxTerms = 120): string[] {
    const counts = new Map<string, { display: string; count: number; score: number }>();
    for (const raw of clean(text).split(/\s+/)) {
        const display = raw.replace(/^[^\p{L}\p{N}_@#]+|[^\p{L}\p{N}_@#.+/-]+$/gu, "");
        const score = tokenScore(display);
        if (score < 0) continue;
        const key = display.toLowerCase();
        const existing = counts.get(key);
        if (existing) existing.count += 1;
        else counts.set(key, { display, count: 1, score });
    }
    return [...counts.values()]
        .sort((a, b) => b.score + Math.min(b.count, 4) - (a.score + Math.min(a.count, 4)) || b.count - a.count || a.display.localeCompare(b.display))
        .slice(0, Math.max(0, Math.min(maxTerms, 200)))
        .map((entry) => entry.display);
}

export function buildSpeechBiasContext(options: {
    sessionContext?: string;
    feedItems?: FeedItem[];
    extraText?: string;
    maxContextChars?: number;
    maxTerms?: number;
}): SpeechBiasContext {
    const maxContextChars = Math.max(1_000, Math.min(options.maxContextChars ?? 24_000, 32_000));
    const visualText = (options.feedItems ?? [])
        .filter((item) => item.type === "ocr")
        .slice(0, 40)
        .map((item) => [item.windowName, item.content].filter(Boolean).join(": "))
        .join("\n");
    const context = clean(
        [options.sessionContext, options.extraText, visualText].filter(Boolean).join("\n")
    ).slice(-maxContextChars);
    return {
        context,
        keyterms: extractSpeechKeyterms(context, options.maxTerms ?? 120),
    };
}
