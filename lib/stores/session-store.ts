import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { SessionConfig, ResponseEntry } from "@/lib/types";

const DEFAULT_SESSION: SessionConfig = {
    context:
        "Listen to all audio — mic and system sound. Pay close attention to dialog and conversation. When you hear questions being asked, provide helpful answers. Summarize what's being discussed and offer relevant insights.",
    triggerMode: "auto",
    responseStyle: "concise",
    personality: "roast",
    autoIntervalSecs: 15,
    contextSize: 6000,
    model: "lmstudio-auto",
    provider: "lmstudio",
};

interface SessionState {
    config: SessionConfig;
    setConfig: (config: SessionConfig) => void;
    currentSessionId: string | null;
    setCurrentSessionId: (id: string | null) => void;
    responses: ResponseEntry[];
    setResponses: (responses: ResponseEntry[]) => void;
    addResponse: (entry: ResponseEntry) => void;
    clearResponses: () => void;
    currentResponse: string;
    isStreaming: boolean;
    setCurrentResponse: (text: string) => void;
    setIsStreaming: (streaming: boolean) => void;
}

export const useSessionStore = create<SessionState>()(
    persist(
        (set) => ({
            config: DEFAULT_SESSION,
            setConfig: (config) => set({ config }),
            currentSessionId: null,
            setCurrentSessionId: (id) => set({ currentSessionId: id }),
            responses: [],
            setResponses: (responses) => set({ responses }),
            addResponse: (entry) =>
                set((state) => ({
                    responses: [entry, ...state.responses].slice(0, 50),
                })),
            clearResponses: () => set({ responses: [], currentResponse: "" }),
            currentResponse: "",
            isStreaming: false,
            setCurrentResponse: (text) => set({ currentResponse: text }),
            setIsStreaming: (streaming) => set({ isStreaming: streaming }),
        }),
        {
            name: "prmptr-session",
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                config: state.config,
                currentSessionId: state.currentSessionId,
            }),
        }
    )
);
