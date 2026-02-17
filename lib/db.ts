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

const db = new Dexie("prmptr") as Dexie & {
    sessions: EntityTable<DBSession, "id">;
    responses: EntityTable<DBResponse, "id">;
    feedItems: EntityTable<DBFeedItem, "id">;
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

export { db };
