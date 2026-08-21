"use client";

import { memo, useRef, useEffect } from "react";
import { FeedItem } from "@/lib/types";
import { Waveform, Monitor, Microphone, CaretLeft } from "@phosphor-icons/react";
import { Empty, EmptyMedia, EmptyHeader, EmptyTitle } from "@/components/ui/empty";

interface LiveFeedProps {
    items: FeedItem[];
    isPolling: boolean;
    isConnected: boolean;
    inputDevice?: string;
    outputDevice?: string;
    onCollapse?: () => void;
}

function sourceMatchesDevice(source: string, device?: string): boolean {
    if (!device) return false;
    if (source === device) return true;
    const stripSuffix = (s: string) => s.replace(/\s*\((input|output)\)\s*$/, "");
    return stripSuffix(source) === stripSuffix(device);
}

const SPEAKER_COLORS = [
    "text-blue-400",
    "text-violet-400",
    "text-amber-400",
    "text-emerald-400",
    "text-rose-400",
    "text-cyan-400",
    "text-orange-400",
    "text-pink-400",
];

function speakerColor(speakerId?: number): string {
    if (speakerId == null) return "text-muted-foreground/70";
    return SPEAKER_COLORS[(speakerId - 1) % SPEAKER_COLORS.length];
}

export default memo(function LiveFeed({
    items,
    isPolling,
    isConnected,
    inputDevice,
    outputDevice,
    onCollapse,
}: LiveFeedProps) {
    const bodyRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (bodyRef.current && items.length > 0) {
            bodyRef.current.scrollTop = 0;
        }
    }, [items.length]);

    return (
        <div className="flex flex-col min-h-0 flex-1">
            <div className="flex items-center justify-between px-4 h-10 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                    <Waveform weight="bold" className="size-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-foreground/80">Feed</span>
                </div>
                <div className="flex items-center gap-2">
                    {isPolling && (
                        <div className="flex items-center gap-1.5">
                            <span className="size-1 rounded-full bg-emerald-400 status-pulse" />
                            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Live</span>
                        </div>
                    )}
                    {onCollapse && (
                        <button
                            type="button"
                            onClick={onCollapse}
                            className="p-1 -mr-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors cursor-pointer"
                            title="Collapse feed"
                        >
                            <CaretLeft weight="bold" className="size-3.5" />
                        </button>
                    )}
                </div>
            </div>

            <div ref={bodyRef} className="flex-1 overflow-y-auto min-h-0" style={{ scrollBehavior: "smooth" }}>
                {items.length === 0 ? (
                    <Empty className="py-16 border-none text-muted-foreground/50">
                        <EmptyMedia>
                            {isConnected ? (
                                <Waveform weight="thin" className="size-8" />
                            ) : (
                                <Monitor weight="thin" className="size-8" />
                            )}
                        </EmptyMedia>
                        <EmptyHeader>
                            <EmptyTitle className="text-[11px] font-normal text-muted-foreground/50">
                                {isConnected ? "Listening for activity..." : "Start recording to see activity"}
                            </EmptyTitle>
                        </EmptyHeader>
                    </Empty>
                ) : (
                    <div className="flex flex-col">
                        {items.map((item, i) => (
                            <div
                                key={item.id}
                                className={`feed-item-enter px-4 py-2.5 ${i > 0 ? "border-t border-border" : ""} hover:bg-muted/30 transition-colors`}
                            >
                                <div className="flex items-center gap-1.5 mb-1">
                                    {item.type === "audio" ? (
                                        <Microphone weight="fill" className="size-2.5 text-primary/60" />
                                    ) : (
                                        <Monitor weight="fill" className="size-2.5 text-muted-foreground/60" />
                                    )}

                                    {item.type === "audio" && (item.deviceType === "input" || sourceMatchesDevice(item.source, inputDevice)) && (
                                        <span className="text-[9px] text-primary/70 font-medium uppercase tracking-wider">
                                            {item.speaker != null && item.speaker > 1 ? `You (Speaker ${item.speaker})` : "You"}
                                        </span>
                                    )}
                                    {item.type === "audio" && (item.deviceType === "output" || sourceMatchesDevice(item.source, outputDevice)) && (
                                        <span className={`text-[9px] font-medium uppercase tracking-wider ${speakerColor(item.speaker)}`}>
                                            {item.speakerLabel ?? "Them"}
                                        </span>
                                    )}

                                    <span className="text-[9px] text-muted-foreground/50 truncate ml-auto">
                                        {item.source || "Transcript"}
                                        {item.windowName ? ` / ${item.windowName}` : ""}
                                    </span>
                                    <span className="text-[9px] text-muted-foreground/40 tabular-nums shrink-0">
                                        {new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                    </span>
                                </div>

                                <p className="text-[11px] leading-relaxed text-foreground/80">
                                    {item.content.length > 300 ? `${item.content.slice(0, 300)}...` : item.content}
                                </p>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
});

