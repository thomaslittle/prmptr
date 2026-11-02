"use client";

import { memo, useRef, useEffect, useState } from "react";
import { FeedItem } from "@/lib/types";
import { useSpeakerAliasStore } from "@/lib/stores/speaker-alias-store";
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

/** Inline editor for a diarized speaker's display name. */
function SpeakerNameInput({
    initial,
    defaultLabel,
    className,
    onSave,
    onCancel,
}: {
    initial: string;
    defaultLabel: string;
    className: string;
    onSave: (value: string) => void;
    onCancel: () => void;
}) {
    const [value, setValue] = useState(initial);
    // Escape and Enter both end editing; whichever comes first wins so the
    // blur that follows unmounting can't save a cancelled edit.
    const doneRef = useRef(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const finish = (save: boolean, restoreFocus: boolean) => {
        if (doneRef.current) return;
        doneRef.current = true;
        // Hand focus back to this line's chip (re-rendered in place of the
        // input) so keyboard users stay where they were. Not on blur: the
        // user already moved focus somewhere else.
        const row = restoreFocus ? inputRef.current?.closest("[data-feed-row]") : null;
        if (save) onSave(value);
        else onCancel();
        if (row) requestAnimationFrame(() => row.querySelector<HTMLElement>("[data-speaker-chip]")?.focus());
    };
    return (
        <input
            ref={inputRef}
            autoFocus
            value={value}
            maxLength={64}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setValue(event.target.value)}
            onBlur={() => finish(true, false)}
            onKeyDown={(event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    finish(true, true);
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    finish(false, true);
                }
            }}
            aria-label={`Name for ${defaultLabel}`}
            placeholder={defaultLabel}
            className={`h-5 w-32 rounded-sm border border-border bg-background px-1 text-[9px] font-medium uppercase tracking-wider outline-none focus:border-primary/60 ${className}`}
        />
    );
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
    const aliases = useSpeakerAliasStore((state) => state.aliases);
    const setSpeakerAlias = useSpeakerAliasStore((state) => state.setAlias);
    // Which line's chip is being edited (one input, even when the same
    // speaker has many lines); the alias itself applies to the speaker id.
    const [editingItemId, setEditingItemId] = useState<string | null>(null);

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
                                data-feed-row
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
                                    {item.type === "audio" && (item.deviceType === "output" || sourceMatchesDevice(item.source, outputDevice)) && (() => {
                                        const color = speakerColor(item.speaker);
                                        const label = item.speakerLabel ?? (item.speaker != null ? `Speaker ${item.speaker}` : "Them");
                                        // Only diarized lines have a stable identity to rename.
                                        if (item.speaker == null) {
                                            return (
                                                <span className={`text-[9px] font-medium uppercase tracking-wider ${color}`}>{label}</span>
                                            );
                                        }
                                        const speakerId = item.speaker;
                                        const defaultLabel = `Speaker ${speakerId}`;
                                        if (editingItemId === item.id) {
                                            return (
                                                <SpeakerNameInput
                                                    initial={aliases[String(speakerId)] ?? label}
                                                    defaultLabel={defaultLabel}
                                                    className={color}
                                                    onSave={(value) => {
                                                        setSpeakerAlias(speakerId, value);
                                                        setEditingItemId(null);
                                                    }}
                                                    onCancel={() => setEditingItemId(null)}
                                                />
                                            );
                                        }
                                        return (
                                            <button
                                                type="button"
                                                data-speaker-chip
                                                onClick={() => setEditingItemId(item.id)}
                                                aria-label={`Rename ${label}`}
                                                title="Rename this speaker (applies to all of their lines)"
                                                className={`rounded-sm text-[9px] font-medium uppercase tracking-wider cursor-text hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 ${color}`}
                                            >
                                                {label}
                                            </button>
                                        );
                                    })()}

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

