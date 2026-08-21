function stripFormatting(input: string): string {
    return input
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
        .replace(/\[(AUDIO|YOU|THEM|SCREEN)\]\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\s*:\s*/gi, " ")
        .replace(/\[(AUDIO|YOU|THEM|SCREEN)\]\s*/gi, " ")
        .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)\s*:\s*/gi, " ")
        .replace(/^\s*[*#>\-]+\s*/gm, "")
        .replace(/\*\*/g, "")
        .replace(/[_~]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function isBanter(sentence: string): boolean {
    const s = sentence.trim().toLowerCase();
    return (
        /testing my patience/.test(s) ||
        /master of chaos/.test(s) ||
        /\b(great question|nice try|seriously|buddy|pal|dude|bro|genius)\b/.test(s) ||
        /aren't you\??$/.test(s) ||
        /^well,?\s/.test(s) ||
        /^ah,?\s/.test(s)
    );
}

function scoreSentence(sentence: string): number {
    const s = sentence.trim();
    const lower = s.toLowerCase();
    let score = 0;

    if (!s.endsWith("?")) score += 1;
    if (/[.!]$/.test(s)) score += 1;
    if (isBanter(s)) score -= 4;
    if (s.includes('"')) score -= 1;

    if (/\b(third amendment|amendment|constitution)\b/i.test(s)) score += 2;
    if (/\b(is|means|refers to|prohibits|states|says|allows|forbids)\b/i.test(s)) score += 2;
    if (/\b(quarter|soldiers|peacetime|consent)\b/i.test(s)) score += 2;

    const words = s.split(/\s+/).filter(Boolean).length;
    if (words >= 8 && words <= 26) score += 2;
    else if (words > 30) score -= 1;

    return score;
}

export function selectBestSpokenLine(input: string, maxChars = 220, maxWords = 28): string {
    const cleaned = stripFormatting(input)
        .replace(/^["']+|["']+$/g, "")
        .trim();
    if (!cleaned) return "";

    const sentences = cleaned
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim().replace(/^["']+|["']+$/g, ""))
        .filter(Boolean);

    const candidates = sentences.length > 0 ? sentences : [cleaned];
    const best = [...candidates].sort((a, b) => scoreSentence(b) - scoreSentence(a))[0] || cleaned;

    const words = best.split(/\s+/).filter(Boolean).slice(0, Math.max(10, maxWords));
    const joined = words.join(" ").trim();
    const hardCap = Math.max(90, maxChars);
    let out = joined;
    if (joined.length > hardCap) {
        const sliced = joined.slice(0, hardCap);
        const lastSpace = sliced.lastIndexOf(" ");
        out = (lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced).trim();
    }
    out = out.replace(/^["']+|["']+$/g, "").trim();
    if (!out) return "";
    if (!/[.!?]$/.test(out)) {
        if (joined.length > out.length) out += "...";
        else out += ".";
    }
    return out;
}
