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
                // Show only finalized local-whisper events in the feed to avoid
                // inaccurate interim hypotheses (e.g., "testing when...").
                if (!result.is_final) {
                    return prev;
                }

                // Helps compare backend realtime transcript logs vs what the feed renders.
                console.log("[feed-local-transcription]", {
                    id: result.id,
                    final: result.is_final,
                    device: result.device_type,
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
                    // Keep UI formatting stable: do not inject speaker metadata later.
                    speaker: undefined,
                    speakerLabel: undefined,
                };

                // Update text in-place while preserving original metadata to avoid UI "reformat".
                const existingIdx = prev.findIndex((i) => i.id === result.id);
                if (existingIdx >= 0) {
                    const updated = [...prev];
                    const existing = updated[existingIdx];
                    updated[existingIdx] = {
                        ...existing,
                        content: feedItem.content,
                        timestamp: feedItem.timestamp,
                        isFinal: feedItem.isFinal,
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
