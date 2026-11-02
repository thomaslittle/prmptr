// Personal glossary: names and jargon PRMPTR should get right.
//
// One entry per line: `Term` or `Term = mishearing, mishearing`.
// - The speech engine biases Parakeet toward each term (or prompts Whisper),
//   and rewrites the listed mishearings to the term (src-tauri stt_engine.rs).
// - Suggestions get the terms too, so the LLM spells them correctly.

export const MAX_GLOSSARY_TERMS = 64;

/** Non-empty, trimmed glossary lines, capped (the engine re-validates). */
export function glossaryLines(text: string | undefined): string[] {
    return (text ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("#"))
        .slice(0, MAX_GLOSSARY_TERMS);
}

/** Just the terms (left of `=`), de-duplicated case-insensitively. */
export function glossaryTerms(text: string | undefined): string[] {
    const seen = new Set<string>();
    const terms: string[] = [];
    for (const line of glossaryLines(text)) {
        const term = line.split("=")[0].replace(/\s+/g, " ").trim().slice(0, 48);
        const key = term.toLowerCase();
        if (!term || seen.has(key)) continue;
        seen.add(key);
        terms.push(term);
    }
    return terms;
}

/** System-prompt line for suggestions, or "" when the glossary is empty. */
export function glossaryPromptLine(text: string | undefined): string {
    const terms = glossaryTerms(text)
        // Terms are user text inside a prompt: keep them single-line and free
        // of characters that could forge transcript markers.
        .map((t) => t.replace(/[[\]\r\n]/g, " ").trim())
        .filter(Boolean);
    if (terms.length === 0) return "";
    return `\n\nNames and terms that may come up — use these exact spellings: ${terms.join(", ")}.`;
}
