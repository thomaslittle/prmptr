"use client";

import { useEffect, useMemo } from "react";
import {
    nativeTranscriptLineToTranscriptLine,
    onSpeechTranscriptLine,
} from "@/lib/speech-runtime";
import { transcriptLinesToFeedItems } from "@/lib/transcript";
import { useTranscriptStore } from "@/lib/stores/transcript-store";

/**
 * Compatibility hook name retained while the dashboard moves to neutral speech
 * naming. Its source of truth is the canonical native `speech-transcript-line`
 * event for every backend, not the old Whisper-shaped event.
 */
export function useLocalTranscription() {
    const lines = useTranscriptStore((state) => state.lines);
    const upsertLine = useTranscriptStore((state) => state.upsertLine);
    const clear = useTranscriptStore((state) => state.clear);

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
            if (disposed) {
                fn();
            } else {
                unlisten = fn;
            }
        });

        return () => {
            disposed = true;
            unlisten?.();
        };
    }, [upsertLine]);

    const items = useMemo(() => transcriptLinesToFeedItems(lines), [lines]);
    return { items, lines, clear };
}
