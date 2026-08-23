import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { normalizeGlossaryTerms } from "@/lib/speech-context";
import type { MoonshineQualityProfile, MoonshineVoiceArch } from "@/lib/speech-tauri";

export interface SpeechPreferences {
    moonshineQuality: MoonshineQualityProfile;
    moonshineArch: MoonshineVoiceArch;
    contextBiasEnabled: boolean;
    contextMaxTerms: number;
    keytermBoost: number;
    maxKeyterms: number;
    glossary: string[];
}

const DEFAULTS: SpeechPreferences = {
    moonshineQuality: "auto",
    moonshineArch: "medium-streaming",
    contextBiasEnabled: true,
    contextMaxTerms: 200,
    keytermBoost: 2,
    maxKeyterms: 120,
    glossary: [],
};

interface SpeechPreferenceState {
    preferences: SpeechPreferences;
    update: (patch: Partial<SpeechPreferences>) => void;
    setGlossary: (terms: string[]) => void;
    addGlossaryTerm: (term: string) => void;
    removeGlossaryTerm: (term: string) => void;
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
                    glossary: patch.glossary
                        ? normalizeGlossaryTerms(patch.glossary)
                        : state.preferences.glossary,
                },
            })),
            setGlossary: (terms) => set((state) => ({
                preferences: {
                    ...state.preferences,
                    glossary: normalizeGlossaryTerms(terms),
                },
            })),
            addGlossaryTerm: (term) => set((state) => ({
                preferences: {
                    ...state.preferences,
                    glossary: normalizeGlossaryTerms([...state.preferences.glossary, term]),
                },
            })),
            removeGlossaryTerm: (term) => set((state) => ({
                preferences: {
                    ...state.preferences,
                    glossary: state.preferences.glossary.filter(
                        (value) => value.toLocaleLowerCase() !== term.trim().toLocaleLowerCase()
                    ),
                },
            })),
            reset: () => set({ preferences: DEFAULTS }),
        }),
        {
            name: "prmptr-speech-preferences.v3",
            storage: createJSONStorage(() => localStorage),
            migrate: (persisted) => {
                const state = persisted as Partial<SpeechPreferenceState> | undefined;
                const previous = state?.preferences ?? ({} as Partial<SpeechPreferences>);
                return {
                    ...state,
                    preferences: {
                        ...DEFAULTS,
                        ...previous,
                        moonshineQuality: previous.moonshineQuality ?? "auto",
                        glossary: normalizeGlossaryTerms(previous.glossary ?? []),
                    },
                } as SpeechPreferenceState;
            },
            version: 3,
        }
    )
);
