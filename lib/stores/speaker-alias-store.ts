import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

function cleanAlias(value: string): string {
    return value
        .replace(/[\r\n\[\]]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 64);
}

interface SpeakerAliasState {
    aliases: Record<string, string>;
    setAlias: (speakerKey: string, alias: string) => void;
    removeAlias: (speakerKey: string) => void;
    clear: () => void;
}

export const useSpeakerAliasStore = create<SpeakerAliasState>()(
    persist(
        (set) => ({
            aliases: {},
            setAlias: (speakerKey, alias) => set((state) => {
                const cleaned = cleanAlias(alias);
                if (!cleaned) {
                    const { [speakerKey]: _removed, ...rest } = state.aliases;
                    return { aliases: rest };
                }
                return { aliases: { ...state.aliases, [speakerKey]: cleaned } };
            }),
            removeAlias: (speakerKey) => set((state) => {
                const { [speakerKey]: _removed, ...rest } = state.aliases;
                return { aliases: rest };
            }),
            clear: () => set({ aliases: {} }),
        }),
        {
            name: "prmptr-speaker-aliases.v1",
            storage: createJSONStorage(() => localStorage),
        }
    )
);
