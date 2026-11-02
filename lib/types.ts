// ============================================================
// LLM Types
// ============================================================

export type LLMProvider =
    | "anthropic"
    | "openai"
    | "groq"
    | "lmstudio"
    | "cerebras"
    | "zen"
    // "Your AI apps": models from AI clients the user already has signed in
    // (Claude Code, Codex, OpenCode, Gemini CLI, Ollama, LM Studio, ...), run
    // through OriginLM by the Rust backend. PRMPTR never sees their credentials.
    | "local-ai";

export interface ModelDef {
    id: string;
    name: string;
    provider: LLMProvider;
    speed: "blazing" | "fast" | "moderate";
    description: string;
    maxTokens: number;
    costPer1kInput?: number;
    costPer1kOutput?: number;
}

export interface LLMRequest {
    systemPrompt: string;
    userMessage: string;
    imageDataUrl?: string;
    model: string;
    provider: LLMProvider;
    apiKey: string;
    baseUrl?: string;
    maxTokens?: number;
    temperature?: number;
    signal?: AbortSignal;
}

// ============================================================
// Session Types
// ============================================================

export type TriggerMode = "auto" | "manual" | "smart";
export type ResponseStyle = "concise" | "detailed" | "ai-voice";
export type Personality =
    | "roast"
    | "witty"
    | "hype"
    | "sarcastic"
    | "professional"
    | "unhinged"
    | "over-friendly"
    | "valley-girl"
    | "grandpa"
    | "robot";

export interface PersonalityDef {
    id: Personality;
    name: string;
    description: string;
}

export const PERSONALITIES: PersonalityDef[] = [
    { id: "roast", name: "Roast Master", description: "Burns, comebacks, and playful insults" },
    { id: "witty", name: "Witty", description: "Clever and sharp without the meanness" },
    { id: "hype", name: "Hype Man", description: "Supportive, encouraging, gasses you up" },
    { id: "sarcastic", name: "Sarcastic", description: "Dry humor and deadpan delivery" },
    { id: "professional", name: "Professional", description: "Polished, factual, business-appropriate" },
    { id: "unhinged", name: "Unhinged", description: "No filter, maximum chaos energy" },
    { id: "over-friendly", name: "Over-Friendly", description: "Absurdly nice — everything is wonderful for no reason" },
    { id: "valley-girl", name: "Valley Girl", description: "Like, totally casual, you know?" },
    { id: "grandpa", name: "Grandpa", description: "Folksy wisdom, 'back in my day' vibes" },
    { id: "robot", name: "Robot", description: "Cold, logical, minimal emotion" },
];

export interface SessionConfig {
    context: string;
    triggerMode: TriggerMode;
    responseStyle: ResponseStyle;
    personality: Personality;
    autoIntervalSecs: number;
    contextSize: number;
    model: string;
    provider: LLMProvider;
    /**
     * OriginLM route for `provider: "local-ai"` (`model` is the OriginLM
     * model id). Absent for every other provider.
     */
    localAi?: LocalAiRoute;
}

/** Identifies one model on one installed AI app, as reported by OriginLM. */
export interface LocalAiRoute {
    routeId: string;
    revision: string;
    nativeId?: string;
    providerName?: string;
    /** OriginLM display name, e.g. "Claude Haiku 5.5". */
    name?: string;
    supportsImageInput?: boolean;
}

export interface SessionTemplate {
    id: string;
    name: string;
    icon: string;
    description: string;
    contextPrefill: string;
    defaults: {
        triggerMode: TriggerMode;
        responseStyle: ResponseStyle;
        personality?: Personality;
        autoIntervalSecs: number;
        temperature: number;
    };
}

// ============================================================
// Response / Session History
// ============================================================

export interface ResponseEntry {
    id: string;
    content: string;
    timestamp: string;
    model: string;
    type?: "analysis" | "chat";
    userMessage?: string;
    screenshotDataUrl?: string;
}

export interface SessionSummary {
    id: string;
    title: string;
    updatedAt: string;
    responseCount: number;
    model: string;
    starred?: boolean;
}

// ============================================================
// Feed Item (unified for display)
// ============================================================

export interface FeedItem {
    id: string;
    type: "ocr" | "audio";
    content: string;
    timestamp: string;
    source: string;
    windowName?: string;
    speaker?: number;
    speakerLabel?: string;
    deviceType?: "input" | "output";
    isFinal?: boolean;
}

// ============================================================
// Keyboard Shortcuts
// ============================================================

export type ShortcutAction = "analyze" | "clear" | "settingsPanel";

export interface ShortcutBinding {
    keys: string;
    label: string;
}

export type ShortcutConfig = Record<ShortcutAction, ShortcutBinding>;

export const DEFAULT_SHORTCUTS: ShortcutConfig = {
    analyze: { keys: "ctrl+shift+space", label: "Ctrl+Shift+Space" },
    clear: { keys: "ctrl+shift+x", label: "Ctrl+Shift+X" },
    settingsPanel: { keys: "ctrl+shift+2", label: "Ctrl+Shift+2" },
};

// ============================================================
// App Settings
// ============================================================

export interface AppSettings {
    lmstudioUrl: string;
    voiceReplyEnabled?: boolean;
    ttsProvider?: "local-sherpa" | "remote-http";
    ttsEndpoint?: string;
    ttsApiKey?: string;
    ttsVoice?: string;
    ttsModel?: string;
    ttsRegion?: string;
    ttsRate?: number;
    ttsVolume?: number;
    audioDevice?: string;
    outputDevice?: string;
    muteInput?: boolean;
    muteOutput?: boolean;
    includeScreenshotOnAnalyze?: boolean;
    deepgramApiKey?: string;
    /** "local-whisper" is the legacy name kept for saved settings; it runs the on-device engine. */
    transcriptionMode?: "local-whisper" | "direct-deepgram";
    localPreferGpu?: boolean;
    /** Personal glossary, one entry per line: `Term` or `Term = mishearing, …`. */
    glossary?: string;
    apiKeys: {
        anthropic?: string;
        openai?: string;
        groq?: string;
        cerebras?: string;
        zen?: string;
    };
    defaultProvider: LLMProvider;
    defaultModel: string;
    shortcuts: ShortcutConfig;
}

// ============================================================
// Model Registry
// ============================================================

// Static catalog shown before a provider's live model list loads (and when
// it can't be fetched). Live lists from each provider's /models endpoint are
// authoritative; keep this to current, fast models suited to real-time use.
// Prices are USD per 1K tokens.
export const MODELS: ModelDef[] = [
    // LM Studio (local)
    {
        id: "lmstudio-auto",
        name: "LM Studio (auto)",
        provider: "lmstudio",
        speed: "fast",
        description: "Uses whatever model is loaded in LM Studio",
        maxTokens: 4096,
    },
    // Anthropic
    {
        id: "claude-haiku-5-5",
        name: "Claude Haiku 5.5",
        provider: "anthropic",
        speed: "blazing",
        description: "Fastest Claude — ideal for live suggestions",
        maxTokens: 8192,
        costPer1kInput: 0.0001,
        costPer1kOutput: 0.0005,
    },
    {
        id: "claude-sonnet-5-5",
        name: "Claude Sonnet 5.5",
        provider: "anthropic",
        speed: "fast",
        description: "Sharper writing and reasoning, still quick",
        maxTokens: 8192,
        costPer1kInput: 0.002,
        costPer1kOutput: 0.01,
    },
    {
        id: "claude-opus-5-5",
        name: "Claude Opus 5.5",
        provider: "anthropic",
        speed: "moderate",
        description: "Most capable Claude for deep analysis",
        maxTokens: 8192,
        costPer1kInput: 0.004,
        costPer1kOutput: 0.02,
    },
    // OpenAI
    {
        id: "gpt-6.1-terra",
        name: "GPT-6.1 Terra",
        provider: "openai",
        speed: "blazing",
        description: "Fast, efficient OpenAI model",
        maxTokens: 8192,
    },
    {
        id: "gpt-6.1-sol",
        name: "GPT-6.1 Sol",
        provider: "openai",
        speed: "fast",
        description: "Balanced intelligence and cost",
        maxTokens: 8192,
    },
    {
        id: "gpt-6-astra",
        name: "GPT-6 Astra",
        provider: "openai",
        speed: "moderate",
        description: "OpenAI's most capable model",
        maxTokens: 8192,
    },
    {
        id: "gpt-6-luna",
        name: "GPT-6 Luna",
        provider: "openai",
        speed: "blazing",
        description: "Lowest-cost OpenAI model",
        maxTokens: 8192,
    },
    // Groq
    {
        id: "openai/gpt-oss-20b",
        name: "GPT-OSS 20B",
        provider: "groq",
        speed: "blazing",
        description: "Fastest, best price/performance",
        maxTokens: 4096,
        costPer1kInput: 0.000075,
        costPer1kOutput: 0.0003,
    },
    {
        id: "openai/gpt-oss-120b",
        name: "GPT-OSS 120B",
        provider: "groq",
        speed: "fast",
        description: "Strong quality, great value",
        maxTokens: 4096,
        costPer1kInput: 0.00015,
        costPer1kOutput: 0.0006,
    },
    // Cerebras
    {
        id: "gpt-oss-120b",
        name: "GPT-OSS 120B (Cerebras)",
        provider: "cerebras",
        speed: "blazing",
        description: "Wafer-scale speed, thousands of tokens/sec",
        maxTokens: 4096,
    },
];
