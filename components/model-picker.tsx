"use client";

import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { MagnifyingGlass, Star, CaretDown, CaretRight, AppWindow, CircleNotch } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import type { LLMProvider, LocalAiRoute } from "@/lib/types";
import { ClaudeAI, OpenAI, OpenCodeIcon, LMStudioIcon, GrokIcon, CursorIcon } from "@/components/provider-icons";
import { modelDisplayName, modelVersionInfo, compareModelVersions } from "@/lib/model-display";

export interface PickableModel {
    id: string;
    name: string;
    provider: LLMProvider;
    /** Display group within the provider (for "local-ai": the AI app name). */
    group?: string;
    /** OriginLM route for "local-ai" models. */
    localAi?: LocalAiRoute;
}

type ProviderIconComponent = React.ComponentType<{ className?: string }>;

interface ModelPickerProps {
    models: PickableModel[];
    value?: string;
    providerValue?: LLMProvider;
    /** OriginLM route id of the current "local-ai" selection. */
    routeValue?: string;
    onSelect: (model: PickableModel) => void;
    /** Called whenever the picker opens (used to lazily scan Your AI apps). */
    onOpen?: () => void;
    /** Your AI apps scan in flight: show the rail with a scanning message. */
    localAiScanning?: boolean;
    className?: string;
}

interface RowEntry {
    id: string;
    provider: LLMProvider;
    displayName: string;
    group?: string;
    routeId?: string;
    nativeId?: string;
    isLegacy: boolean;
    version: { major: number; minor: number } | null;
}

const PROVIDER_META: Partial<Record<LLMProvider, { label: string; monogram: string; icon?: ProviderIconComponent }>> = {
    lmstudio: { label: "LM Studio", monogram: "LM", icon: LMStudioIcon },
    zen: { label: "OpenCode Zen", monogram: "Z", icon: OpenCodeIcon },
    "local-ai": { label: "Your AI apps", monogram: "AI", icon: YourAiAppsIcon },
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

function YourAiAppsIcon({ className }: { className?: string }) {
    return <AppWindow weight="duotone" className={className} />;
}

/** Brand icon for an AI app reported by OriginLM (matched on its display name). */
function appIcon(appName: string | undefined, className: string): React.ReactElement | null {
    const name = (appName ?? "").toLowerCase();
    if (name.includes("claude")) return <ClaudeAI className={className} />;
    if (name.includes("codex") || name.includes("chatgpt") || name.includes("openai")) return <OpenAI className={className} />;
    if (name.includes("opencode")) return <OpenCodeIcon className={className} />;
    if (name.includes("lm studio") || name.includes("lmstudio")) return <LMStudioIcon className={className} />;
    if (name.includes("grok")) return <GrokIcon className={className} />;
    if (name.includes("cursor")) return <CursorIcon className={className} />;
    return null;
}

type GroupKey = LLMProvider;

function groupMeta(group: GroupKey) {
    return providerMeta(group);
}

/** Identity of one pickable row; local-ai ids are only unique per route. */
function rowKey(provider: LLMProvider, id: string, routeId?: string): string {
    return provider === "local-ai" ? `${provider}:${routeId ?? ""}:${id}` : `${provider}:${id}`;
}

function ProviderBrandIcon({ provider, app, className }: { provider: LLMProvider; app?: string; className?: string }) {
    const meta = providerMeta(provider);
    const appEl = provider === "local-ai" ? appIcon(app, cn("shrink-0", className)) : null;
    if (appEl) return appEl;
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

function ProviderRailIcon({ group, active, onClick }: { group: GroupKey; active: boolean; onClick: () => void }) {
    const meta = groupMeta(group);
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
            {meta.icon ? (
                <span className="flex size-5 items-center justify-center">
                    <meta.icon className="size-5" />
                </span>
            ) : (
                <span className="text-[9px] font-bold uppercase text-foreground/60">{meta.monogram}</span>
            )}
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

export function ModelPicker({
    models,
    value,
    providerValue,
    routeValue,
    onSelect,
    onOpen,
    localAiScanning = false,
    className,
}: ModelPickerProps) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [activeProvider, setActiveProvider] = useState<GroupKey | "favorites">("favorites");
    const [index, setIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const [favorites, setFavorites] = useState<Set<FavoriteKey>>(loadFavorites);

    const favoriteKey = useCallback((row: RowEntry) => rowKey(row.provider, row.id, row.routeId), []);

    const toggleFavorite = useCallback(
        (row: RowEntry) => {
            setFavorites((prev) => {
                const next = new Set(prev);
                const key = favoriteKey(row);
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
        const seen: GroupKey[] = [];
        for (const m of models) {
            if (!seen.includes(m.provider)) seen.push(m.provider);
        }
        // Keep the Your AI apps rail visible while its first scan runs.
        if (localAiScanning && !seen.includes("local-ai")) seen.push("local-ai");
        return seen;
    }, [models, localAiScanning]);

    const grouped = useMemo(() => {
        const map: Partial<Record<GroupKey, PickableModel[]>> = {};
        for (const m of models) {
            (map[m.provider] ??= []).push(m);
        }
        return map;
    }, [models]);

    // Build current + legacy model rows for the active group (or all
    // favorites). Rows carry version info so we can sort newest-first and
    // collapse older models under a "Legacy models" section, like t3chat.
    const entriesForProvider = useCallback(
        (group: GroupKey): RowEntry[] => {
            const list = grouped[group] ?? [];
            const ids = list.map((x) => x.id);
            // Defensive dedupe; `availableModels` already dedupes upstream.
            const seen = new Set<string>();
            const rows: RowEntry[] = [];
            for (const m of list) {
                const key = rowKey(m.provider, m.id, m.localAi?.routeId);
                if (seen.has(key)) continue;
                seen.add(key);
                // OriginLM ids are opaque and span many apps: no version
                // heuristics, keep the backend's per-app order.
                const v =
                    m.provider === "local-ai"
                        ? { version: null, isLegacy: false }
                        : modelVersionInfo(m.id, m.provider, ids);
                rows.push({
                    id: m.id,
                    provider: m.provider,
                    displayName: m.name || modelDisplayName(m.id, m.provider),
                    group: m.group,
                    routeId: m.localAi?.routeId,
                    nativeId: m.localAi?.nativeId,
                    isLegacy: v.isLegacy,
                    version: v.version,
                });
            }
            return rows;
        },
        [grouped]
    );

    // Ordered "current models" (newest first) for the active source.
    const currentRows = useMemo(() => {
        let rows: RowEntry[] = [];
        if (activeProvider === "favorites") {
            for (const p of providerOrder) {
                for (const row of entriesForProvider(p)) {
                    if (favorites.has(favoriteKey(row))) rows.push(row);
                }
            }
        } else {
            rows = entriesForProvider(activeProvider);
        }
        rows = rows.filter((r) => !r.isLegacy);
        // Your AI apps rows stay grouped by app in backend order.
        if (activeProvider === "local-ai") return rows;
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
                (r.group?.toLowerCase().includes(q) ?? false) ||
                (r.nativeId?.toLowerCase().includes(q) ?? false) ||
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

    const matchesCurrent = useCallback(
        (row: RowEntry) =>
            row.id === value &&
            row.provider === providerValue &&
            (row.provider !== "local-ai" || row.routeId === routeValue),
        [value, providerValue, routeValue]
    );

    const selectedIndex = useMemo(() => {
        if (!value) return -1;
        return visibleRows.findIndex((e) => matchesCurrent(e));
    }, [visibleRows, matchesCurrent, value]);

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
                onOpen?.();
                const initial =
                    (providerValue && (providerOrder.includes(providerValue) || providerValue === "local-ai")
                        ? providerValue
                        : undefined) ?? (favorites.size > 0 ? "favorites" : providerOrder[0]);
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
        [favorites.size, providerValue, providerOrder, reset, onOpen]
    );

    const commit = useCallback(
        (entry: RowEntry) => {
            const candidates = grouped[entry.provider] ?? [];
            const model = candidates.find(
                (m) => rowKey(m.provider, m.id, m.localAi?.routeId) === rowKey(entry.provider, entry.id, entry.routeId)
            );
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

    const currentModel = value
        ? models.find(
              (m) =>
                  m.id === value &&
                  m.provider === providerValue &&
                  (m.provider !== "local-ai" || m.localAi?.routeId === routeValue)
          ) ?? (providerValue === "local-ai" ? undefined : models.find((m) => m.id === value && m.provider !== "local-ai"))
        : undefined;
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
                                <ProviderBrandIcon provider={currentModel.provider} app={currentModel.group} className="size-4" />
                                <span className="truncate flex-1 text-left">{currentDisplayName}</span>
                            </>
                        ) : (
                            <span className="flex-1 truncate text-left text-muted-foreground">Select a model</span>
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
                                {providerOrder.map((g) => (
                                    <div key={g} className="relative w-full">
                                        <ProviderRailIcon
                                            group={g}
                                            active={activeProvider === g}
                                            onClick={() => {
                                                setActiveProvider(g);
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
                                activeProvider === "local-ai" && localAiScanning ? (
                                    <p className="flex items-center gap-2 px-3 py-6 text-xs text-muted-foreground/60">
                                        <CircleNotch className="size-3.5 animate-spin" aria-hidden />
                                        Looking for your AI apps…
                                    </p>
                                ) : (
                                    <p className="px-3 py-6 text-xs text-muted-foreground/60">
                                        {activeProvider === "favorites"
                                            ? "No favorites yet."
                                            : activeProvider === "local-ai"
                                              ? "No signed-in AI apps found. Scan again from Settings → Providers."
                                              : "No models found."}
                                    </p>
                                )
                            ) : (
                                <>
                                    {visibleCurrent.map((row, i) => {
                                        const isSelected = matchesCurrent(row);
                                        const isActive = activeIndex === i;
                                        const isFavorite = favorites.has(favoriteKey(row));
                                        const prev = visibleCurrent[i - 1];
                                        const showAppHeader =
                                            activeProvider === "local-ai" && (!prev || prev.group !== row.group);
                                        return (
                                            <div key={favoriteKey(row)} role="presentation">
                                            {showAppHeader && (
                                                <div
                                                    role="presentation"
                                                    className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70"
                                                >
                                                    <ProviderBrandIcon provider="local-ai" app={row.group} className="size-3" />
                                                    {row.group || "Other"}
                                                </div>
                                            )}
                                            <Row
                                                row={row}
                                                index={i}
                                                isSelected={isSelected}
                                                isActive={isActive}
                                                isFavorite={isFavorite}
                                                onCommit={() => commit(row)}
                                                onHover={() => setIndex(i)}
                                                onToggleFavorite={(e) => {
                                                    e.stopPropagation();
                                                    toggleFavorite(row);
                                                }}
                                            />
                                            </div>
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
                                                    const isSelected = matchesCurrent(row);
                                                    const isActive = activeIndex === offset;
                                                    const isFavorite = favorites.has(favoriteKey(row));
                                                    return (
                                                        <Row
                                                            key={favoriteKey(row)}
                                                            row={row}
                                                            index={offset}
                                                            isSelected={isSelected}
                                                            isActive={isActive}
                                                            isFavorite={isFavorite}
                                                            onCommit={() => commit(row)}
                                                            onHover={() => setIndex(offset)}
                                                            onToggleFavorite={(e) => {
                                                                e.stopPropagation();
                                                                toggleFavorite(row);
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
                    <ProviderBrandIcon provider={row.provider} app={row.group} className="size-3" />
                    <span className="truncate text-xs leading-snug text-muted-foreground/70">
                        {row.provider === "local-ai"
                            ? [row.group || meta.label, row.nativeId].filter(Boolean).join(" · ")
                            : `${meta.label} · ${row.provider}`}
                    </span>
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
                <span className="rounded-sm px-1.5 text-[10px] leading-4 text-muted-foreground/70 group-hover:text-muted-foreground">
                    Ctrl+{index + 1}
                </span>
                <span
                    role="button"
                    tabIndex={-1}
                    aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
                    onClick={onToggleFavorite}
                    className={cn(
                        "-mr-1 shrink-0 cursor-pointer text-muted-foreground/70 transition-[color,opacity] hover:text-foreground",
                        isFavorite ? "text-yellow-500 opacity-100" : "opacity-60 group-hover:opacity-100",
                    )}
                >
                    <Star
                        weight={isFavorite ? "fill" : "regular"}
                        className="size-3"
                    />
                </span>
            </div>
        </button>
    );
}
