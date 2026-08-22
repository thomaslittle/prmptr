import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { AppSettings, LLMProvider, DEFAULT_SHORTCUTS } from "@/lib/types";
import {
    extractSecrets,
    hasAnySecret,
    loadSecrets,
    migrateLegacyPersistedSecrets,
    saveSecrets,
} from "@/lib/secret-store";

// No hosted default: voice transcripts must only leave the machine when the
// user explicitly configures a remote TTS endpoint. Env override still wins.
const DEFAULT_TTS_ENDPOINT =
    process.env.NEXT_PUBLIC_KOKORO_TTS_ENDPOINT ||
    process.env.NEXT_PUBLIC_TTS_ENDPOINT ||
    "";

function normalizeTtsModel(model?: string): string {
    const value = (model || "").trim();
    if (!value) return "model";
    if (value === "kokoro" || value === "kokoro-82m") return "model";
    if (value === "kokoro-tts") return "model_q4";
    return value;
}

const DEFAULT_SETTINGS: AppSettings = {
    screenpipeUrl: "http://localhost:3030",
    lmstudioUrl: "http://localhost:1234",
    voiceReplyEnabled: false,
    ttsProvider: "local-sherpa",
    ttsEndpoint: DEFAULT_TTS_ENDPOINT,
    ttsApiKey: "",
    ttsVoice: "",
    ttsModel: "model",
    ttsRegion: "en-US",
    ttsRate: 1,
    ttsVolume: 1,
    apiKeys: {},
    defaultProvider: "lmstudio",
    defaultModel: "lmstudio-auto",
    shortcuts: DEFAULT_SHORTCUTS,
    transcriptionMode: "local-whisper",
    localSttEngine: "whisper",
    muteInput: false,
    muteOutput: false,
    includeScreenshotOnAnalyze: false,
    localPreferGpu: false,
};

interface SettingsState {
    settings: AppSettings;
    setSettings: (settings: AppSettings) => void;
    updateApiKey: (provider: string, key: string) => void;
    configuredProviders: () => LLMProvider[];
    /** Merge secrets loaded from the secure store into runtime settings. */
    applySecrets: (secrets: Partial<AppSettings>) => void;
}

/** Strip credential fields so they never reach localStorage. */
function stripSecrets(settings: AppSettings | undefined): AppSettings {
    if (!settings) return { ...DEFAULT_SETTINGS };
    const rest = { ...settings, apiKeys: {} } as Record<string, unknown>;
    delete rest.deepgramApiKey;
    delete rest.ttsApiKey;
    return rest as unknown as AppSettings;
}

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set, get) => ({
            settings: DEFAULT_SETTINGS,
            setSettings: (settings) => {
                set({ settings });
                const secrets = extractSecrets(settings);
                if (hasAnySecret(secrets)) void saveSecrets(secrets);
            },
            applySecrets: (secrets) =>
                set((state) => ({ settings: { ...state.settings, ...secrets } })),
            updateApiKey: (provider, key) => {
                set((state) => {
                    const next = {
                        ...state.settings,
                        apiKeys: { ...state.settings.apiKeys, [provider]: key },
                    };
                    void saveSecrets(extractSecrets(next));
                    return { settings: next };
                });
            },
            configuredProviders: () => {
                const { apiKeys } = get().settings;
                const providers = new Set<LLMProvider>(["lmstudio"]);
                const allowedCloudProviders: LLMProvider[] = ["anthropic", "openai", "groq", "cerebras", "zen"];
                for (const [provider, key] of Object.entries(apiKeys)) {
                    if (key && allowedCloudProviders.includes(provider as LLMProvider)) {
                        providers.add(provider as LLMProvider);
                    }
                }
                return Array.from(providers);
            },
        }),
        {
            name: "prmptr-settings",
            storage: createJSONStorage(() => localStorage),
            partialize: (state) =>
                ({
                    settings: stripSecrets(state.settings),
                }) as SettingsState,
            merge: (persisted, current) => {
                const persistedState = persisted as Partial<SettingsState> | undefined;
                // Secrets are stripped from the persisted blob before merging.
                const cleanSettings = stripSecrets(persistedState?.settings);
                return {
                    ...current,
                    ...persistedState,
                    settings: {
                        ...DEFAULT_SETTINGS,
                        ...cleanSettings,
                        ttsModel: normalizeTtsModel(persistedState?.settings?.ttsModel),
                        shortcuts: {
                            ...DEFAULT_SHORTCUTS,
                            ...persistedState?.settings?.shortcuts,
                        },
                    },
                };
            },
        }
    )
);

/**
 * Startup sequence (client only):
 * 1. Migrate legacy plaintext secrets from the old localStorage blob into
 *    the secure store (one-time).
 * 2. Load secrets from the secure store and merge into runtime settings.
 */
if (typeof window !== "undefined") {
    void (async () => {
        try {
            const migrated = await migrateLegacyPersistedSecrets(
                localStorage.getItem("prmptr-settings")
            );
            const secrets = { ...(migrated ?? {}), ...((await loadSecrets()) ?? {}) };
            if (hasAnySecret(secrets)) {
                useSettingsStore.getState().applySecrets(secrets);
            }
            if (migrated) {
                // Re-persist the zustand blob without the migrated secrets.
                useSettingsStore.persist.rehydrate();
            }
        } catch (err) {
            console.warn("[settings] secret hydration failed:", err);
        }
    })();
}
