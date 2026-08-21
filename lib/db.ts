import Dexie, { type EntityTable } from "dexie";
import type { SessionConfig } from "@/lib/types";

export interface DBSession {
    id: string;
    title: string;
    config: SessionConfig;
    createdAt: string;
    updatedAt: string;
    starred?: boolean;
}

export interface DBResponse {
    id: string;
    sessionId: string;
    content: string;
    timestamp: string;
    model: string;
    type?: "analysis" | "chat";
    userMessage?: string;
    screenshotDataUrl?: string;
}

export interface DBFeedItem {
    id: string;
    sessionId: string;
    type: "ocr" | "audio";
    content: string;
    timestamp: string;
    source: string;
    windowName?: string;
    speaker?: number;
    deviceType?: "input" | "output";
    isFinal?: boolean;
}

export interface DBPreference {
    key: string;
    value: string;
}

const db = new Dexie("prmptr") as Dexie & {
    sessions: EntityTable<DBSession, "id">;
    responses: EntityTable<DBResponse, "id">;
    feedItems: EntityTable<DBFeedItem, "id">;
    preferences: EntityTable<DBPreference, "key">;
};

db.version(1).stores({
    sessions: "id, updatedAt",
    responses: "id, sessionId, timestamp",
});

db.version(2).stores({
    sessions: "id, updatedAt",
    responses: "id, sessionId, timestamp",
    feedItems: "id, sessionId, timestamp",
});

db.version(3).stores({
    sessions: "id, updatedAt",
    responses: "id, sessionId, timestamp",
    feedItems: "id, sessionId, timestamp",
    preferences: "key",
});

export { db };

export async function getPreference(key: string): Promise<string | undefined> {
    const row = await db.preferences.get(key);
    return row?.value;
}

export async function setPreference(key: string, value: string): Promise<void> {
    await db.preferences.put({ key, value });
}
