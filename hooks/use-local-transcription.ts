"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { onLocalTranscription } from "@/lib/tauri";
import { applySpeakerAliases, useSpeakerAliasStore } from "@/lib/stores/speaker-alias-store";
import type { FeedItem } from "@/lib/types";

export function useLocalTranscription() {
    const [rawItems, setRawItems] = useState<FeedItem[]>([]);
    const aliases = useSpeakerAliasStore((state) => state.aliases);
    const clearAliases = useSpeakerAliasStore((state) => state.clear);

    useEffect(() => {
        let unlisten: (() => void) | null = null;

        onLocalTranscription((result) => {
            setRawItems((prev) => {
                // Show only finalized events in the feed to avoid inaccurate
                // interim hypotheses (e.g., "testing when...").
                if (!result.is_final) {
                    return prev;
                }

                // Helps compare backend realtime transcript logs vs what the feed renders.
                console.log("[feed-local-transcription]", {
                    id: result.id,
                    final: result.is_final,
                    device: result.device_type,
                    speakerId: result.speaker_id,
                    timestamp: result.timestamp,
                    text: result.text,
                });

                const feedItem: FeedItem = {
                    id: result.id,
                    type: "audio",
                    content: result.text,
                    timestamp: result.timestamp,
                    source: "Transcript",
                    deviceType: result.device_type,
                    isFinal: result.is_final,
                    // Diarized identity flows to the feed and into prompts
                    // ([THEM: Speaker 2]); user aliases are applied on top.
                    speaker: result.speaker_id ?? undefined,
                    speakerLabel: result.speaker_label?.trim() || undefined,
                };

                // Stable native ids are revision keys: take every mutable
                // field so later text/speaker corrections are reflected.
                const existingIdx = prev.findIndex((i) => i.id === result.id);
                if (existingIdx >= 0) {
                    const updated = [...prev];
                    updated[existingIdx] = { ...updated[existingIdx], ...feedItem };
                    return updated;
                }

                // New item — prepend (newest first)
                return [feedItem, ...prev];
            });
        }).then((fn) => (unlisten = fn));

        return () => unlisten?.();
    }, []);

    const items = useMemo(() => applySpeakerAliases(rawItems, aliases), [rawItems, aliases]);

    // A new session starts a new speaker numbering, so names don't carry over.
    const clear = useCallback(() => {
        setRawItems([]);
        clearAliases();
    }, [clearAliases]);

    return { items, clear };
}
