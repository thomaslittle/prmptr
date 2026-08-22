"use client";

import { useEffect, useRef } from "react";

export default function OverlayPage() {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, []);

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
            </div>

            {/* Response content */}
            <div
                ref={containerRef}
                className="flex-1 overflow-y-auto px-3 pb-3 min-h-0"
            >
                <div className="flex items-center justify-center h-full text-stone-600 text-xs">
                    Waiting for response...
                </div>
            </div>

            {/* Bottom status */}
            <div className="h-5 flex items-center justify-between px-3 text-[9px] text-stone-600 shrink-0 border-t border-stone-800">
                <span>Ctrl+Shift+H to toggle</span>
                <span>Ctrl+Shift+C click-through</span>
            </div>
        </div>
    );
}
