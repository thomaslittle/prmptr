"use client";

import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { EyeSlash, LockSimple, MouseSimple, Sparkle, X } from "@phosphor-icons/react";
import {
    getOverlayState,
    hideOverlay,
    onOverlayContent,
    onOverlayRuntimeState,
    type OverlayContent,
    type OverlayRuntimeState,
} from "@/lib/overlay";

const EMPTY_CONTENT: OverlayContent = {
    responses: [],
    currentResponse: "",
    isStreaming: false,
    appearance: { opacity: 0.9, fontScale: 1 },
};

export default function OverlayPage() {
    const [runtime, setRuntime] = useState<OverlayRuntimeState | null>(null);
    const [content, setContent] = useState<OverlayContent>(EMPTY_CONTENT);

    useEffect(() => {
        const htmlBackground = document.documentElement.style.background;
        const bodyBackground = document.body.style.background;
        document.documentElement.style.background = "transparent";
        document.body.style.background = "transparent";
        return () => {
            document.documentElement.style.background = htmlBackground;
            document.body.style.background = bodyBackground;
        };
    }, []);

    useEffect(() => {
        let disposed = false;
        let stopContent: (() => void) | null = null;
        let stopRuntime: (() => void) | null = null;

        void (async () => {
            try {
                const state = await getOverlayState();
                if (!disposed) {
                    setRuntime(state);
                    setContent(state.content ?? EMPTY_CONTENT);
                }
            } catch (error) {
                console.warn("[overlay] failed to load initial state", error);
            }
            stopContent = await onOverlayContent((next) => {
                if (!disposed) setContent(next);
            });
            stopRuntime = await onOverlayRuntimeState((next) => {
                if (!disposed) {
                    setRuntime(next);
                    setContent(next.content ?? EMPTY_CONTENT);
                }
            });
        })();

        return () => {
            disposed = true;
            stopContent?.();
            stopRuntime?.();
        };
    }, []);

    const completed = useMemo(
        () => content.responses.filter((response) => response.content.trim().length > 0),
        [content.responses]
    );
    const hasStreaming = content.currentResponse.trim().length > 0;
    const opacity = content.appearance?.opacity ?? 0.9;
    const fontScale = content.appearance?.fontScale ?? 1;

    return (
        <main className="h-screen w-screen overflow-hidden bg-transparent p-2 text-foreground select-none" style={{ fontSize: `${fontScale}rem` }}>
            <section className="flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-background/95 shadow-2xl backdrop-blur-xl" style={{ opacity }}>
                <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border/70 px-3 cursor-move" data-tauri-drag-region>
                    <Sparkle weight="fill" className="size-3 text-primary" />
                    <span className="text-[10px] font-semibold tracking-[0.18em] text-foreground/75">PRMPTR</span>
                    {content.isStreaming && (
                        <span className="ml-1 flex items-center gap-1 text-[9px] text-emerald-400">
                            <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            thinking
                        </span>
                    )}
                    <div className="ml-auto flex items-center gap-1 text-muted-foreground/60">
                        {runtime?.captureProtected && (
                            <span title="Hidden from screen capture" className="inline-flex p-1"><LockSimple className="size-3" /></span>
                        )}
                        {runtime?.clickThrough ? (
                            <span title="Click-through enabled; use the main PRMPTR window or shortcut to disable it" className="inline-flex p-1"><MouseSimple className="size-3" /></span>
                        ) : (
                            <button type="button" onClick={() => void hideOverlay()} className="rounded p-1 hover:bg-muted hover:text-foreground" title="Hide overlay"><X className="size-3" /></button>
                        )}
                    </div>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                    {hasStreaming && (
                        <article className="mb-3 rounded-lg border border-primary/20 bg-primary/[0.06] p-3 text-[0.78em] leading-relaxed text-foreground">
                            <div className="mb-1 text-[0.65em] font-semibold uppercase tracking-[0.14em] text-primary/80">Live response</div>
                            <div className="prose-response"><ReactMarkdown>{content.currentResponse}</ReactMarkdown></div>
                        </article>
                    )}

                    {completed.length > 0 ? (
                        <div className="space-y-2">
                            {completed.map((response, index) => (
                                <article key={response.id} className={`rounded-lg border border-border/70 bg-muted/20 p-3 text-[0.75em] leading-relaxed ${index === 0 && !hasStreaming ? "border-primary/20 bg-primary/[0.04]" : ""}`}>
                                    <div className="mb-1.5 flex items-center gap-2 text-[0.62em] uppercase tracking-[0.12em] text-muted-foreground/60">
                                        <span>{response.kind === "chat" ? "Chat" : "Suggestion"}</span>
                                        <span className="ml-auto normal-case tracking-normal">{response.model || "AI"}</span>
                                    </div>
                                    <div className="prose-response text-foreground/90"><ReactMarkdown>{response.content}</ReactMarkdown></div>
                                </article>
                            ))}
                        </div>
                    ) : !hasStreaming ? (
                        <div className="flex h-full min-h-28 flex-col items-center justify-center gap-2 text-center text-muted-foreground/45">
                            <EyeSlash className="size-5" />
                            <p className="text-[0.72em]">Waiting for the next PRMPTR response…</p>
                        </div>
                    ) : null}
                </div>

                <footer className="flex h-7 shrink-0 items-center gap-2 border-t border-border/60 px-3 text-[9px] text-muted-foreground/45">
                    <span>{runtime?.clickThrough ? "click-through" : "interactive"}</span>
                    <span className="mx-1">•</span>
                    <span>always on top</span>
                    {content.sessionId && <span className="ml-auto truncate">session active</span>}
                </footer>
            </section>
        </main>
    );
}
