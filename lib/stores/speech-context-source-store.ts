import { create } from "zustand";
import type { FeedItem } from "@/lib/types";

interface SpeechContextSourceState {
    ocrItems: FeedItem[];
    push: (item: FeedItem) => void;
    clear: () => void;
}

export const useSpeechContextSourceStore = create<SpeechContextSourceState>((set) => ({
    ocrItems: [],
    push: (item) => {
        if (item.type !== "ocr") return;
        set((state) => {
            if (state.ocrItems.some((existing) => existing.id === item.id)) return state;
            return { ocrItems: [item, ...state.ocrItems].slice(0, 60) };
        });
    },
    clear: () => set({ ocrItems: [] }),
}));
