"use client";

import { useState, useEffect, useRef } from "react";
import { isTauri, onResponseStream } from "@/lib/tauri";

export default function OverlayPage() {
    const [response, setResponse] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!isTauri()) return;

        let unlisten: (() => void) | null = null;

        onResponseStream((token) => {
            if (!token.is_complete && token.text) {
                setResponse((prev) => prev + token.text);
                setIsStreaming(true);
            }
            if (token.is_complete) {
                setIsStreaming(false);
            }
        }).then((fn) => (unlisten = fn));

        return () => unlisten?.();
    }, []);

    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [response]);

    return (
        <div className="h-screen w-screen bg-black/85 text-stone-100 flex flex-col overflow-hidden select-none">
            {/* Drag handle */}
            <div
                className="h-6 flex items-center justify-between px-3 shrink-0 cursor-move"
                data-tauri-drag-region
            >
                <span className="text-[9px] font-mono text-stone-500 uppercase tracking-widest">
                    PRMPTR
                </span>
                {isStreaming && (
                    <span className="text-[9px] text-emerald-400 animate-pulse">
                        streaming
                    </span>
                )}
            </div>

            {/* Response content */}
            <div
                ref={containerRef}
                className="flex-1 overflow-y-auto px-3 pb-3 min-h-0"
            >
                {response ? (
                    <div className="text-xs leading-relaxed whitespace-pre-wrap font-mono">
                        {response}
                        {isStreaming && (
                            <span className="inline-block w-1.5 h-3 bg-emerald-400 animate-pulse ml-0.5" />
                        )}
                    </div>
                ) : (
                    <div className="flex items-center justify-center h-full text-stone-600 text-xs">
                        Waiting for response...
                    </div>
                )}
            </div>

            {/* Bottom status */}
            <div className="h-5 flex items-center justify-between px-3 text-[9px] text-stone-600 shrink-0 border-t border-stone-800">
                <span>Ctrl+Shift+H to toggle</span>
                <span>Ctrl+Shift+C click-through</span>
            </div>
        </div>
    );
}
