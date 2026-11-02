"use client";

import { useState, useCallback, useRef, useEffect, useSyncExternalStore } from "react";
import { ErrorBoundary } from "@/components/error-boundary";

const subscribeNoop = () => () => {};
import {
    FeedItem,
    SessionConfig,
    ResponseEntry,
    AppSettings,
} from "@/lib/types";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { glossaryPromptLine } from "@/lib/glossary";
import { useSessionStore } from "@/lib/stores/session-store";
import { buildSystemPrompt, buildUserMessage, buildChatPrompt, truncateFeedItems, DeviceNames } from "@/lib/prompt-builder";
import { selectBestSpokenLine } from "@/lib/spoken-line";
import { normalizeGluedMarkdown } from "@/lib/markdown-normalize";
import { sessionModelLabel } from "@/lib/model-display";
import {
    LlmCall,
    RateLimitError,
    fallbackModelForProvider,
    fetchModelImageSupport,
    modelSupportsImageInput,
    providerNeedsApiKey,
    streamCompletion,
} from "@/lib/llm-client";
import { LlmRequestError, formatLlmErrorMarkdown, type LlmErrorInfo } from "@/lib/llm-errors";
import { captureScreenshot } from "@/lib/tauri";
import Markdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Lightning, PaperPlaneTilt, Eraser, CircleNotch, Brain, ChatCircle, Lightbulb, PushPin, WarningCircle } from "@phosphor-icons/react";
import { Empty, EmptyMedia, EmptyHeader, EmptyTitle, EmptyDescription } from "@/components/ui/empty";

interface AiResponseProps {
    feedItems: FeedItem[];
    sessionConfig: SessionConfig;
    apiKeys: AppSettings["apiKeys"];
    lmstudioUrl?: string;
    triggerCount?: number;
    clearCount?: number;
    onResponseComplete?: (entry: ResponseEntry) => void;
    devices?: DeviceNames;
}

/** "Your AI apps" selected but no concrete model picked yet (e.g. after migration). */
function needsLocalAiModel(config: SessionConfig): boolean {
    return config.provider === "local-ai" && (!config.model || !config.localAi?.routeId);
}

async function optimizeImageDataUrl(dataUrl: string): Promise<string> {
    if (typeof window === "undefined") return dataUrl;
    if (!dataUrl.startsWith("data:image/")) return dataUrl;

    try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = () => reject(new Error("Failed to load screenshot for optimization"));
            el.src = dataUrl;
        });

        const maxDimension = 1280;
        const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
        const width = Math.max(1, Math.round(img.width * scale));
        const height = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return dataUrl;
        ctx.drawImage(img, 0, 0, width, height);

        const compressed = canvas.toDataURL("image/jpeg", 0.72);
        return compressed.length < dataUrl.length ? compressed : dataUrl;
    } catch {
        return dataUrl;
    }
}

// ── Response Section Parser ─────────────────────────────────

type SectionCategory = "action" | "dialog" | "knowledge" | "context";

interface BadgeSection {
    type: "badge";
    label: string;
    content: string;
    category: SectionCategory;
}

interface TextSection {
    type: "text";
    content: string;
}

type ResponseSection = BadgeSection | TextSection;

// Known emoji → category
const EMOJI_CATEGORIES: Record<string, SectionCategory> = {
    "🔥": "action", "✨": "action", "💪": "action",
    "😐": "action", "💼": "action", "🤪": "action",
    "💬": "dialog", "💀": "dialog",
    "🤓": "knowledge", "🧠": "knowledge", "📊": "knowledge",
    "🔑": "knowledge", "🙄": "knowledge",
    "📌": "context",
};

// Label text → category (for when model omits emoji)
const LABEL_MAP: Record<string, SectionCategory> = {
    "roast": "action", "burn": "action", "clever": "action",
    "power move": "action", "deadpan": "action", "talking point": "action",
    "chaos": "action", "wild takes": "action",
    "say this": "dialog", "say this if you dare": "dialog",
    "actually": "knowledge", "actually...": "knowledge", "fun fact": "knowledge",
    "cursed knowledge": "knowledge", "answer questions": "knowledge",
    "data point": "knowledge", "key point": "knowledge", "obviously": "knowledge",
    "know this": "context",
};

function classifyLabel(raw: string): { label: string; category: SectionCategory } | null {
    // 1. Try emoji prefix — strip it for display
    for (const [emoji, category] of Object.entries(EMOJI_CATEGORIES)) {
        if (raw.startsWith(emoji)) {
            return { label: raw.slice(emoji.length).trim() || raw, category };
        }
    }
    // 2. Text-based match
    const cleaned = raw.replace(/[:.\u2026…]+$/, "").trim().toLowerCase();
    const cat = LABEL_MAP[cleaned];
    if (cat) return { label: raw.replace(/[:.\u2026…]+$/, "").trim(), category: cat };
    return null;
}

function parseResponseContent(content: string): ResponseSection[] {
    const sections: ResponseSection[] = [];
    const lines = content.split("\n");
    let current: BadgeSection | null = null;
    let buffer: string[] = [];

    const flushBuffer = () => {
        const text = buffer.join("\n").trim();
        if (text) sections.push({ type: "text", content: text });
        buffer = [];
    };
    const flushBadge = () => {
        if (current) {
            current.content = current.content.trim();
            sections.push(current);
            current = null;
        }
    };

    for (const line of lines) {
        const m = line.match(/^\*\*(.+?)\*\*\s*(.*)/);
        if (m) {
            const classified = classifyLabel(m[1]);
            if (classified) {
                flushBuffer();
                flushBadge();
                current = {
                    type: "badge",
                    label: classified.label,
                    content: m[2] || "",
                    category: classified.category,
                };
                continue;
            }
        }
        if (current) {
            current.content += (current.content ? "\n" : "") + line;
        } else {
            buffer.push(line);
        }
    }
    flushBuffer();
    flushBadge();
    return sections;
}

function sanitizeAiVoiceContent(content: string): string {
    return content
        .replace(/\[(AUDIO|YOU|THEM|SCREEN)\]\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\s*:\s*/gi, "")
        .replace(/\[(AUDIO|YOU|THEM|SCREEN)\]\s*/gi, "")
        .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)\s*:\s*/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}

function clampAiVoiceLine(content: string, maxWords = 28, maxChars = 220): string {
    const cleaned = sanitizeAiVoiceContent(content)
        .trim();
    if (!cleaned) return "";
    return selectBestSpokenLine(cleaned, maxChars, maxWords);
}

function extractLatestQuestion(items: FeedItem[]): string | null {
    for (let i = items.length - 1; i >= 0; i--) {
        const content = (items[i]?.content || "").trim();
        if (!content) continue;
        const matches = content.match(/[^?]*\?/g);
        if (matches && matches.length > 0) {
            return matches[matches.length - 1].trim();
        }
    }
    return null;
}

function isWeakAiVoiceLine(line: string): boolean {
    const s = line.trim().toLowerCase();
    if (!s) return true;
    if (s.split(/\s+/).length < 6) return true;
    return (
        /testing my patience/.test(s) ||
        /master of chaos/.test(s) ||
        /allergic to the third amendment/.test(s) ||
        /\b(you'?re really|dude|bro|genius|sanity|limits)\b/.test(s)
    );
}

const CATEGORY_ICONS: Record<SectionCategory, typeof Lightning> = {
    action: Lightning,
    dialog: ChatCircle,
    knowledge: Lightbulb,
    context: PushPin,
};

/** A classified provider failure: what happened, where, and what to do. */
function LlmErrorCard({ info }: { info: LlmErrorInfo }) {
    return (
        <div role="alert" className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5">
            <WarningCircle weight="fill" className="size-3.5 shrink-0 mt-0.5 text-destructive" aria-hidden />
            <div className="min-w-0 space-y-1 text-xs leading-relaxed">
                <p className="font-medium text-foreground">{info.title}</p>
                <p className="text-muted-foreground break-words">{info.detail}</p>
                <p className="text-foreground/80">→ {info.action}</p>
            </div>
        </div>
    );
}

function ResponseContent({ content, plain = false }: { content: string; plain?: boolean }) {
    // Model output is untrusted — a malformed stream must not unmount the app.
    return (
        <ErrorBoundary
            label="Response"
            fallback={
                <div className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                    {content}
                </div>
            }
        >
            <ResponseContentInner content={content} plain={plain} />
        </ErrorBoundary>
    );
}

function ResponseContentInner({ content, plain = false }: { content: string; plain?: boolean }) {
    if (plain) {
        return (
            <div className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                {content}
            </div>
        );
    }

    const normalized = normalizeGluedMarkdown(content);
    const sections = parseResponseContent(normalized);

    if (sections.length === 0) {
        return (
            <div className="prose-response">
                <Markdown>{normalized}</Markdown>
            </div>
        );
    }

    return (
        <div className="response-sections">
            {sections.map((section, i) => {
                if (section.type === "text") {
                    return (
                        <div key={`text-${i}`} className="prose-response text-foreground/60">
                            <Markdown>{section.content}</Markdown>
                        </div>
                    );
                }
                const Icon = CATEGORY_ICONS[section.category];
                return (
                    <div key={`${section.category}-${section.label}-${i}`} className={`response-section response-section--${section.category}`}>
                        <div className="response-section-header">
                            <Icon weight="bold" className="response-section-icon" />
                            <span className="response-section-label">{section.label}</span>
                        </div>
                        {section.content && (
                            <div className="prose-response">
                                <Markdown>{section.content}</Markdown>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

export default function AiResponse({
    feedItems,
    sessionConfig,
    apiKeys,
    lmstudioUrl,
    triggerCount = 0,
    clearCount = 0,
    onResponseComplete,
    devices,
}: AiResponseProps) {
    const { settings } = useSettingsStore();
    const { responses, addResponse, clearResponses } = useSessionStore();
    const mounted = useSyncExternalStore(
        subscribeNoop,
        () => true,
        () => false
    );
    const [currentResponse, setCurrentResponse] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);
    // The last classified failure and the text it published to
    // `currentResponse` (the overlay mirrors that text). The card renders only
    // while `currentResponse` still holds exactly that text, so any new stream
    // or clear implicitly retires it.
    const [lastError, setLastError] = useState<{ text: string; info: LlmErrorInfo } | null>(null);
    const showLlmError = useCallback((info: LlmErrorInfo) => {
        const text = formatLlmErrorMarkdown(info);
        setLastError({ text, info });
        setCurrentResponse(text);
    }, []);

    // AiResponse is the only LLM stream owner. Mirror its presentation state so
    // optional consumers (the always-on-top overlay) observe the same stream
    // without issuing a second request.
    useEffect(() => {
        useSessionStore.getState().setCurrentResponse(currentResponse);
    }, [currentResponse]);
    useEffect(() => {
        useSessionStore.getState().setIsStreaming(isStreaming);
    }, [isStreaming]);
    useEffect(() => () => {
        useSessionStore.getState().setCurrentResponse("");
        useSessionStore.getState().setIsStreaming(false);
    }, []);
    const [chatInput, setChatInput] = useState("");
    const [streamingType, setStreamingType] = useState<"analysis" | "chat">("analysis");
    const [streamingUserMessage, setStreamingUserMessage] = useState("");
    const isStreamingRef = useRef(false);
    const autoTimerRef = useRef<NodeJS.Timeout | null>(null);
    const responseRef = useRef<HTMLDivElement>(null);
    const chatInputRef = useRef<HTMLInputElement>(null);
    const seenItemIdsRef = useRef<Set<string>>(new Set());
    const gateCheckedIdsRef = useRef<Set<string>>(new Set());
    const lastAnalysisAtRef = useRef(0);
    const hasSeededSeenRef = useRef(false);
    const streamingStartedAtRef = useRef(0);
    const abortControllerRef = useRef<AbortController | null>(null);
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [lightboxImage, setLightboxImage] = useState<string | null>(null);
    const rateLimitedUntilRef = useRef(0);
    const devicesRef = useRef(devices);
    useEffect(() => {
        devicesRef.current = devices;
    }, [devices]);

    const feedItemsRef = useRef(feedItems);
    useEffect(() => {
        feedItemsRef.current = feedItems;
    }, [feedItems]);

    // Pre-seed seen items when restoring a session that already has responses.
    // This prevents re-analyzing archived content from the previous launch.
    useEffect(() => {
        if (!hasSeededSeenRef.current && responses.length > 0 && seenItemIdsRef.current.size === 0 && feedItems.length > 0) {
            hasSeededSeenRef.current = true;
            for (const item of feedItems) {
                seenItemIdsRef.current.add(item.id);
            }
        }
    }, [responses.length, feedItems]);
    const sessionConfigRef = useRef(sessionConfig);
    useEffect(() => {
        sessionConfigRef.current = sessionConfig;
    }, [sessionConfig]);
    const apiKeysRef = useRef(apiKeys);
    useEffect(() => {
        apiKeysRef.current = apiKeys;
    }, [apiKeys]);
    const lmstudioUrlRef = useRef(lmstudioUrl);
    useEffect(() => {
        lmstudioUrlRef.current = lmstudioUrl;
    }, [lmstudioUrl]);
    const onResponseCompleteRef = useRef(onResponseComplete);
    useEffect(() => {
        onResponseCompleteRef.current = onResponseComplete;
    }, [onResponseComplete]);

    /** Get the LLM request base fields (apiKey, baseUrl, model, provider) */
    const getLLMConfig = useCallback(() => {
        const config = sessionConfigRef.current;
        const keys = apiKeysRef.current;
        const lmUrl = lmstudioUrlRef.current;
        const isLmStudio = config.provider === "lmstudio";
        const apiKey = providerNeedsApiKey(config.provider)
            ? keys[config.provider as keyof typeof keys] || ""
            : "";
        const lmBaseUrl = (() => {
            const raw = (lmUrl || "http://localhost:1234").trim().replace(/\/+$/, "");
            return raw.endsWith("/v1") ? raw : `${raw}/v1`;
        })();

        return {
            provider: config.provider,
            model: config.model,
            apiKey: apiKey || "",
            baseUrl: isLmStudio ? lmBaseUrl : undefined,
            ...(config.provider === "local-ai" && config.localAi ? { localAi: config.localAi } : {}),
        };
    }, []);

    const getRateLimitFallbackBodies = useCallback((baseBody: LlmCall): LlmCall[] => {
        const config = sessionConfigRef.current;
        const keys = apiKeysRef.current;
        if (config.provider === "groq" && keys.cerebras) {
            return [{
                ...baseBody,
                provider: "cerebras",
                apiKey: keys.cerebras,
                model: fallbackModelForProvider("cerebras"),
                baseUrl: undefined,
            }];
        }
        if (config.provider === "cerebras" && keys.groq) {
            return [{
                ...baseBody,
                provider: "groq",
                apiKey: keys.groq,
                model: fallbackModelForProvider("groq"),
                baseUrl: undefined,
            }];
        }
        return [];
    }, []);

    const triggerAnalysis = useCallback(async () => {
        // If already streaming, check if it's stuck (> 45s) and force-reset
        if (isStreamingRef.current) {
            if (Date.now() - streamingStartedAtRef.current > 45_000) {
                abortControllerRef.current?.abort();
                abortControllerRef.current = null;
                isStreamingRef.current = false;
                setIsStreaming(false);
                setStatusMessage("Previous request timed out — retrying");
            } else {
                setStatusMessage("Analysis already in progress");
                return;
            }
        }

        // Respect rate limit cooldown
        if (rateLimitedUntilRef.current > Date.now()) {
            if (sessionConfigRef.current.triggerMode === "manual") {
                const waitSecs = Math.ceil((rateLimitedUntilRef.current - Date.now()) / 1000);
                setStatusMessage(`Rate limited — wait ${waitSecs}s`);
            }
            return;
        }

        const items = feedItemsRef.current;
        const config = sessionConfigRef.current;
        const keys = apiKeysRef.current;

        if (items.length === 0) {
            setStatusMessage("No feed data to analyze");
            return;
        }

        // Split items into new (unseen) and context (already responded to)
        const newItems: FeedItem[] = [];
        const contextItems: FeedItem[] = [];
        for (const item of items) {
            if (seenItemIdsRef.current.has(item.id)) {
                contextItems.push(item);
            } else {
                newItems.push(item);
            }
        }

        // Skip if no new dialog (auto/smart mode — manual always fires)
        // No message here — this is expected for auto/smart polling
        if (newItems.length === 0 && config.triggerMode !== "manual") return;

        const apiKey = providerNeedsApiKey(config.provider) ? keys[config.provider as keyof typeof keys] : "";
        if (providerNeedsApiKey(config.provider) && !apiKey) {
            setStatusMessage(`No API key for ${config.provider}`);
            return;
        }
        if (needsLocalAiModel(config)) {
            setStatusMessage("Pick a model from Your AI apps first");
            return;
        }

        // Mark all current items as seen, track newly-seen for rollback on error
        const newlySeenIds: string[] = [];
        for (const item of items) {
            if (!seenItemIdsRef.current.has(item.id)) {
                newlySeenIds.push(item.id);
            }
            seenItemIdsRef.current.add(item.id);
        }
        // Cap the set so it doesn't grow forever
        if (seenItemIdsRef.current.size > 1000) {
            const arr = Array.from(seenItemIdsRef.current);
            seenItemIdsRef.current = new Set(arr.slice(-500));
        }

        // Abort any lingering request and create a new controller with 45s timeout
        abortControllerRef.current?.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;
        const abortTimeout = setTimeout(() => controller.abort(), 45_000);

        isStreamingRef.current = true;
        streamingStartedAtRef.current = Date.now();
        setIsStreaming(true);
        setStreamingType("analysis");
        setStreamingUserMessage("");
        setCurrentResponse("");
        setStatusMessage(null);

        try {
            let attachedScreenshotDataUrl: string | undefined;
            const requestedBudget = config.contextSize || 6000;
            // LM Studio / llama.cpp models often run with 4k context windows.
            // Keep prompt budgets conservative to avoid n_ctx overflow errors.
            const totalBudget = config.provider === "lmstudio"
                ? Math.min(requestedBudget, 2800)
                : requestedBudget;
            const newBudget = Math.round(totalBudget * 0.6);
            const ctxBudget = Math.round(totalBudget * 0.2);
            // If no new items (manual trigger on stale content), use the most recent
            // items as "new" and DON'T duplicate them as context
            const hasNew = newItems.length > 0;
            const truncatedNew = truncateFeedItems(hasNew ? newItems : items, newBudget);
            // Cap context to 20 most recent items before token-truncating
            const cappedContext = hasNew ? contextItems.slice(-20) : [];
            const truncatedContext = truncateFeedItems(cappedContext, ctxBudget);
            const latestQuestion =
                config.responseStyle === "ai-voice"
                    ? extractLatestQuestion(truncatedNew)
                    : null;
            const useDirectQuestionMode =
                config.responseStyle === "ai-voice" && !!latestQuestion;

            const systemPrompt = useDirectQuestionMode
                ? "You are a real-time voice copilot. Return exactly one short spoken sentence that directly answers the user's latest question. No banter, no jokes, no quotes, no markdown, no roleplay, no preamble."
                : buildSystemPrompt(config) + glossaryPromptLine(useSettingsStore.getState().settings.glossary);
            const userMessage = useDirectQuestionMode
                ? `Latest question: ${latestQuestion}\nAnswer this directly in one short spoken sentence.`
                : buildUserMessage(truncatedNew, truncatedContext, config.personality, devicesRef.current);
            const outTokens = useDirectQuestionMode ? 80 : config.responseStyle === "ai-voice" ? 160 : config.responseStyle === "concise" ? 320 : 640;

            const primaryBody: LlmCall = {
                systemPrompt,
                userMessage,
                ...getLLMConfig(),
                maxTokens: outTokens,
                temperature: useDirectQuestionMode ? 0.15 : config.personality === "unhinged" ? 0.9 : config.responseStyle === "ai-voice" ? 0.35 : config.responseStyle === "concise" ? 0.3 : 0.5,
            };
            if (
                settings.includeScreenshotOnAnalyze &&
                (config.provider === "local-ai"
                    ? config.localAi?.supportsImageInput === true
                    : (
                        await fetchModelImageSupport({
                            provider: config.provider,
                            model: config.model,
                            apiKey: typeof primaryBody.apiKey === "string" ? primaryBody.apiKey : undefined,
                            baseUrl: typeof primaryBody.baseUrl === "string" ? primaryBody.baseUrl : undefined,
                        })
                    ) ?? modelSupportsImageInput(config.provider, config.model)
                )
            ) {
                const imageDataUrl = await captureScreenshot();
                if (imageDataUrl) {
                    const optimized = await optimizeImageDataUrl(imageDataUrl);
                    primaryBody.imageDataUrl = optimized;
                    attachedScreenshotDataUrl = optimized;
                    primaryBody.userMessage = `${String(primaryBody.userMessage)}\n\n[VISUAL_CONTEXT_ATTACHED=yes]`;
                } else {
                    primaryBody.userMessage = `${String(primaryBody.userMessage)}\n\n[VISUAL_CONTEXT_ATTACHED=no]`;
                }
            } else if (settings.includeScreenshotOnAnalyze) {
                primaryBody.userMessage = `${String(primaryBody.userMessage)}\n\n[VISUAL_CONTEXT_ATTACHED=unsupported_provider]`;
            }
            const fullResponse = await streamCompletion(
                primaryBody,
                setCurrentResponse,
                controller.signal,
                getRateLimitFallbackBodies(primaryBody)
            );

            let normalizedResponse =
                config.responseStyle === "ai-voice" ? clampAiVoiceLine(fullResponse) : fullResponse;

            if (
                config.responseStyle === "ai-voice" &&
                isWeakAiVoiceLine(normalizedResponse)
            ) {
                const latestQuestion = extractLatestQuestion(truncatedNew);
                if (latestQuestion) {
                    const fixBody: LlmCall = {
                        ...getLLMConfig(),
                        systemPrompt:
                            "Return exactly one short factual sentence answering the question directly. No banter, no sarcasm, no roleplay, no quotes.",
                        userMessage: `Question: ${latestQuestion}`,
                        maxTokens: 64,
                        temperature: 0.1,
                    };
                    const fixed = await streamCompletion(
                        fixBody,
                        setCurrentResponse,
                        controller.signal,
                        getRateLimitFallbackBodies(fixBody)
                    );
                    const fixedLine = clampAiVoiceLine(fixed, 24, 180);
                    if (fixedLine) normalizedResponse = fixedLine;
                }
            }

            if (normalizedResponse) {
                const entry: ResponseEntry = {
                    id: `resp-${Date.now()}`,
                    content: normalizedResponse,
                    timestamp: new Date().toISOString(),
                    model: sessionModelLabel(config),
                    type: "analysis",
                    screenshotDataUrl: attachedScreenshotDataUrl,
                };
                addResponse(entry);
                onResponseCompleteRef.current?.(entry);
                setCurrentResponse("");
            } else {
                setStatusMessage("LLM returned an empty response");
            }
        } catch (err) {
            // Rollback: unmark items that weren't actually analyzed
            for (const id of newlySeenIds) {
                seenItemIdsRef.current.delete(id);
            }
            if (err instanceof RateLimitError) {
                rateLimitedUntilRef.current = Date.now() + err.retryAfterMs;
                const secs = Math.ceil(err.retryAfterMs / 1000);
                setStatusMessage(`Rate limited — retrying in ${secs}s`);
            } else if (controller.signal.aborted) {
                setCurrentResponse("Request timed out after 45s. Try again or switch models.");
            } else if (err instanceof LlmRequestError) {
                showLlmError(err.info);
            } else {
                setCurrentResponse(
                    `Failed to get response: ${err instanceof Error ? err.message : "Unknown error"}`
                );
            }
        } finally {
            clearTimeout(abortTimeout);
            abortControllerRef.current = null;
            isStreamingRef.current = false;
            setIsStreaming(false);
            lastAnalysisAtRef.current = Date.now();
            // Reset gate tracking so new items arriving after analysis get a fresh evaluation
            gateCheckedIdsRef.current.clear();
        }
    }, [addResponse, getLLMConfig, getRateLimitFallbackBodies, settings.includeScreenshotOnAnalyze, showLlmError]);

    /** Local heuristic gate for smart mode — no API call, instant, reliable. */
    const shouldSmartTrigger = useCallback((): boolean => {
        if (isStreamingRef.current) return false;

        // Cooldown: don't trigger within 10s of the last analysis
        if (Date.now() - lastAnalysisAtRef.current < 10000) return false;

        const items = feedItemsRef.current;
        if (items.length === 0) return false;

        // Collect unseen items
        const unseenItems = items.filter((item) => !seenItemIdsRef.current.has(item.id));
        if (unseenItems.length === 0) return false;

        // Must have genuinely new items since last check
        const hasNewSinceLastCheck = unseenItems.some(
            (item) => !gateCheckedIdsRef.current.has(item.id)
        );
        if (!hasNewSinceLastCheck) return false;

        // Mark all unseen as checked so we don't re-evaluate until more arrive
        for (const item of unseenItems) {
            gateCheckedIdsRef.current.add(item.id);
        }
        if (gateCheckedIdsRef.current.size > 500) {
            const arr = Array.from(gateCheckedIdsRef.current);
            gateCheckedIdsRef.current = new Set(arr.slice(-250));
        }

        // Heuristic: look at unseen audio items from [THEM] (output device)
        const themItems = unseenItems.filter(
            (item) => item.type === "audio" && item.deviceType !== "input"
        );

        // Trigger if [THEM] has said enough (at least 2 audio chunks)
        if (themItems.length >= 2) return true;

        // Trigger if anyone asked a question
        const hasQuestion = unseenItems.some(
            (item) => item.type === "audio" && item.content.includes("?")
        );
        if (hasQuestion) return true;

        // Trigger if there's a decent amount of new content (any type)
        if (unseenItems.length >= 4) return true;

        return false;
    }, []);

    const handleChatSubmit = useCallback(async () => {
        const question = chatInput.trim();
        if (!question) return;
        if (isStreamingRef.current) {
            setStatusMessage("Wait for current response to finish");
            return;
        }

        // Respect rate limit cooldown
        if (rateLimitedUntilRef.current > Date.now()) {
            const waitSecs = Math.ceil((rateLimitedUntilRef.current - Date.now()) / 1000);
            setStatusMessage(`Rate limited — wait ${waitSecs}s`);
            return;
        }

        const config = sessionConfigRef.current;
        const keys = apiKeysRef.current;
        const apiKey = providerNeedsApiKey(config.provider) ? keys[config.provider as keyof typeof keys] : "";
        if (providerNeedsApiKey(config.provider) && !apiKey) {
            setStatusMessage(`No API key for ${config.provider}`);
            return;
        }
        if (needsLocalAiModel(config)) {
            setStatusMessage("Pick a model from Your AI apps first");
            return;
        }

        abortControllerRef.current?.abort();
        const controller = new AbortController();
        abortControllerRef.current = controller;
        const abortTimeout = setTimeout(() => controller.abort(), 45_000);

        setChatInput("");
        isStreamingRef.current = true;
        streamingStartedAtRef.current = Date.now();
        setIsStreaming(true);
        setStreamingType("chat");
        setStreamingUserMessage(question);
        setCurrentResponse("");
        setStatusMessage(null);

        try {
            const currentResponses = useSessionStore.getState().responses;
            const chatConfig =
                config.provider === "lmstudio"
                    ? { ...config, contextSize: Math.min(config.contextSize || 6000, 2800) }
                    : config;
            const { systemPrompt: chatSystemPrompt, userMessage } = buildChatPrompt(
                question,
                currentResponses,
                feedItemsRef.current,
                chatConfig,
                devicesRef.current
            );
            const systemPrompt = chatSystemPrompt + glossaryPromptLine(useSettingsStore.getState().settings.glossary);

            const primaryBody: LlmCall = {
                systemPrompt,
                userMessage,
                ...getLLMConfig(),
                maxTokens: 768,
                temperature: 0.5,
            };
            const fullResponse = await streamCompletion(
                primaryBody,
                setCurrentResponse,
                controller.signal,
                getRateLimitFallbackBodies(primaryBody)
            );

            if (fullResponse) {
                const entry: ResponseEntry = {
                    id: `chat-${Date.now()}`,
                    content: fullResponse,
                    timestamp: new Date().toISOString(),
                    model: sessionModelLabel(config),
                    type: "chat",
                    userMessage: question,
                };
                addResponse(entry);
                onResponseCompleteRef.current?.(entry);
                setCurrentResponse("");
            } else {
                setStatusMessage("LLM returned an empty response");
            }
        } catch (err) {
            if (err instanceof RateLimitError) {
                rateLimitedUntilRef.current = Date.now() + err.retryAfterMs;
                const secs = Math.ceil(err.retryAfterMs / 1000);
                setStatusMessage(`Rate limited — wait ${secs}s and try again`);
            } else if (controller.signal.aborted) {
                setCurrentResponse("Request timed out after 45s. Try again or switch models.");
            } else if (err instanceof LlmRequestError) {
                showLlmError(err.info);
            } else {
                setCurrentResponse(
                    `Failed to get response: ${err instanceof Error ? err.message : "Unknown error"}`
                );
            }
        } finally {
            clearTimeout(abortTimeout);
            abortControllerRef.current = null;
            isStreamingRef.current = false;
            setIsStreaming(false);
            setStreamingUserMessage("");
        }
    }, [chatInput, addResponse, getLLMConfig, getRateLimitFallbackBodies, showLlmError]);

    useEffect(() => {
        if (autoTimerRef.current) {
            clearInterval(autoTimerRef.current);
            autoTimerRef.current = null;
        }

        // Watchdog helper: if streaming has been stuck > 45s, force-abort and reset
        const checkStuckStreaming = () => {
            if (isStreamingRef.current && Date.now() - streamingStartedAtRef.current > 45_000) {
                abortControllerRef.current?.abort();
                abortControllerRef.current = null;
                isStreamingRef.current = false;
                setIsStreaming(false);
                setStatusMessage("Streaming timed out — reset");
                return true; // was stuck
            }
            return false;
        };

        if (sessionConfig.triggerMode === "auto") {
            autoTimerRef.current = setInterval(() => {
                if (checkStuckStreaming()) return;
                if (rateLimitedUntilRef.current > Date.now()) return; // respect cooldown
                triggerAnalysis();
            }, sessionConfig.autoIntervalSecs * 1000);
        } else if (sessionConfig.triggerMode === "smart") {
            // Smart mode: poll on short interval, use local heuristic to decide
            const intervalMs = Math.max(6, sessionConfig.autoIntervalSecs) * 1000;
            autoTimerRef.current = setInterval(() => {
                if (checkStuckStreaming()) return;
                if (rateLimitedUntilRef.current > Date.now()) return; // respect cooldown
                if (shouldSmartTrigger()) {
                    triggerAnalysis();
                }
            }, intervalMs);
        }

        return () => {
            if (autoTimerRef.current) clearInterval(autoTimerRef.current);
        };
    }, [sessionConfig.triggerMode, sessionConfig.autoIntervalSecs, triggerAnalysis, shouldSmartTrigger]);

    useEffect(() => {
        if (responseRef.current) {
            responseRef.current.scrollTop = 0;
        }
    }, [currentResponse, responses]);

    // Auto-clear status messages after 5 seconds
    useEffect(() => {
        if (!statusMessage) return;
        const timer = setTimeout(() => setStatusMessage(null), 5000);
        return () => clearTimeout(timer);
    }, [statusMessage]);

    const clearAll = useCallback(() => {
        clearResponses();
        seenItemIdsRef.current.clear();
        gateCheckedIdsRef.current.clear();
        lastAnalysisAtRef.current = 0;
        hasSeededSeenRef.current = false;
    }, [clearResponses]);

    // External triggers via props (from keyboard shortcuts in dashboard)
    const prevTriggerRef = useRef(triggerCount);
    const prevClearRef = useRef(clearCount);

    useEffect(() => {
        if (triggerCount !== prevTriggerRef.current) {
            prevTriggerRef.current = triggerCount;
            triggerAnalysis();
        }
    }, [triggerCount, triggerAnalysis]);

    useEffect(() => {
        if (clearCount !== prevClearRef.current) {
            prevClearRef.current = clearCount;
            clearAll();
        }
    }, [clearCount, clearAll]);

    const hasProviderKey =
        !providerNeedsApiKey(sessionConfig.provider) ||
        !!apiKeys[sessionConfig.provider as keyof typeof apiKeys];
    const missingLocalAiModel = needsLocalAiModel(sessionConfig);
    const hasApiKey = hasProviderKey && !missingLocalAiModel;
    const plainAiVoiceOutput = sessionConfig.responseStyle === "ai-voice";

    return (
        <div className="flex flex-col min-h-0 flex-1">
            {/* Section header */}
            <div className="flex items-center justify-between px-4 h-10 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                    <Brain weight="bold" className="size-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-foreground/80">Analysis</span>
                </div>
                {isStreaming && (
                    <div className="flex items-center gap-1.5">
                        <CircleNotch weight="bold" className="size-3 text-primary animate-spin" />
                        <span className="text-[10px] text-primary/80 uppercase tracking-wider">Thinking</span>
                    </div>
                )}
            </div>

            {/* Response area */}
            <div
                ref={responseRef}
                className="flex-1 overflow-y-auto min-h-0 px-4 py-3"
            >
                {!hasApiKey ? (
                    <Empty className="py-16 border-none text-muted-foreground/50">
                        <EmptyMedia>
                            <Brain weight="thin" className="size-8" />
                        </EmptyMedia>
                        <EmptyHeader>
                            <EmptyTitle className="text-[11px] font-normal text-muted-foreground/50">
                                {missingLocalAiModel
                                    ? "Pick a model from Your AI apps to enable analysis"
                                    : "Add an API key in Settings to enable analysis"}
                            </EmptyTitle>
                        </EmptyHeader>
                    </Empty>
                ) : !isStreaming && !currentResponse && responses.length === 0 ? (
                    <Empty className="py-16 border-none text-muted-foreground/50">
                        <EmptyMedia>
                            <Lightning weight="thin" className="size-8" />
                        </EmptyMedia>
                        <EmptyHeader>
                            <EmptyTitle className="text-[11px] font-normal text-muted-foreground/50">
                                {sessionConfig.triggerMode === "auto"
                                    ? "Auto-analysis will start when data arrives"
                                    : sessionConfig.triggerMode === "smart"
                                        ? "Smart mode — AI will chime in when it matters"
                                        : "Click Analyze to get AI insights"}
                            </EmptyTitle>
                            <EmptyDescription className="text-[10px] text-muted-foreground/30 tabular-nums">
                                {feedItems.length} items in feed
                            </EmptyDescription>
                        </EmptyHeader>
                    </Empty>
                ) : (
                    <div className="space-y-4">
                        {/* Streaming / in-progress response */}
                        {isStreaming && (
                            <div className="space-y-2">
                                {streamingType === "chat" && streamingUserMessage && (
                                    <div className="text-[11px] text-muted-foreground italic border-l-2 border-primary/30 pl-2.5 mb-2">
                                        {streamingUserMessage}
                                    </div>
                                )}
                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
                                    <span className="tabular-nums">{new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                    <span className="text-muted-foreground/20">/</span>
                                    <span className="truncate">{sessionModelLabel(sessionConfig)}</span>
                                </div>
                                <div>
                                    {currentResponse ? (
                                        <>
                                            <ResponseContent content={currentResponse} plain={plainAiVoiceOutput} />
                                            <span className="inline-block w-[3px] h-3.5 bg-primary cursor-blink mt-1" />
                                        </>
                                    ) : (
                                        <div className="text-xs text-muted-foreground/50">
                                            <CircleNotch weight="bold" className="size-3 animate-spin inline-block mr-1 -mt-0.5" />
                                            Processing...
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Error displayed outside streaming */}
                        {!isStreaming && currentResponse && (
                            <div className="space-y-2">
                                {lastError && lastError.text === currentResponse ? (
                                    <LlmErrorCard info={lastError.info} />
                                ) : (
                                    <ResponseContent content={currentResponse} plain={plainAiVoiceOutput} />
                                )}
                            </div>
                        )}

                        {/* Response history */}
                        {responses.map((entry, i) => (
                            <div
                                key={entry.id}
                                className={`space-y-2 response-enter ${isStreaming || i > 0 ? "border-t border-border pt-4" : ""}${
                                    entry.type === "chat" ? " border-l-2 border-primary/20 pl-3" : ""
                                }`}
                                style={i > 0 ? { opacity: Math.max(0.5, 1 - i * 0.25) } : undefined}
                            >
                                {entry.type === "chat" && entry.userMessage && (
                                    <div className="text-[11px] text-muted-foreground italic mb-1">
                                        {entry.userMessage}
                                    </div>
                                )}
                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
                                    <span className="tabular-nums">{new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                                    <span className="text-muted-foreground/20">/</span>
                                    <span className="truncate">{entry.model}</span>
                                </div>
                                {entry.type === "analysis" && entry.screenshotDataUrl && (
                                    <button
                                        type="button"
                                        onClick={() => setLightboxImage(entry.screenshotDataUrl || null)}
                                        className="group block w-fit rounded border border-border/70 overflow-hidden hover:border-primary/50 transition-colors"
                                        title="Open screenshot sent with this analysis"
                                    >
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={entry.screenshotDataUrl}
                                            alt="Sent screenshot preview"
                                            className="block h-20 w-auto max-w-[220px] object-cover"
                                            loading="lazy"
                                        />
                                        <div className="px-2 py-1 text-[10px] text-muted-foreground group-hover:text-foreground/80">
                                            Visual context sent • click to open
                                        </div>
                                    </button>
                                )}
                                <ResponseContent content={entry.content} plain={plainAiVoiceOutput} />
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <Dialog open={!!lightboxImage} onOpenChange={(open) => !open && setLightboxImage(null)}>
                <DialogContent className="max-w-[92vw] w-[1000px] p-2 sm:p-3">
                    <DialogTitle className="sr-only">Sent screenshot preview</DialogTitle>
                    {lightboxImage && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={lightboxImage}
                            alt="Sent screenshot full preview"
                            className="block w-full h-auto max-h-[82vh] object-contain rounded"
                        />
                    )}
                </DialogContent>
            </Dialog>

            {/* Footer actions */}
            <div className="border-t border-border px-4 py-2.5 space-y-2 shrink-0">
                {/* Chat input - use native input when !mounted to avoid Base UI useId hydration mismatch */}
                <div className="flex gap-1.5">
                    {!mounted ? (
                        <input
                            ref={chatInputRef}
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleChatSubmit();
                                }
                            }}
                            placeholder="Ask about this session..."
                            aria-label="Ask about this session"
                            disabled={isStreaming || !hasApiKey}
                            className="h-8 w-full min-w-0 rounded-none border border-input bg-transparent px-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none transition-colors disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
                        />
                    ) : (
                        <Input
                            ref={chatInputRef}
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleChatSubmit();
                                }
                            }}
                            placeholder="Ask about this session..."
                            disabled={isStreaming || !hasApiKey}
                            className="text-xs"
                        />
                    )}
                    <Button
                        size="icon-xs"
                        variant="ghost"
                        onClick={handleChatSubmit}
                        disabled={isStreaming || !chatInput.trim() || !hasApiKey}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                        <PaperPlaneTilt weight="bold" className="size-3.5" />
                    </Button>
                </div>

                {/* Action bar */}
                <div className="flex items-center gap-2">
                    <Button
                        size="xs"
                        onClick={triggerAnalysis}
                        disabled={isStreaming || feedItems.length === 0 || !hasApiKey}
                        className="gap-1"
                    >
                        {isStreaming ? (
                            <CircleNotch weight="bold" className="size-3 animate-spin" />
                        ) : (
                            <Lightning weight="fill" className="size-3" />
                        )}
                        {isStreaming ? "Analyzing" : "Analyze"}
                    </Button>

                    <span className="text-[10px] flex-1 tabular-nums truncate">
                        {statusMessage ? (
                            <span className="text-amber-500/90">{statusMessage}</span>
                        ) : (
                            <span className="text-muted-foreground/40">
                                {sessionConfig.triggerMode === "auto"
                                    ? `auto / ${sessionConfig.autoIntervalSecs}s`
                                    : sessionConfig.triggerMode === "smart"
                                        ? `smart / ${sessionConfig.autoIntervalSecs}s`
                                        : settings.shortcuts.analyze.label}
                            </span>
                        )}
                    </span>

                    {responses.length > 0 && (
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={clearAll}
                            className="text-muted-foreground/50 hover:text-foreground"
                        >
                            <Eraser weight="bold" className="size-3.5" />
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}

