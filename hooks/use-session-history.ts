"use client";

import { useState, useCallback, useEffect } from "react";
import { db } from "@/lib/db";
import type { DBSession, DBTranscriptLine } from "@/lib/db";
import type { SessionConfig, SessionSummary, ResponseEntry, FeedItem } from "@/lib/types";
import {
    feedItemToTranscriptLine,
    transcriptLineToFeedItems,
    transcriptLinesRepresentedByFeed,
    type TranscriptLine,
} from "@/lib/transcript";
import { useTranscriptStore } from "@/lib/stores/transcript-store";

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

function stripSessionId(row: DBTranscriptLine): TranscriptLine {
    return {
        id: row.id,
        revision: row.revision,
        trackId: row.trackId,
        role: row.role,
        engine: row.engine,
        model: row.model,
        modelVersion: row.modelVersion,
        text: row.text,
        startMs: row.startMs,
        endMs: row.endMs,
        isComplete: row.isComplete,
        words: row.words,
        speakerSpans: row.speakerSpans,
        latencyMs: row.latencyMs,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

async function loadSessionSummaries(): Promise<SessionSummary[]> {
    const allSessions = await db.sessions.orderBy("updatedAt").reverse().toArray();

    const summaries: SessionSummary[] = await Promise.all(
        allSessions.map(async (s: DBSession) => {
            const count = await db.responses.where("sessionId").equals(s.id).count();
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
        return 0;
    });
    return summaries;
}

export function useSessionHistory() {
    const [sessions, setSessions] = useState<SessionSummary[]>([]);

    const refreshList = useCallback(async () => {
        const summaries = await loadSessionSummaries();
        setSessions(summaries);
    }, []);

    useEffect(() => {
        let alive = true;
        (async () => {
            const summaries = await loadSessionSummaries();
            if (alive) setSessions(summaries);
        })();
        return () => {
            alive = false;
        };
    }, []);

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
        async (
            id: string
        ): Promise<{
            config: SessionConfig;
            responses: ResponseEntry[];
            feedItems: FeedItem[];
            transcriptLines: TranscriptLine[];
        } | null> => {
            const session = await db.sessions.get(id);
            if (!session) return null;

            const responses = await db.responses.where("sessionId").equals(id).sortBy("timestamp");
            responses.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));

            const feedRows = await db.feedItems.where("sessionId").equals(id).sortBy("timestamp");
            feedRows.sort((a, b) => (b.timestamp > a.timestamp ? 1 : -1));

            const persistedTranscriptRows = await db.transcriptLines
                .where("sessionId")
                .equals(id)
                .toArray();
            persistedTranscriptRows.sort(
                (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
            );

            const transcriptLines: TranscriptLine[] =
                persistedTranscriptRows.length > 0
                    ? persistedTranscriptRows.map(stripSessionId)
                    : feedRows
                          .filter((row) => row.type === "audio")
                          .map((row) =>
                              feedItemToTranscriptLine({
                                  id: row.id,
                                  type: row.type,
                                  content: row.content,
                                  timestamp: row.timestamp,
                                  source: row.source,
                                  windowName: row.windowName,
                                  speaker: row.speaker,
                                  speakerLabel: row.speakerLabel,
                                  deviceType: row.deviceType,
                                  isFinal: row.isFinal,
                              })
                          );

            return {
                config: session.config,
                responses: responses.map((r) => ({
                    id: r.id,
                    content: r.content,
                    timestamp: r.timestamp,
                    model: r.model,
                    type: r.type,
                    userMessage: r.userMessage,
                    screenshotDataUrl: r.screenshotDataUrl,
                })),
                feedItems: feedRows.map((f) => ({
                    id: f.id,
                    type: f.type,
                    content: f.content,
                    timestamp: f.timestamp,
                    source: f.source,
                    windowName: f.windowName,
                    speaker: f.speaker,
                    speakerLabel: f.speakerLabel,
                    deviceType: f.deviceType,
                    isFinal: f.isFinal,
                })),
                transcriptLines,
            };
        },
        []
    );

    const saveResponse = useCallback(async (sessionId: string, entry: ResponseEntry) => {
        await db.responses.add({
            id: entry.id,
            sessionId,
            content: entry.content,
            timestamp: entry.timestamp,
            model: entry.model,
            type: entry.type,
            userMessage: entry.userMessage,
            screenshotDataUrl: entry.screenshotDataUrl,
        });
        await db.sessions.update(sessionId, { updatedAt: new Date().toISOString() });
    }, []);

    const saveTranscriptSnapshot = useCallback(
        async (sessionId: string, lines: TranscriptLine[]) => {
            await db.transaction("rw", db.transcriptLines, async () => {
                await db.transcriptLines.where("sessionId").equals(sessionId).delete();
                if (lines.length > 0) {
                    await db.transcriptLines.bulkAdd(lines.map((line) => ({ ...line, sessionId })));
                }
            });
        },
        []
    );

    const saveFeedSnapshot = useCallback(
        async (sessionId: string, items: FeedItem[]) => {
            await db.transaction("rw", db.feedItems, db.transcriptLines, async () => {
                await db.feedItems.where("sessionId").equals(sessionId).delete();
                await db.transcriptLines.where("sessionId").equals(sessionId).delete();

                if (items.length === 0) return;

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
                        speakerLabel: item.speakerLabel,
                        deviceType: item.deviceType,
                        isFinal: item.isFinal,
                    }))
                );

                const completeLiveLines = useTranscriptStore
                    .getState()
                    .lines.filter((line) => line.isComplete);
                const liveCanonical = transcriptLinesRepresentedByFeed(completeLiveLines, items);
                const liveProjectedIds = new Set(
                    liveCanonical.flatMap(transcriptLineToFeedItems).map((item) => item.id)
                );
                const fallbackAudio = items
                    .filter(
                        (item) =>
                            item.type === "audio" &&
                            item.isFinal !== false &&
                            !liveProjectedIds.has(item.id)
                    )
                    .map(feedItemToTranscriptLine);

                const byId = new Map<string, TranscriptLine>();
                for (const line of [...liveCanonical, ...fallbackAudio]) {
                    byId.set(line.id, line);
                }
                const canonicalAudio = [...byId.values()];
                if (canonicalAudio.length > 0) {
                    await db.transcriptLines.bulkAdd(
                        canonicalAudio.map((line) => ({ ...line, sessionId }))
                    );
                }
            });
        },
        []
    );

    const updateSessionConfig = useCallback(async (sessionId: string, config: SessionConfig) => {
        await db.sessions.update(sessionId, {
            config,
            updatedAt: new Date().toISOString(),
        });
    }, []);

    const deleteSession = useCallback(
        async (id: string) => {
            await db.transaction(
                "rw",
                db.sessions,
                db.responses,
                db.feedItems,
                db.transcriptLines,
                async () => {
                    await db.transcriptLines.where("sessionId").equals(id).delete();
                    await db.feedItems.where("sessionId").equals(id).delete();
                    await db.responses.where("sessionId").equals(id).delete();
                    await db.sessions.delete(id);
                }
            );
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
        saveTranscriptSnapshot,
        updateSessionConfig,
        deleteSession,
        starSession,
        renameSession,
        refreshList,
    };
}
