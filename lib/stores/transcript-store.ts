import { create } from "zustand";
import {
    reduceTranscriptLines,
    type TranscriptLine,
} from "@/lib/transcript";

interface TranscriptState {
    lines: TranscriptLine[];
    upsertLine: (line: TranscriptLine) => void;
    replaceLines: (lines: TranscriptLine[]) => void;
    clear: () => void;
}

/**
 * Canonical in-memory speech truth for the active live session.
 * UI feed items are projections of these lines, not a second transcription store.
 */
export const useTranscriptStore = create<TranscriptState>((set) => ({
    lines: [],
    upsertLine: (line) =>
        set((state) => ({
            lines: reduceTranscriptLines(state.lines, line),
        })),
    replaceLines: (lines) =>
        set({
            lines: reduceTranscriptLines([], lines),
        }),
    clear: () => set({ lines: [] }),
}));
