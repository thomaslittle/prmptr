/**
 * Friendly display metadata for OpenCode Zen model ids.
 * Zen ids are lowercase slugs ("x-preview-f-free", "gpt-5.6-sol"); this maps
 * them to human-readable names and flags the free tier.
 */

const ZEN_MODEL_NAME_OVERRIDES: Record<string, string> = {
    "x-preview-f-free": "Ox Alpha Free",
    "big-pickle": "Big Pickle",
    "mimo-v2.5-free": "MiMo-V2.5 Free",
    "hy3-free": "Hy3 Free",
    "nemotron-3-ultra-free": "Nemotron 3 Ultra Free",
    "nemotron-3.5-lightning-free": "Nemotron 3.5 Lightning Free",
    "muse-spark-1.2-contributor-free": "Muse Spark 1.2 Contributor Free",
    "muse-spark-1.2": "Muse Spark 1.2",
    "grok-build-0.1": "Grok Build 0.1",
};

const TOKEN_OVERRIDES: Record<string, string> = {
    gpt: "GPT",
    glm: "GLM",
    ai: "AI",
    mimo: "MiMo",
    deepseek: "DeepSeek",
    minimax: "MiniMax",
};

function prettifyToken(token: string): string {
    const lower = token.toLowerCase();
    if (TOKEN_OVERRIDES[lower]) return TOKEN_OVERRIDES[lower];
    // Version-ish tokens (v4, k3, 5.6, m3) stay as-is
    if (/^v\d/i.test(lower)) return `V${lower.slice(1)}`;
    return token.charAt(0).toUpperCase() + token.slice(1);
}

/** "deepseek-v4-pro" → "DeepSeek V4 Pro"; known ids get curated names. */
export function zenModelDisplayName(id: string): string {
    const override = ZEN_MODEL_NAME_OVERRIDES[id];
    if (override) return override;
    return id
        .split("-")
        .map(prettifyToken)
        .join(" ");
}

/** Free-tier Zen models (no billing required). */
export function isFreeZenModel(id: string): boolean {
    return id.endsWith("-free") || id === "big-pickle";
}
