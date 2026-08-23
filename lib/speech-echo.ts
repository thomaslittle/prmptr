import type { TranscriptLine } from "@/lib/transcript";

export interface CrossChannelEchoDiagnostics {
    comparablePairs: number;
    duplicateCandidates: number;
    duplicateCandidateRate: number | null;
    maxStartDeltaMs: number;
    similarityThreshold: number;
}

function normalizedTokens(text: string): string[] {
    return text
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}\s]+/gu, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 1);
}

function diceSimilarity(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    const counts = new Map<string, number>();
    for (const token of a) counts.set(token, (counts.get(token) ?? 0) + 1);
    let overlap = 0;
    for (const token of b) {
        const count = counts.get(token) ?? 0;
        if (count > 0) {
            overlap += 1;
            counts.set(token, count - 1);
        }
    }
    return (2 * overlap) / (a.length + b.length);
}

function nearInTime(a: TranscriptLine, b: TranscriptLine, maxStartDeltaMs: number): boolean {
    const overlaps = Math.max(a.startMs, b.startMs) <= Math.min(a.endMs, b.endMs);
    return overlaps || Math.abs(a.startMs - b.startMs) <= maxStartDeltaMs;
}

/**
 * Evidence-only detector for likely playback leakage between the authoritative
 * mic (YOU) and system (THEM) tracks. It intentionally never mutates or
 * suppresses transcript lines; benchmark evidence must justify any future AEC
 * or dedup action.
 */
export function analyzeCrossChannelEcho(
    lines: TranscriptLine[],
    options: { maxStartDeltaMs?: number; similarityThreshold?: number } = {}
): CrossChannelEchoDiagnostics {
    const maxStartDeltaMs = Math.max(0, options.maxStartDeltaMs ?? 2_000);
    const similarityThreshold = Math.max(0, Math.min(1, options.similarityThreshold ?? 0.82));
    const complete = lines.filter((line) => line.isComplete && line.text.trim().length > 0);
    const mic = complete.filter((line) => line.trackId === "mic");
    const system = complete.filter((line) => line.trackId === "system");

    let comparablePairs = 0;
    let duplicateCandidates = 0;
    for (const micLine of mic) {
        const micTokens = normalizedTokens(micLine.text);
        if (micTokens.length === 0) continue;
        for (const systemLine of system) {
            if (!nearInTime(micLine, systemLine, maxStartDeltaMs)) continue;
            const systemTokens = normalizedTokens(systemLine.text);
            if (systemTokens.length === 0) continue;
            comparablePairs += 1;
            if (diceSimilarity(micTokens, systemTokens) >= similarityThreshold) {
                duplicateCandidates += 1;
            }
        }
    }

    return {
        comparablePairs,
        duplicateCandidates,
        duplicateCandidateRate:
            comparablePairs === 0 ? null : duplicateCandidates / comparablePairs,
        maxStartDeltaMs,
        similarityThreshold,
    };
}
