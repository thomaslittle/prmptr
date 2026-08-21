// ============================================================
// Screenpipe Types
// ============================================================

export interface ScreenpipeQuery {
    q?: string;
    contentType?: "ocr" | "audio" | "all";
    limit?: number;
    offset?: number;
    startTime?: string;
    endTime?: string;
    appName?: string;
    windowName?: string;
    includeFrames?: boolean;
    minLength?: number;
    maxLength?: number;
    speakerIds?: number[];
    speakerName?: string;
    browserUrl?: string;
}

export interface ScreenpipeOCRContent {
    frameId: number;
    text: string;
    timestamp: string;
    filePath: string;
    appName: string;
    windowName: string;
    tags: string[];
    frame?: string;
    browserUrl?: string;
}

export interface ScreenpipeAudioContent {
    chunkId: number;
    transcription: string;
    timestamp: string;
    filePath: string;
    deviceName: string;
    deviceType: string;
    speaker?: {
        id: number;
        name?: string;
    };
}

export interface ScreenpipeResult {
    type: "OCR" | "Audio";
    content: ScreenpipeOCRContent | ScreenpipeAudioContent;
}

export interface ScreenpipeResponse {
    data: ScreenpipeResult[];
    pagination: {
        limit: number;
        offset: number;
        total: number;
    };
}

// ============================================================
// LLM Types
// ============================================================

export type LLMProvider = "anthropic" | "openai" | "groq" | "lmstudio" | "cerebras";

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

export interface StreamToken {
    text: string;
    isComplete: boolean;
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
    screenpipeUrl: string;
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
    enableVision?: boolean;
    includeScreenshotOnAnalyze?: boolean;
    deepgramApiKey?: string;
    transcriptionMode?: "screenpipe" | "local-whisper" | "direct-deepgram";
    localPreferGpu?: boolean;
    apiKeys: {
        anthropic?: string;
        openai?: string;
        groq?: string;
        cerebras?: string;
    };
    defaultProvider: LLMProvider;
    defaultModel: string;
    shortcuts: ShortcutConfig;
}

// ============================================================
// Model Registry
// ============================================================

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
    // Cerebras
    {
        id: "llama-3.1-8b",
        name: "Llama 3.1 8B (Cerebras)",
        provider: "cerebras",
        speed: "blazing",
        description: "Low-cost, very fast",
        maxTokens: 4096,
    },
    // Anthropic
    {
        id: "claude-sonnet-4-5-20250929",
        name: "Claude Sonnet 4.5",
        provider: "anthropic",
        speed: "fast",
        description: "Best speed/quality balance",
        maxTokens: 8192,
        costPer1kInput: 0.003,
        costPer1kOutput: 0.015,
    },
    {
        id: "claude-haiku-4-5-20251001",
        name: "Claude Haiku 4.5",
        provider: "anthropic",
        speed: "blazing",
        description: "Fastest, most cost-effective",
        maxTokens: 8192,
        costPer1kInput: 0.0008,
        costPer1kOutput: 0.004,
    },
    {
        id: "claude-opus-4-5-20250918",
        name: "Claude Opus 4.5",
        provider: "anthropic",
        speed: "moderate",
        description: "Most capable, complex analysis",
        maxTokens: 8192,
        costPer1kInput: 0.015,
        costPer1kOutput: 0.075,
    },
    // OpenAI
    {
        id: "gpt-4o",
        name: "GPT-4o",
        provider: "openai",
        speed: "fast",
        description: "Strong all-rounder",
        maxTokens: 4096,
        costPer1kInput: 0.0025,
        costPer1kOutput: 0.01,
    },
    {
        id: "gpt-4o-mini",
        name: "GPT-4o Mini",
        provider: "openai",
        speed: "blazing",
        description: "Fast and affordable",
        maxTokens: 4096,
        costPer1kInput: 0.00015,
        costPer1kOutput: 0.0006,
    },
    {
        id: "gpt-4.1",
        name: "GPT-4.1",
        provider: "openai",
        speed: "fast",
        description: "Latest model, strong reasoning",
        maxTokens: 8192,
    },
    {
        id: "gpt-4.1-mini",
        name: "GPT-4.1 Mini",
        provider: "openai",
        speed: "blazing",
        description: "Latest small model",
        maxTokens: 8192,
    },
    {
        id: "gpt-4.1-nano",
        name: "GPT-4.1 Nano",
        provider: "openai",
        speed: "blazing",
        description: "Ultra-fast, lowest cost",
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
    {
        id: "llama-3.3-70b-versatile",
        name: "Llama 3.3 70B",
        provider: "groq",
        speed: "blazing",
        description: "Fast + capable, great default",
        maxTokens: 4096,
        costPer1kInput: 0.00059,
        costPer1kOutput: 0.00079,
    },
    {
        id: "llama-3.1-8b-instant",
        name: "Llama 3.1 8B",
        provider: "groq",
        speed: "blazing",
        description: "Ultra-fast simple responses",
        maxTokens: 4096,
        costPer1kInput: 0.00005,
        costPer1kOutput: 0.00008,
    },
    {
        id: "llama-4-scout-17b-16e-instruct",
        name: "Llama 4 Scout",
        provider: "groq",
        speed: "fast",
        description: "Newest Llama, strong reasoning",
        maxTokens: 4096,
    },
    {
        id: "compound-beta",
        name: "Compound",
        provider: "groq",
        speed: "fast",
        description: "Agentic: web search + code exec",
        maxTokens: 4096,
    },
    {
        id: "compound-beta-mini",
        name: "Compound Mini",
        provider: "groq",
        speed: "blazing",
        description: "Lightweight agentic, single tool call",
        maxTokens: 4096,
    },
];

export function getAvailableModels(
    configuredProviders: LLMProvider[]
): ModelDef[] {
    return MODELS.filter(
        (m) =>
            m.provider === "lmstudio" ||
            configuredProviders.includes(m.provider)
    );
}
