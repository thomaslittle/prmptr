import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { cleanSpeakerLabel } from "@/lib/prompt-builder";
import type { FeedItem } from "@/lib/types";

/**
 * User-chosen names for diarized system-audio speakers ("Speaker 2" → "Sarah").
 *
 * Keyed by the native speaker id. The Rust diarizer numbers speakers per
 * capture session, so aliases belong to the current feed session: they survive
 * a reload of that session and are cleared with "New session" (see
 * `useLocalTranscription().clear`).
 */
interface SpeakerAliasState {
    aliases: Record<string, string>;
    /** Set (or, with a blank name, remove) the alias for a speaker id. */
    setAlias: (speakerId: number, alias: string) => void;
    removeAlias: (speakerId: number) => void;
    clear: () => void;
}

function without(aliases: Record<string, string>, key: string): Record<string, string> {
    const rest = { ...aliases };
    delete rest[key];
    return rest;
}

export const useSpeakerAliasStore = create<SpeakerAliasState>()(
    persist(
        (set) => ({
            aliases: {},
            setAlias: (speakerId, alias) =>
                set((state) => {
                    const key = String(speakerId);
                    const cleaned = cleanSpeakerLabel(alias);
                    // Renaming back to the default label is the same as no alias.
                    if (!cleaned || cleaned === `Speaker ${speakerId}`) return { aliases: without(state.aliases, key) };
                    return { aliases: { ...state.aliases, [key]: cleaned } };
                }),
            removeAlias: (speakerId) => set((state) => ({ aliases: without(state.aliases, String(speakerId)) })),
            clear: () => set({ aliases: {} }),
        }),
        {
            name: "prmptr-speaker-aliases.v1",
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({ aliases: state.aliases }),
        }
    )
);

/** Alias for a speaker id, if the user named them. */
export function speakerAliasFor(aliases: Record<string, string>, speakerId: number | undefined): string | undefined {
    return speakerId == null ? undefined : aliases[String(speakerId)];
}

/** Apply user-chosen speaker names to system-audio lines (the mic is always "You"). */
export function applySpeakerAliases(items: FeedItem[], aliases: Record<string, string>): FeedItem[] {
    if (Object.keys(aliases).length === 0) return items;
    return items.map((item) => {
        if (item.deviceType !== "output") return item;
        const alias = speakerAliasFor(aliases, item.speaker);
        return alias && alias !== item.speakerLabel ? { ...item, speakerLabel: alias } : item;
    });
}
