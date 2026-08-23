"use client";

import { useState, useEffect, useCallback } from "react";
import { onLocalTranscription } from "@/lib/tauri";
import type { FeedItem } from "@/lib/types";

export function useLocalTranscription() {
    const [items, setItems] = useState<FeedItem[]>([]);

    useEffect(() => {
        let unlisten: (() => void) | null = null;

        onLocalTranscription((result) => {
            setItems((prev) => {
                // The current local engines emit a completed utterance as the
                // durable unit. Keep partial hypotheses out of the feed until
                // the native streaming path exposes revision-aware lines.
                if (!result.is_final) {
                    return prev;
                }

                // Helps compare backend realtime transcript logs vs what the feed renders.
                console.log("[feed-local-transcription]", {
                    id: result.id,
                    final: result.is_final,
                    device: result.device_type,
                    speakerId: result.speaker_id,
                    speakerLabel: result.speaker_label,
                    timestamp: result.timestamp,
                    text: result.text,
                });

                const feedItem: FeedItem = {
                    id: result.id,
                    type: "audio",
                    content: result.text,
                    timestamp: result.timestamp,
                    source: result.device_type === "input" ? "Microphone" : "System audio",
                    deviceType: result.device_type,
                    isFinal: result.is_final,
                    speaker: result.speaker_id ?? undefined,
                    speakerLabel: result.speaker_label ?? undefined,
                };

                // Stable native IDs are revision keys. Update every mutable
                // transcription field so later speaker/text corrections are
                // reflected instead of preserving stale metadata forever.
                const existingIdx = prev.findIndex((i) => i.id === result.id);
                if (existingIdx >= 0) {
                    const updated = [...prev];
                    updated[existingIdx] = {
                        ...updated[existingIdx],
                        ...feedItem,
                    };
                    return updated;
                }

                // New item — prepend (newest first)
                return [feedItem, ...prev];
            });
        }).then((fn) => (unlisten = fn));

        return () => unlisten?.();
    }, []);

    const clear = useCallback(() => setItems([]), []);

    return { items, clear };
}
