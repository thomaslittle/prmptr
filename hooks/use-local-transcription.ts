"use client";

import { useEffect, useMemo, useRef } from "react";
import { buildSpeechBiasContext } from "@/lib/speech-context";
import {
    setSpeechContext,
    setSpeechKeyterms,
    startSpeechContextSidecar,
    stopSpeechContextSidecar,
} from "@/lib/speech-tauri";
import {
    nativeTranscriptLineToTranscriptLine,
    onSpeechTranscriptLine,
} from "@/lib/speech-runtime";
import { useSessionStore } from "@/lib/stores/session-store";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { useSpeakerAliasStore } from "@/lib/stores/speaker-alias-store";
import { useSpeechContextSourceStore } from "@/lib/stores/speech-context-source-store";
import { useSpeechStore } from "@/lib/stores/speech-store";
import { useTranscriptStore } from "@/lib/stores/transcript-store";
import { transcriptLineToFeedItems } from "@/lib/transcript";
import type { FeedItem } from "@/lib/types";

function desktopRuntime(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

type SpeakerFeedItem = FeedItem & { speakerKey?: string };

export function useLocalTranscription() {
    const lines = useTranscriptStore((state) => state.lines);
    const upsertLine = useTranscriptStore((state) => state.upsertLine);
    const clear = useTranscriptStore((state) => state.clear);
    const ocrItems = useSpeechContextSourceStore((state) => state.ocrItems);
    const aliases = useSpeakerAliasStore((state) => state.aliases);
    const sessionContext = useSessionStore((state) => state.config.context);
    const transcriptionMode = useSettingsStore((state) => state.settings.transcriptionMode ?? "local-whisper");
    const localSttEngine = useSettingsStore((state) => state.settings.localSttEngine ?? "whisper");
    const preferences = useSpeechStore((state) => state.preferences);
    const lastBiasHash = useRef("");

    useEffect(() => {
        let unlisten: (() => void) | null = null;
        let disposed = false;
        onSpeechTranscriptLine((nativeLine) => {
            const line = nativeTranscriptLineToTranscriptLine(nativeLine);
            console.log("[canonical-speech-transcript]", {
                id: line.id,
                revision: line.revision,
                complete: line.isComplete,
                track: line.trackId,
                engine: line.engine,
                model: line.model,
                speakers: line.speakerSpans.map((span) => span.speakerKey),
                latencyMs: line.latencyMs,
                text: line.text,
            });
            upsertLine(line);
        }).then((fn) => {
            if (disposed) fn();
            else unlisten = fn;
        });
        return () => {
            disposed = true;
            unlisten?.();
        };
    }, [upsertLine]);

    const localMoonshineSelected =
        transcriptionMode === "local-whisper" && localSttEngine === "moonshine";

    useEffect(() => {
        if (!desktopRuntime() || !localMoonshineSelected || !preferences.contextBiasEnabled) return;

        let eventSource: EventSource | null = null;
        let disposed = false;
        const start = async () => {
            try {
                const status = await startSpeechContextSidecar();
                if (disposed || !status.running) return;
                const params = new URLSearchParams({
                    screenpipeUrl: status.baseUrl,
                    images: "false",
                });
                eventSource = new EventSource(`/api/stream?${params}`);
                eventSource.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data) as {
                            type?: string;
                            item?: FeedItem;
                        };
                        const item = data.type === "feed" ? data.item : undefined;
                        if (item?.type === "ocr") {
                            useSpeechContextSourceStore.getState().push(item);
                        }
                    } catch {
                        // Context is advisory; malformed OCR events must never
                        // take down speech capture or transcription.
                    }
                };
                eventSource.onerror = () => {
                    console.debug("[speech-context] OCR sidecar stream reconnecting");
                };
            } catch (error) {
                console.warn("[speech-context] OCR sidecar unavailable:", error);
            }
        };
        void start();

        return () => {
            disposed = true;
            eventSource?.close();
            void stopSpeechContextSidecar().catch((error) => {
                console.debug("[speech-context] sidecar stop skipped:", error);
            });
        };
    }, [localMoonshineSelected, preferences.contextBiasEnabled]);

    useEffect(() => {
        if (!localMoonshineSelected || !preferences.contextBiasEnabled) return;

        const timer = window.setTimeout(() => {
            const bias = buildSpeechBiasContext({
                sessionContext,
                feedItems: ocrItems,
                glossary: preferences.glossary,
                maxTerms: preferences.maxKeyterms,
            });
            const hash = JSON.stringify([bias.context, bias.keyterms, preferences.contextMaxTerms]);
            if (hash === lastBiasHash.current) return;
            Promise.all([
                setSpeechContext(bias.context, preferences.contextMaxTerms),
                setSpeechKeyterms(bias.keyterms),
            ])
                .then(() => {
                    lastBiasHash.current = hash;
                })
                .catch((error) => {
                    lastBiasHash.current = "";
                    console.debug("[speech-bias] live update skipped:", error);
                });
        }, 650);
        return () => window.clearTimeout(timer);
    }, [ocrItems, sessionContext, preferences, lines.length, localMoonshineSelected]);

    const items = useMemo(() => {
        return [...lines]
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
            .flatMap((line) => {
                const projected = transcriptLineToFeedItems(line) as SpeakerFeedItem[];
                for (const item of projected) {
                    if (line.trackId !== "system") continue;
                    const span = line.speakerSpans.find((candidate) =>
                        item.id.includes(`:speaker:${candidate.speakerKey}:`)
                    ) ?? line.speakerSpans[0];
                    if (!span) continue;
                    item.speakerKey = span.speakerKey;
                    const alias = aliases[span.speakerKey];
                    if (alias) item.speakerLabel = alias;
                }
                return projected;
            });
    }, [lines, aliases]);

    return { items, lines, clear };
}
