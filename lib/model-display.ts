import { LLMProvider } from "./types";
import { zenModelDisplayName } from "./zen-models";

/**
 * Shared model display-name formatting + ordering/legacy heuristics.
 * Mirrors t3chat's `getDisplayModelName` / legacy-section behaviour so the
 * model list rows and the picker trigger render the same human-friendly name.
 */

const CLAUDE_DATE_SUFFIX_RE = /-\d{8}$/;

const TOKEN_OVERRIDES: Record<string, string> = {
    gpt: "GPT",
    o: "o",
    glm: "GLM",
    ai: "AI",
    mini: "Mini",
    nano: "Nano",
    codex: "Codex",
    fable: "Fable",
    opus: "Opus",
    sonnet: "Sonnet",
    haiku: "Haiku",
    sol: "Sol",
    terra: "Terra",
    luna: "Luna",
    claude: "Claude",
    llama: "Llama",
    deepseek: "DeepSeek",
    qwen: "Qwen",
    mistral: "Mistral",
    large: "Large",
};

function capitalizeToken(token: string): string {
    const lower = token.toLowerCase();
    if (TOKEN_OVERRIDES[lower]) return TOKEN_OVERRIDES[lower];
    if (/^(4|5)(\.\d+)?$/.test(token)) return token;
    if (/^v\d/i.test(lower)) return `V${lower.slice(1)}`;
    return /^[a-z]/i.test(token) ? token.charAt(0).toUpperCase() + token.slice(1) : token;
}

/**
 * Pretty-formats a model id into a stable, human display name. The same value
 * is used for the list row and the picker trigger so they always agree.
 *
 * - OpenAI: `gpt-5.6-sol` → `GPT-5.6-Sol`, `gpt-5.4-mini` → `GPT-5.4-Mini`
 * - Claude: `claude-opus-4-5-20250918` → `Claude Opus 4.5`, `claude-fable-5` → `Claude Fable 5`
 * - Codex:  `gpt-5-codex` → `GPT-5-Codex`
 */
export function modelDisplayName(id: string, provider?: LLMProvider): string {
    let value = id.trim();

    // Zen / OpenCode CLI models have curated human names ("x-preview-f-free" →
    // "Ox Alpha Free") that the generic tokenizer would mangle. Use them as-is.
    if (provider === "zen" || provider === "opencode-cli") {
        return zenModelDisplayName(id);
    }

    // Strip Anthropic's trailing date stamp before title-casing.
    if (provider === "anthropic" || provider === "claude-cli") {
        value = value.replace(CLAUDE_DATE_SUFFIX_RE, "");
    }

    // Keep OpenAI/Codex core model tokens joined by "-" (GPT-5.6, GPT-5.4).
    const isOpenAiStyle =
        provider === "openai" || provider === "codex-cli" || provider === "groq" || provider === "cerebras";
    if (isOpenAiStyle) {
        const tokens = value.split("-").map(capitalizeToken);
        return tokens.join("-");
    }

    // Claude-style: `claude-opus-4-5` → "Claude Opus 4.5".
    // Collapse the escaped 4-5/4-5-2 version into a dotted group, then title-case.
    if (provider === "anthropic" || provider === "claude-cli") {
        const parts = value.split("-");
        const version: string[] = [];
        const head: string[] = [];
        for (const part of parts) {
            if (/^\d+$/.test(part) && version.length < 3) {
                version.push(part);
            } else {
                head.push(capitalizeToken(part));
            }
        }
        const title = head.join(" ");
        const versionText = version.length > 0 ? ` ${version.join(".")}` : "";
        return `${title}${versionText}`.trim();
    }

    // Generic fallback: title-case each dash/hyphen token.
    return value
        .split(/[-_]/)
        .map(capitalizeToken)
        .join(" ");
}

/** Extract a comparable numeric version (major/minor) from a model id, or null. */
function extractVersion(id: string): { major: number; minor: number } | null {
    const re = /(?:^|-)(\d+)(?:[-.](\d+))?/;
    const m = id.match(re);
    if (!m) return null;
    return { major: parseInt(m[1], 10), minor: m[2] ? parseInt(m[2], 10) : 0 };
}

/**
 * Model family: the leading non-version tokens of an id. Version counters
 * are only comparable within one family — "muse-spark-1.3" is not an older
 * generation of "gpt-5.6", so cross-family comparisons must not decide
 * legacy status.
 *
 * - "muse-spark-1.3-contributor-free" → "muse-spark"
 * - "gpt-5.6-sol" → "gpt"
 * - "llama-3.3-70b-versatile" → "llama"
 * - "grok-build-0.1" → "grok-build"
 */
function extractFamily(id: string): string {
    const tokens = id.trim().toLowerCase().split(/[-_]/);
    const head: string[] = [];
    for (const token of tokens) {
        // Stop at the first version-like token ("4", "5.6", "v2", "70b").
        if (/^(v?\d)/i.test(token)) break;
        head.push(token);
    }
    return head.length > 0 ? head.join("-") : id.trim().toLowerCase();
}

/**
 * Current/legacy split for a provider's models. A model is "legacy" only
 * when an older version exists *within its own family* (same leading
 * non-version tokens). Comparing raw version numbers across families is
 * meaningless — e.g. "muse-spark-1.3" must stay current next to "gpt-5.6",
 * while "gpt-5.4" is legacy next to "gpt-5.6". Matches t3chat's "Legacy
 * models" collapsible section.
 */
export interface ModelVersionInfo {
    version: { major: number; minor: number } | null;
    isLegacy: boolean;
}

export function modelVersionInfo(id: string, provider: LLMProvider, siblings: readonly string[]): ModelVersionInfo {
    const version = extractVersion(id);
    if (!version) return { version: null, isLegacy: false };

    // Claude: only the newest family (major == max major) is current. The user
    // expects e.g. Fable 5 / Opus 5 / Sonnet 5 to stay current and everything
    // older to collapse under Legacy.
    if (provider === "anthropic" || provider === "claude-cli") {
        let maxMajor = version.major;
        for (const sibling of siblings) {
            const v = extractVersion(sibling);
            if (v && Number.isFinite(v.major)) maxMajor = Math.max(maxMajor, v.major);
        }
        return { version, isLegacy: version.major < maxMajor };
    }

    const siblingVersions = siblings
        .filter((sibling) => extractFamily(sibling) === extractFamily(id))
        .map(extractVersion)
        .filter((v): v is { major: number; minor: number } => !!v);
    if (siblingVersions.length === 0) return { version, isLegacy: false };

    let maxMinor = -1;
    let maxMajor = -1;
    for (const s of siblingVersions) {
        if (s.major > maxMajor || (s.major === maxMajor && s.minor > maxMinor)) {
            maxMajor = s.major;
            maxMinor = s.minor;
        }
    }
    const isLegacy =
        version.major < maxMajor || (version.major === maxMajor && version.minor < maxMinor);
    return { version, isLegacy };
}

/** Stable comparator: newer versions first, then alphabetical. */
export function compareModelVersions(a: { major: number; minor: number } | null, b: { major: number; minor: number } | null): number {
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    if (a.major !== b.major) return b.major - a.major;
    return b.minor - a.minor;
}
