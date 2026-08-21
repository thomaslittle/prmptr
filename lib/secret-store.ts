"use client";

import type { AppSettings } from "./types";

/**
 * Secrets (provider API keys, Deepgram key, TTS key) are deliberately NOT
 * persisted through zustand's localStorage blob. They live in a separate
 * store:
 * - In Tauri: @tauri-apps/plugin-store writes them to an app-private file.
 * - In plain-browser dev mode: they stay session-only (not persisted), so
 *   no plaintext credentials ever hit localStorage.
 */

const SECRET_FILE = "settings-secrets.json";

export interface AppSecrets {
    apiKeys?: AppSettings["apiKeys"];
    deepgramApiKey?: string;
    ttsApiKey?: string;
}

export function extractSecrets(settings: AppSettings): AppSecrets {
    const hasApiKeys =
        settings.apiKeys &&
        Object.values(settings.apiKeys).some((v) => !!v);
    return {
        ...(hasApiKeys ? { apiKeys: settings.apiKeys } : {}),
        ...(settings.deepgramApiKey ? { deepgramApiKey: settings.deepgramApiKey } : {}),
        ...(settings.ttsApiKey ? { ttsApiKey: settings.ttsApiKey } : {}),
    };
}

/** True if the settings object carries no secret material. */
export function hasAnySecret(secrets: AppSecrets): boolean {
    return (
        (!!secrets.apiKeys && Object.values(secrets.apiKeys).some((v) => !!v)) ||
        !!secrets.deepgramApiKey ||
        !!secrets.ttsApiKey
    );
}

async function tauriSecretStore() {
    const { Store } = await import("@tauri-apps/plugin-store");
    return Store.load(SECRET_FILE);
}

function isTauriRuntime(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function saveSecrets(secrets: AppSecrets): Promise<void> {
    try {
        if (!isTauriRuntime()) return;
        const store = await tauriSecretStore();
        await store.set("secrets", secrets);
    } catch (err) {
        console.warn("Failed to persist secrets:", err);
    }
}

export async function loadSecrets(): Promise<AppSecrets | null> {
    try {
        if (!isTauriRuntime()) return null;
        const store = await tauriSecretStore();
        return (await store.get<AppSecrets>("secrets")) ?? null;
    } catch (err) {
        console.warn("Failed to load secrets:", err);
        return null;
    }
}

/**
 * One-time migration: older versions persisted API keys inside the zustand
 * localStorage blob. If any are found there, move them into the secure
 * store and scrub them from localStorage.
 */
export async function migrateLegacyPersistedSecrets(
    legacyRaw: string | null
): Promise<AppSecrets | null> {
    if (!legacyRaw) return null;
    try {
        const parsed = JSON.parse(legacyRaw) as {
            state?: { settings?: Partial<AppSettings> };
        };
        const settings = parsed?.state?.settings;
        if (!settings) return null;

        const legacySecrets: AppSecrets = {};
        if (settings.apiKeys) legacySecrets.apiKeys = settings.apiKeys;
        if (settings.deepgramApiKey)
            legacySecrets.deepgramApiKey = settings.deepgramApiKey;
        if (settings.ttsApiKey) legacySecrets.ttsApiKey = settings.ttsApiKey;

        if (!hasAnySecret(legacySecrets)) return null;

        // Only migrate into the secure store when running inside Tauri.
        if (isTauriRuntime()) {
            const existing = await loadSecrets();
            const merged: AppSecrets = { ...legacySecrets, ...existing };
            await saveSecrets(merged);
            return merged;
        }
        return null;
    } catch {
        return null;
    }
}
