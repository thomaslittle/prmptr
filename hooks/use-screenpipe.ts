import { useQuery } from "@tanstack/react-query";
import { useRef, useCallback, useEffect, useState } from "react";
import { FeedItem } from "@/lib/types";

interface UseScreenpipeFeedOptions {
    screenpipeUrl: string;
    enabled: boolean;
    enableVision?: boolean;
    maxItems?: number;
}

export function useScreenpipeFeed({
    screenpipeUrl,
    enabled,
    enableVision = false,
    maxItems = 200,
}: UseScreenpipeFeedOptions) {
    const [items, setItems] = useState<FeedItem[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const seenIdsRef = useRef<Set<string>>(new Set());
    const eventSourceRef = useRef<EventSource | null>(null);

    useEffect(() => {
        if (!enabled) return;

        // Clear dedup set on fresh connection so reconnects aren't filtered
        seenIdsRef.current.clear();

        const params = new URLSearchParams({ screenpipeUrl, images: enableVision ? "true" : "false" });
        const es = new EventSource(`/api/stream?${params}`);
        eventSourceRef.current = es;

        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);

                if (data.type === "status") {
                    setIsStreaming(data.connected ?? false);
                } else if (data.type === "feed" && data.item) {
                    const item = data.item as FeedItem;
                    if (seenIdsRef.current.has(item.id)) return;
                    seenIdsRef.current.add(item.id);
                    setItems((prev) => [item, ...prev].slice(0, maxItems));
                } else if (data.type === "error") {
                    setError(new Error(data.message));
                }
            } catch {
                // ignore parse errors
            }
        };

        es.onerror = () => {
            setIsStreaming(false);
            setError(new Error("SSE connection lost"));
        };

        return () => {
            es.close();
            eventSourceRef.current = null;
        };
    }, [enabled, enableVision, screenpipeUrl, maxItems]);

    const clearFeed = useCallback(() => {
        setItems([]);
        seenIdsRef.current.clear();
    }, []);

    return {
        items,
        isPolling: isStreaming,
        isError: !!error,
        error,
        clearFeed,
    };
}

export function useScreenpipeHealth(screenpipeUrl: string) {
    return useQuery({
        queryKey: ["screenpipe-health", screenpipeUrl],
        queryFn: async () => {
            const resp = await fetch(
                `/api/health?screenpipeUrl=${encodeURIComponent(screenpipeUrl)}`
            );
            if (!resp.ok) {
                return { connected: false, message: `Health check failed (${resp.status})` };
            }
            return resp.json() as Promise<{
                connected: boolean;
                message: string;
                version?: string;
            }>;
        },
        refetchInterval: 15000,
        retry: 1,
    });
}
