import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { AppSettings, LLMProvider, DEFAULT_SHORTCUTS } from "@/lib/types";

const DEFAULT_TTS_ENDPOINT =
    process.env.NEXT_PUBLIC_KOKORO_TTS_ENDPOINT ||
    process.env.NEXT_PUBLIC_TTS_ENDPOINT ||
    "https://kokoro.zomlit.com/api/v1/audio/speech";

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
    transcriptionMode: "screenpipe",
    localPreferGpu: false,
};

interface SettingsState {
    settings: AppSettings;
    setSettings: (settings: AppSettings) => void;
    updateApiKey: (provider: string, key: string) => void;
    configuredProviders: () => LLMProvider[];
}

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set, get) => ({
            settings: DEFAULT_SETTINGS,
            setSettings: (settings) => set({ settings }),
            updateApiKey: (provider, key) =>
                set((state) => ({
                    settings: {
                        ...state.settings,
                        apiKeys: { ...state.settings.apiKeys, [provider]: key },
                    },
                })),
            configuredProviders: () => {
                const { apiKeys } = get().settings;
                return [
                    "lmstudio" as LLMProvider,
                    ...Object.entries(apiKeys)
                        .filter(([, key]) => !!key)
                        .map(([provider]) => provider as LLMProvider),
                ];
            },
        }),
        {
            name: "prmptr-settings",
            storage: createJSONStorage(() => localStorage),
            merge: (persisted, current) => {
                const persistedState = persisted as Partial<SettingsState> | undefined;
                return {
                    ...current,
                    ...persistedState,
                    settings: {
                        ...DEFAULT_SETTINGS,
                        ...persistedState?.settings,
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
