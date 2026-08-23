"use client";

import { useEffect, useMemo } from "react";
import { onLocalTranscription } from "@/lib/tauri";
import {
    legacyLocalResultToTranscriptLine,
    transcriptLinesToFeedItems,
} from "@/lib/transcript";
import { useTranscriptStore } from "@/lib/stores/transcript-store";
import { useSettingsStore } from "@/lib/stores/settings-store";

export function useLocalTranscription() {
    const lines = useTranscriptStore((state) => state.lines);
    const upsertLine = useTranscriptStore((state) => state.upsertLine);
    const clear = useTranscriptStore((state) => state.clear);

    useEffect(() => {
        let unlisten: (() => void) | null = null;

        onLocalTranscription((result) => {
            const state = useTranscriptStore.getState();
            const previous = state.lines.find((line) => line.id === result.id);
            const settings = useSettingsStore.getState().settings;
            const engine = settings.localSttEngine ?? "whisper";
            const model = engine === "moonshine" ? "moonshine-sherpa-base" : "selected-whisper";

            const line = legacyLocalResultToTranscriptLine(
                result,
                previous,
                engine,
                model
            );

            console.log("[canonical-local-transcription]", {
                id: line.id,
                revision: line.revision,
                complete: line.isComplete,
                track: line.trackId,
                speakers: line.speakerSpans.map((span) => span.speakerKey),
                timestamp: line.updatedAt,
                text: line.text,
            });

            upsertLine(line);
        }).then((fn) => (unlisten = fn));

        return () => unlisten?.();
    }, [upsertLine]);

    const items = useMemo(() => transcriptLinesToFeedItems(lines), [lines]);

    return { items, lines, clear };
}
