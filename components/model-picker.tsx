"use client";

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { MagnifyingGlass, Star, CaretDown, CaretRight } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { LLMProvider } from "@/lib/types";
import { ClaudeAI, OpenAI, OpenCodeIcon, LMStudioIcon } from "@/components/provider-icons";
import { modelDisplayName, modelVersionInfo, compareModelVersions } from "@/lib/model-display";

interface PickableModel {
    id: string;
    name: string;
    provider: LLMProvider;
}

type ProviderIconComponent = React.ComponentType<{ className?: string }>;

interface ModelPickerProps {
    models: PickableModel[];
    value?: string;
    providerValue?: LLMProvider;
    onSelect: (model: PickableModel) => void;
    className?: string;
}

interface RowEntry {
    id: string;
    provider: LLMProvider;
    displayName: string;
    isLegacy: boolean;
    version: { major: number; minor: number } | null;
}

const PROVIDER_META: Partial<Record<LLMProvider, { label: string; monogram: string; icon?: ProviderIconComponent }>> = {
    lmstudio: { label: "LM Studio", monogram: "LM", icon: LMStudioIcon },
    zen: { label: "OpenCode Zen", monogram: "Z", icon: OpenCodeIcon },
    "claude-cli": { label: "Claude Code", monogram: "C", icon: ClaudeAI },
    "codex-cli": { label: "Codex (ChatGPT)", monogram: "X", icon: OpenAI },
    "opencode-cli": { label: "OpenCode", monogram: "O", icon: OpenCodeIcon },
    anthropic: { label: "Anthropic", monogram: "A", icon: ClaudeAI },
    openai: { label: "OpenAI", monogram: "O", icon: OpenAI },
    groq: { label: "Groq", monogram: "G", icon: OpenAI },
    cerebras: { label: "Cerebras", monogram: "B", icon: OpenAI },
};

function providerMeta(provider: LLMProvider) {
    const meta = PROVIDER_META[provider];
    if (meta) return meta;
    return {
        label: provider.charAt(0).toUpperCase() + provider.slice(1),
        monogram: provider.charAt(0).toUpperCase(),
    };
}

function ProviderBrandIcon({ provider, className }: { provider: LLMProvider; className?: string }) {
    const meta = providerMeta(provider);
    if (meta.icon) {
        const Icon = meta.icon;
        return <Icon className={cn("shrink-0", className)} />;
    }
    return (
        <span className={cn("text-[9px] font-bold uppercase text-foreground/60", className)}>
            {meta.monogram}
        </span>
    );
}

function ProviderRailIcon({ provider, active, onClick }: { provider: LLMProvider; active: boolean; onClick: () => void }) {
    const meta = providerMeta(provider);
    return (
        <button
            type="button"
            title={meta.label}
            aria-label={meta.label}
            aria-pressed={active}
            onClick={onClick}
            className={cn(
                "relative isolate flex aspect-square w-full cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-[color-mix(in_srgb,var(--popover)_85%,var(--foreground))]",
                active && "bg-[color-mix(in_srgb,var(--popover)_85%,var(--foreground))]",
            )}
        >
            <span
                className={cn(
                    "pointer-events-none absolute -right-0.5 top-1/2 z-10 h-5 w-0.5 -translate-y-1/2 rounded-l-full bg-primary transition-opacity",
                    active ? "opacity-100" : "opacity-0",
                )}
            />
            <ProviderBrandIcon provider={provider} className="size-5" />
        </button>
    );
}

const FAVORITES_STORAGE_KEY = "prmptr.model-picker.favorites";
type FavoriteKey = string;

function loadFavorites(): Set<FavoriteKey> {
    if (typeof window === "undefined") return new Set();
    try {
        const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
        if (!raw) return new Set();
        return new Set(JSON.parse(raw) as string[]);
    } catch {
        return new Set();
    }
}

export function ModelPicker({ models, value, providerValue, onSelect, className }: ModelPickerProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [activeProvider, setActiveProvider] = useState<LLMProvider | "favorites">("favorites");
    const [index, setIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [favorites, setFavorites] = useState<Set<FavoriteKey>>(loadFavorites);

    const favoriteKey = useCallback((provider: LLMProvider, id: string) => `${provider}:${id}`, []);

    const toggleFavorite = useCallback(
        (provider: LLMProvider, id: string) => {
            setFavorites((prev) => {
                const next = new Set(prev);
                const key = favoriteKey(provider, id);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                try {
                    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify([...next]));
                } catch {}
                return next;
            });
        },
        [favoriteKey]
    );

    const [expandedLegacy, setExpandedLegacy] = useState(false);

    const providerOrder = useMemo(() => {
        const seen: LLMProvider[] = [];
        for (const m of models) {
            if (!seen.includes(m.provider)) seen.push(m.provider);
        }
        return seen;
    }, [models]);

    const grouped = useMemo(() => {
        const map: Record<LLMProvider, PickableModel[]> = {} as Record<LLMProvider, PickableModel[]>;
        for (const m of models) {
            (map[m.provider] ??= []).push(m);
        }
        return map;
    }, [models]);

    // Build current + legacy model rows for the active provider (or all
    // favorites). Rows carry version info so we can sort newest-first and
    // collapse older models under a "Legacy models" section, like t3chat.
    const entriesForProvider = useCallback(
        (provider: LLMProvider): RowEntry[] => {
            const list = grouped[provider] ?? [];
            const ids = list.map((m) => m.id);
            return list.map((m) => {
                const v = modelVersionInfo(m.id, provider, ids);
                return {
                    id: m.id,
                    provider,
                    displayName: m.name || modelDisplayName(m.id, provider),
                    isLegacy: v.isLegacy,
                    version: v.version,
                };
            });
        },
        [grouped]
    );

    // Ordered "current models" (newest first) for the active source.
    const currentRows = useMemo(() => {
        let rows: RowEntry[] = [];
        if (activeProvider === "favorites") {
            for (const p of providerOrder) {
                for (const row of entriesForProvider(p)) {
                    if (favorites.has(favoriteKey(p, row.id))) rows.push(row);
                }
            }
        } else {
            rows = entriesForProvider(activeProvider);
        }
        rows = rows.filter((r) => !r.isLegacy);
        return rows.sort((a, b) => compareModelVersions(a.version, b.version) || a.displayName.localeCompare(b.displayName));
    }, [activeProvider, providerOrder, favorites, favoriteKey, entriesForProvider]);

    const legacyRows = useMemo(() => {
        if (activeProvider === "favorites") return [];
        return entriesForProvider(activeProvider)
            .filter((r) => r.isLegacy)
            .sort((a, b) => compareModelVersions(a.version, b.version) || a.displayName.localeCompare(b.displayName));
    }, [activeProvider, entriesForProvider]);

    // Apply search across both groups.
    const filterRows = useCallback((rows: RowEntry[]) => {
        const q = query.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter((r) => {
            const meta = providerMeta(r.provider);
            return (
                r.displayName.toLowerCase().includes(q) ||
                r.id.toLowerCase().includes(q) ||
                r.provider.toLowerCase().includes(q) ||
                meta.label.toLowerCase().includes(q)
            );
        });
    }, [query]);

    const visibleCurrent = useMemo(() => filterRows(currentRows), [currentRows, filterRows]);
    const visibleLegacy = useMemo(() => filterRows(legacyRows), [legacyRows, filterRows]);

    // Flatten into the ordered list the listbox renders. Legacy models are only
    // shown when their section is expanded.
    const visibleRows = useMemo(() => {
        if (visibleLegacy.length === 0) return visibleCurrent;
        return expandedLegacy ? [...visibleCurrent, ...visibleLegacy] : visibleCurrent;
    }, [visibleCurrent, visibleLegacy, expandedLegacy]);

    const selectedIndex = useMemo(() => {
        if (!value) return -1;
        return visibleRows.findIndex((e) => e.id === value && e.provider === providerValue);
    }, [visibleRows, value, providerValue]);

    // Clamp the keyboard index to the current visible list during render so we
    // never schedule a state update purely to correct it.
    const clampedIndex = visibleRows.length > 0 && index >= visibleRows.length ? 0 : index;
    const activeIndex = selectedIndex >= 0 ? selectedIndex : clampedIndex;

    const reset = useCallback(() => {
        setQuery("");
        setActiveProvider("favorites");
        setIndex(0);
        setExpandedLegacy(false);
    }, []);

    const onOpenChange = useCallback(
        (next: boolean) => {
            setOpen(next);
            if (next) {
                const initial =
                    providerValue ?? (favorites.size > 0 ? "favorites" : providerOrder[0]);
                setActiveProvider(initial);
                setIndex(0);
                // Start with the legacy section collapsed unless the current
                // model lives there, so vertical lists stay scannable.
                setExpandedLegacy(false);
                setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
            } else {
                reset();
            }
        },
        [favorites.size, providerValue, providerOrder, reset]
    );

    const commit = useCallback(
        (entry: RowEntry) => {
            const model = (grouped[entry.provider] ?? []).find((m) => m.id === entry.id);
            if (!model) return;
            onSelect(model);
            setOpen(false);
            reset();
        },
        [onSelect, reset, grouped]
    );

    const onKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            // Ctrl+1..9 jump directly to a visible model (mirrors t3code).
            if (e.ctrlKey && /^Digit[1-9]$/.test(e.key)) {
                const jumpIndex = parseInt(e.key.slice(5), 10) - 1;
                if (visibleRows[jumpIndex]) {
                    e.preventDefault();
                    commit(visibleRows[jumpIndex]);
                }
                return;
            }
            if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => (i + 1) % Math.max(visibleRows.length, 1));
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => (i - 1 + visibleRows.length) % Math.max(visibleRows.length, 1));
            } else if (e.key === "Enter") {
                e.preventDefault();
                const entry = visibleRows[activeIndex];
                if (entry) commit(entry);
            } else if (e.key === "Escape") {
                e.preventDefault();
                setOpen(false);
                reset();
            }
        },
        [visibleRows, activeIndex, commit, reset]
    );

    useEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const el = list.querySelector<HTMLElement>(`[data-index="${clampedIndex}"]`);
        if (!el) return;
        // Scroll only the model list container vertically. Never call
        // scrollIntoView on the portal/anchor: the popup uses overflow-hidden,
        // and scrollIntoView would programmatically shift THAT container too,
        // sliding the provider rail out of view.
        const itemTop = el.offsetTop - list.offsetTop;
        const itemBottom = itemTop + el.offsetHeight;
        const viewTop = list.scrollTop;
        const viewBottom = viewTop + list.clientHeight;
        if (itemTop < viewTop) list.scrollTop = itemTop;
        else if (itemBottom > viewBottom) list.scrollTop = itemBottom - list.clientHeight;
    }, [clampedIndex, visibleRows.length]);

    const currentModel = value ? models.find((m) => m.id === value) : undefined;
    const currentDisplayName = currentModel
        ? currentModel.name || modelDisplayName(currentModel.id, currentModel.provider)
        : undefined;

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger
                render={
                    <button
                        type="button"
                        className={cn(
                            "flex h-7 w-full items-center gap-2 border border-input bg-transparent px-2.5 text-xs transition-colors hover:border-ring/50",
                            className
                        )}
                    >
                        {currentModel ? (
                            <>
                                <ProviderBrandIcon provider={currentModel.provider} className="size-4" />
                                <span className="truncate flex-1 text-left">{currentDisplayName}</span>
                            </>
                        ) : (
                            <span className="text-muted-foreground">Select a model</span>
                        )}
                        <CaretDown weight="bold" className="shrink-0 size-3 text-muted-foreground" />
                    </button>
                }
            />
            <PopoverContent
                align="start"
                side="bottom"
                sideOffset={4}
                className="!w-[360px] max-w-[calc(100vw-16px)] overflow-visible p-0"
            >
                <div className="flex h-[340px] w-[360px] max-w-[calc(100vw-16px)] flex-row overflow-hidden bg-muted/40">
                    {/* Sidebar rail */}
                    <div className="w-11 shrink-0 overflow-hidden border-r border-border/70">
                        <div className="h-full overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                            <div className="flex min-h-full flex-col gap-1 p-1">
                                <div className="relative w-full">
                                    <button
                                        type="button"
                                        aria-label="Favorites"
                                        aria-pressed={activeProvider === "favorites"}
                                        onClick={() => {
                                            setActiveProvider("favorites");
                                            setIndex(0);
                                        }}
                                        className={cn(
                                            "relative isolate flex aspect-square w-full cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-[color-mix(in_srgb,var(--popover)_85%,var(--foreground))]",
                                            activeProvider === "favorites" && "bg-[color-mix(in_srgb,var(--popover)_85%,var(--foreground))]",
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "pointer-events-none absolute -right-1 top-1/2 z-10 h-5 w-0.5 -translate-y-1/2 rounded-l-full bg-primary transition-opacity",
                                                activeProvider === "favorites" ? "opacity-100" : "opacity-0",
                                            )}
                                        />
                                        <Star weight="fill" className="size-5 shrink-0" aria-hidden />
                                    </button>
                                </div>
                                <div className="border-b border-border/70" aria-hidden="true" />
                                {providerOrder.map((p) => (
                                    <div key={p} className="relative w-full">
                                        <ProviderRailIcon
                                            provider={p}
                                            active={activeProvider === p}
                                            onClick={() => {
                                                setActiveProvider(p);
                                                setIndex(0);
                                            }}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Main content */}
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                        {/* Search */}
                        <div className="px-2 pt-2">
                            <div className="border-b border-border/70 pb-2.5 transition-colors focus-within:border-ring">
                                <div className="relative flex items-center">
                                    <MagnifyingGlass className="pointer-events-none absolute left-0 size-4 shrink-0 text-muted-foreground opacity-70" />
                                    <input
                                        ref={inputRef}
                                        value={query}
                                        onChange={(e) => {
                                            setQuery(e.target.value);
                                            setIndex(0);
                                        }}
                                        onKeyDown={onKeyDown}
                                        placeholder="Search models..."
                                        aria-label="Search models"
                                        className="h-6.5 w-full bg-transparent pl-5.5 pr-2 text-sm outline-none placeholder:text-muted-foreground/50"
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Model list */}
                        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1.5 pr-1" role="listbox" aria-label="Models">
                            {visibleCurrent.length === 0 && visibleLegacy.length === 0 ? (
                                <p className="px-3 py-6 text-xs text-muted-foreground/60">
                                    {activeProvider === "favorites" ? "No favorites yet." : "No models found."}
                                </p>
                            ) : (
                                <>
                                    {visibleCurrent.map((row, i) => {
                                        const isSelected = row.id === value && row.provider === providerValue;
                                        const isActive = activeIndex === i;
                                        const isFavorite = favorites.has(favoriteKey(row.provider, row.id));
                                        return (
                                            <Row
                                                key={`${row.provider}:${row.id}`}
                                                row={row}
                                                index={i}
                                                isSelected={isSelected}
                                                isActive={isActive}
                                                isFavorite={isFavorite}
                                                onCommit={() => commit(row)}
                                                onHover={() => setIndex(i)}
                                                onToggleFavorite={(e) => {
                                                    e.stopPropagation();
                                                    toggleFavorite(row.provider, row.id);
                                                }}
                                            />
                                        );
                                    })}

                                    {visibleLegacy.length > 0 && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => setExpandedLegacy((v) => !v)}
                                                aria-expanded={expandedLegacy}
                                                className="group flex w-full max-w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--popover)_90%,var(--foreground))]"
                                            >
                                                <div className="min-w-0 flex-1 text-left">
                                                    <div className="text-xs font-medium leading-snug">Legacy models</div>
                                                    <div className="mt-1 text-xs leading-snug text-muted-foreground/70">
                                                        {visibleLegacy.length} models
                                                    </div>
                                                </div>
                                                <CaretRight
                                                    weight="bold"
                                                    className={cn("size-4 shrink-0 text-muted-foreground transition-transform", expandedLegacy && "rotate-90")}
                                                />
                                            </button>
                                            {expandedLegacy &&
                                                visibleLegacy.map((row, j) => {
                                                    const offset = visibleCurrent.length + 1 + j;
                                                    const isSelected = row.id === value && row.provider === providerValue;
                                                    const isActive = activeIndex === offset;
                                                    const isFavorite = favorites.has(favoriteKey(row.provider, row.id));
                                                    return (
                                                        <Row
                                                            key={`${row.provider}:${row.id}`}
                                                            row={row}
                                                            index={offset}
                                                            isSelected={isSelected}
                                                            isActive={isActive}
                                                            isFavorite={isFavorite}
                                                            onCommit={() => commit(row)}
                                                            onHover={() => setIndex(offset)}
                                                            onToggleFavorite={(e) => {
                                                                e.stopPropagation();
                                                                toggleFavorite(row.provider, row.id);
                                                            }}
                                                        />
                                                    );
                                                })}
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}

function Row({
    row,
    index,
    isSelected,
    isActive,
    isFavorite,
    onCommit,
    onHover,
    onToggleFavorite,
}: {
    row: RowEntry;
    index: number;
    isSelected: boolean;
    isActive: boolean;
    isFavorite: boolean;
    onCommit: () => void;
    onHover: () => void;
    onToggleFavorite: (e: React.MouseEvent) => void;
}) {
    const meta = providerMeta(row.provider);
    return (
        <button
            type="button"
            role="option"
            data-index={index}
            aria-selected={isSelected}
            onClick={onCommit}
            onMouseEnter={onHover}
            className={cn(
                "group relative w-full max-w-full cursor-pointer rounded-md px-2 py-2 text-left transition-[background-color,color]",
                isActive
                    ? "bg-[color-mix(in_srgb,var(--popover)_90%,var(--foreground))]"
                    : cn("hover:bg-[color-mix(in_srgb,var(--popover)_90%,var(--foreground))]", isSelected && "bg-foreground/[0.08]"),
            )}
        >
            <div className="min-w-0 flex-1 text-left">
                <span className="min-w-0 truncate text-xs font-medium leading-snug">{row.displayName}</span>
                <div className="mt-1 flex items-center gap-1.5">
                    <ProviderBrandIcon provider={row.provider} className="size-3" />
                    <span className="truncate text-xs leading-snug text-muted-foreground/70">
                        {meta.label} · {row.provider}
                    </span>
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
                <span className="rounded-sm px-1.5 text-[10px] leading-4 text-muted-foreground/70 group-hover:text-muted-foreground">
                    Ctrl+{index + 1}
                </span>
                <button
                    type="button"
                    aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                    onClick={onToggleFavorite}
                    className={cn(
                        "-mr-1 shrink-0 text-muted-foreground/70 transition-[color,opacity] hover:text-foreground",
                        isFavorite ? "text-yellow-500 opacity-100" : "opacity-60 group-hover:opacity-100",
                    )}
                >
                    <Star
                        weight={isFavorite ? "fill" : "regular"}
                        className="size-3"
                    />
                </button>
            </div>
        </button>
    );
}
