"use client";

import { useState, useCallback, useEffect } from "react";
import { db } from "@/lib/db";
import type { DBSession } from "@/lib/db";
import type { SessionConfig, SessionSummary, ResponseEntry, FeedItem } from "@/lib/types";

function generateTitle(config: SessionConfig): string {
    const contextKeywords: Record<string, string> = {
        interview: "Interview",
        meeting: "Meeting",
        lecture: "Lecture",
        podcast: "Podcast",
        roleplay: "Roleplay",
        game: "Gaming",
        code: "Coding",
        debug: "Debugging",
    };

    const ctx = config.context.toLowerCase();
    let label = "Session";
    for (const [keyword, name] of Object.entries(contextKeywords)) {
        if (ctx.includes(keyword)) {
            label = name;
            break;
        }
    }

    const now = new Date();
    const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const date = now.toLocaleDateString([], { month: "short", day: "numeric" });
    return `${label} — ${date} ${time}`;
}

export function useSessionHistory() {
    const [sessions, setSessions] = useState<SessionSummary[]>([]);

    const refreshList = useCallback(async () => {
        const allSessions = await db.sessions
            .orderBy("updatedAt")
            .reverse()
            .toArray();

        const summaries: SessionSummary[] = await Promise.all(
            allSessions.map(async (s: DBSession) => {
                const count = await db.responses
                    .where("sessionId")
                    .equals(s.id)
                    .count();
                return {
                    id: s.id,
                    title: s.title,
                    updatedAt: s.updatedAt,
                    responseCount: count,
                    model: s.config.model,
                    starred: s.starred,
                };
            })
        );

        summaries.sort((a, b) => {
            if (a.starred && !b.starred) return -1;
            if (!a.starred && b.starred) return 1;
            return 0; // preserve updatedAt order within each group
        });
        setSessions(summaries);
    }, []);

    useEffect(() => {
        refreshList();
    }, [refreshList]);

    const createSession = useCallback(
        async (config: SessionConfig): Promise<string> => {
            const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const now = new Date().toISOString();
            await db.sessions.add({
                id,
                title: generateTitle(config),
                config,
                createdAt: now,
                updatedAt: now,
            });
            await refreshList();
            return id;
        },
        [refreshList]
    );

    const loadSession = useCallback(
        async (id: string): Promise<{ config: SessionConfig; responses: ResponseEntry[]; feedItems: FeedItem[] } | null> => {
            const session = await db.sessions.get(id);
            if (!session) return null;

            const responses = await db.responses
                .where("sessionId")
                .equals(id)
                .reverse()
                .sortBy("timestamp");

            // sortBy returns ascending; we reversed the collection but sortBy
            // overrides, so sort descending manually
            responses.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));

            const feedRows = await db.feedItems
                .where("sessionId")
                .equals(id)
                .sortBy("timestamp");
            // newest first
            feedRows.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));

            return {
                config: session.config,
                responses: responses.map((r) => ({
                    id: r.id,
                    content: r.content,
                    timestamp: r.timestamp,
                    model: r.model,
                    type: r.type,
                    userMessage: r.userMessage,
                })),
                feedItems: feedRows.map((f) => ({
                    id: f.id,
                    type: f.type,
                    content: f.content,
                    timestamp: f.timestamp,
                    source: f.source,
                    windowName: f.windowName,
                    speaker: f.speaker,
                    deviceType: f.deviceType,
                    isFinal: f.isFinal,
                })),
            };
        },
        []
    );

    const saveResponse = useCallback(
        async (sessionId: string, entry: ResponseEntry) => {
            await db.responses.add({
                id: entry.id,
                sessionId,
                content: entry.content,
                timestamp: entry.timestamp,
                model: entry.model,
                type: entry.type,
                userMessage: entry.userMessage,
            });
            await db.sessions.update(sessionId, {
                updatedAt: new Date().toISOString(),
            });
            // intentionally no refreshList here for perf
        },
        []
    );

    const saveFeedSnapshot = useCallback(
        async (sessionId: string, items: FeedItem[]) => {
            await db.transaction("rw", db.feedItems, async () => {
                await db.feedItems.where("sessionId").equals(sessionId).delete();
                if (items.length > 0) {
                    await db.feedItems.bulkAdd(
                        items.map((item) => ({
                            id: item.id,
                            sessionId,
                            type: item.type,
                            content: item.content,
                            timestamp: item.timestamp,
                            source: item.source,
                            windowName: item.windowName,
                            speaker: item.speaker,
                            deviceType: item.deviceType,
                            isFinal: item.isFinal,
                        }))
                    );
                }
            });
        },
        []
    );

    const updateSessionConfig = useCallback(
        async (sessionId: string, config: SessionConfig) => {
            await db.sessions.update(sessionId, {
                config,
                updatedAt: new Date().toISOString(),
            });
        },
        []
    );

    const deleteSession = useCallback(
        async (id: string) => {
            await db.transaction("rw", db.sessions, db.responses, db.feedItems, async () => {
                await db.feedItems.where("sessionId").equals(id).delete();
                await db.responses.where("sessionId").equals(id).delete();
                await db.sessions.delete(id);
            });
            await refreshList();
        },
        [refreshList]
    );

    const starSession = useCallback(
        async (id: string, starred: boolean) => {
            await db.sessions.update(id, { starred });
            await refreshList();
        },
        [refreshList]
    );

    const renameSession = useCallback(
        async (id: string, title: string) => {
            await db.sessions.update(id, { title });
            await refreshList();
        },
        [refreshList]
    );

    return {
        sessions,
        createSession,
        loadSession,
        saveResponse,
        saveFeedSnapshot,
        updateSessionConfig,
        deleteSession,
        starSession,
        renameSession,
        refreshList,
    };
}
