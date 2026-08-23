import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { MoonshineVoiceArch } from "@/lib/speech-tauri";

export interface SpeechPreferences {
    moonshineArch: MoonshineVoiceArch;
    contextBiasEnabled: boolean;
    contextMaxTerms: number;
    keytermBoost: number;
    maxKeyterms: number;
}

const DEFAULTS: SpeechPreferences = {
    moonshineArch: "medium-streaming",
    contextBiasEnabled: true,
    contextMaxTerms: 200,
    keytermBoost: 2,
    maxKeyterms: 120,
};

interface SpeechPreferenceState {
    preferences: SpeechPreferences;
    update: (patch: Partial<SpeechPreferences>) => void;
    reset: () => void;
}

export const useSpeechStore = create<SpeechPreferenceState>()(
    persist(
        (set) => ({
            preferences: DEFAULTS,
            update: (patch) => set((state) => ({
                preferences: {
                    ...state.preferences,
                    ...patch,
                    contextMaxTerms: Math.max(1, Math.min(patch.contextMaxTerms ?? state.preferences.contextMaxTerms, 400)),
                    keytermBoost: Math.max(0, Math.min(patch.keytermBoost ?? state.preferences.keytermBoost, 4)),
                    maxKeyterms: Math.max(0, Math.min(patch.maxKeyterms ?? state.preferences.maxKeyterms, 200)),
                },
            })),
            reset: () => set({ preferences: DEFAULTS }),
        }),
        {
            name: "prmptr-speech-preferences.v1",
            storage: createJSONStorage(() => localStorage),
        }
    )
);
