"use client";

import { useEffect, useMemo, useRef } from "react";
import { buildSpeechBiasContext } from "@/lib/speech-context";
import { setSpeechContext, setSpeechKeyterms } from "@/lib/speech-tauri";
import {
    nativeTranscriptLineToTranscriptLine,
    onSpeechTranscriptLine,
} from "@/lib/speech-runtime";
import { useSessionStore } from "@/lib/stores/session-store";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { useSpeechContextSourceStore } from "@/lib/stores/speech-context-source-store";
import { useSpeechStore } from "@/lib/stores/speech-store";
import { useTranscriptStore } from "@/lib/stores/transcript-store";
import { transcriptLinesToFeedItems } from "@/lib/transcript";

export function useLocalTranscription() {
    const lines = useTranscriptStore((state) => state.lines);
    const upsertLine = useTranscriptStore((state) => state.upsertLine);
    const clear = useTranscriptStore((state) => state.clear);
    const ocrItems = useSpeechContextSourceStore((state) => state.ocrItems);
    const sessionContext = useSessionStore((state) => state.config.context);
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

    useEffect(() => {
        const settings = useSettingsStore.getState().settings;
        const localMoonshineSelected =
            (settings.transcriptionMode ?? "local-whisper") === "local-whisper"
            && settings.localSttEngine === "moonshine";
        if (!localMoonshineSelected || !preferences.contextBiasEnabled) return;

        const timer = window.setTimeout(() => {
            const bias = buildSpeechBiasContext({
                sessionContext,
                feedItems: ocrItems,
                maxTerms: preferences.maxKeyterms,
            });
            const hash = JSON.stringify([bias.context, bias.keyterms, preferences.contextMaxTerms]);
            if (hash === lastBiasHash.current) return;
            Promise.all([
                setSpeechContext(bias.context, preferences.contextMaxTerms),
                setSpeechKeyterms(bias.keyterms),
            ])
                .then(() => {
                    // Only suppress identical future updates after both native
                    // calls succeeded. A pre-start failure must retry once the
                    // stream becomes available.
                    lastBiasHash.current = hash;
                })
                .catch((error) => {
                    lastBiasHash.current = "";
                    console.debug("[speech-bias] live update skipped:", error);
                });
        }, 650);
        return () => window.clearTimeout(timer);
    }, [ocrItems, sessionContext, preferences, lines.length]);

    const items = useMemo(() => transcriptLinesToFeedItems(lines), [lines]);
    return { items, lines, clear };
}
