// Persisted-state builders matching the zustand `persist` blobs the app reads.

export interface SessionSeed {
    provider: string;
    model: string;
    triggerMode?: "manual" | "auto" | "smart";
    responseStyle?: "concise" | "detailed" | "ai-voice";
    localAi?: Record<string, unknown>;
}

export function sessionStorageFor(seed: SessionSeed): Record<string, unknown> {
    return {
        "prmptr-session": {
            state: {
                config: {
                    context: "E2E session",
                    triggerMode: seed.triggerMode ?? "manual",
                    responseStyle: seed.responseStyle ?? "concise",
                    personality: "witty",
                    autoIntervalSecs: 15,
                    contextSize: 6000,
                    provider: seed.provider,
                    model: seed.model,
                    ...(seed.localAi ? { localAi: seed.localAi } : {}),
                },
                currentSessionId: null,
            },
            version: 0,
        },
    };
}

export function settingsStorage(settings: Record<string, unknown>): Record<string, unknown> {
    return { "prmptr-settings": { state: { settings }, version: 0 } };
}
