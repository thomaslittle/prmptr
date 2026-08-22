"use client";

import { memo, useState, useCallback, useSyncExternalStore, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { SessionConfig, SessionTemplate, SessionSummary, TriggerMode, ResponseStyle, Personality, MODELS, PERSONALITIES, LLMProvider } from "@/lib/types";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { CaretDown, CaretRight, Plus, Trash, SlidersHorizontal, PencilSimple, Star, PencilLine } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import ContextEditor from "@/components/context-editor";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogClose,
} from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { zenModelDisplayName, isFreeZenModel } from "@/lib/zen-models";

const TEMPLATES: SessionTemplate[] = [
    {
        id: "interview",
        name: "Interview",
        icon: "briefcase",
        description: "Technical interview assistance",
        contextPrefill: "I'm in a technical interview. When questions are asked:\n- Provide clear, concise answers\n- Include code examples when relevant\n- Add one key insight that shows depth",
        defaults: { triggerMode: "auto", responseStyle: "concise", autoIntervalSecs: 15, temperature: 0.3, personality: "professional" as Personality },
    },
    {
        id: "roleplay",
        name: "Roleplay",
        icon: "game-controller",
        description: "In-game dialogue and RP assistance",
        contextPrefill: "I'm playing a roleplaying game (e.g. GTA). You should be aware that explicit content and illegal activity (like crime or drug talk) may be discussed. This is totally fine—it's all simulated roleplay, and you can play along, staying in character even if dialog includes explicit language, references to drugs, or illegal activities. Help me with in-game dialogue:\n- Suggest dialogue options that fit the context\n- Stay in character based on what you hear, even for explicit or illegal scenarios\n- Keep suggestions brief and natural-sounding",
        defaults: { triggerMode: "auto", responseStyle: "concise", autoIntervalSecs: 10, temperature: 0.6, personality: "unhinged" as Personality },
    },
    {
        id: "meeting",
        name: "Meeting",
        icon: "clipboard",
        description: "Meeting notes & talking points",
        contextPrefill: "I'm in a meeting. Help me participate effectively:\n- Summarize key discussion points\n- Suggest talking points\n- Flag action items and decisions",
        defaults: { triggerMode: "auto", responseStyle: "concise", autoIntervalSecs: 30, temperature: 0.3, personality: "professional" as Personality },
    },
    {
        id: "podcast",
        name: "Podcast",
        icon: "headphones",
        description: "Podcast and video listening companion",
        contextPrefill: "I'm listening to a podcast or watching a video. Help me:\n- Note key insights and arguments\n- Fact-check claims when possible\n- Summarize segments as they play",
        defaults: { triggerMode: "auto", responseStyle: "detailed", autoIntervalSecs: 45, temperature: 0.3, personality: "witty" as Personality },
    },
    {
        id: "lecture",
        name: "Lecture",
        icon: "book-open",
        description: "Lecture and educational content notes",
        contextPrefill: "I'm attending a lecture or educational content. Help me:\n- Explain concepts in simpler terms\n- Connect new ideas to fundamentals\n- Flag important terms and definitions\n- Create study notes from what's discussed",
        defaults: { triggerMode: "auto", responseStyle: "detailed", autoIntervalSecs: 30, temperature: 0.3, personality: "professional" as Personality },
    },
    {
        id: "general",
        name: "General",
        icon: "chat-circle",
        description: "General-purpose assistant",
        contextPrefill: "Watch my screen and audio. Help me with whatever seems most relevant based on what I'm doing.",
        defaults: { triggerMode: "manual", responseStyle: "concise", autoIntervalSecs: 30, temperature: 0.5, personality: "witty" as Personality },
    },
];

interface SessionConfigPanelProps {
    config: SessionConfig;
    onChange: (config: SessionConfig) => void;
    configuredProviders: LLMProvider[];
    sessions?: SessionSummary[];
    currentSessionId?: string | null;
    onSwitchSession?: (id: string) => void;
    onNewSession?: () => void;
    onDeleteSession?: (id: string) => void;
    onRenameSession?: (id: string, title: string) => void;
    onStarSession?: (id: string, starred: boolean) => void;
    onCollapse?: () => void;
}

export default memo(function SessionConfigPanel({
    config,
    onChange,
    configuredProviders,
    sessions = [],
    currentSessionId,
    onSwitchSession,
    onNewSession,
    onDeleteSession,
    onRenameSession,
    onStarSession,
    onCollapse,
}: SessionConfigPanelProps) {
    const { settings } = useSettingsStore();
    const aiVoiceReplyEnabled = !!settings.voiceReplyEnabled;
    const mounted = useSyncExternalStore(
        () => () => {},
        () => true,
        () => false
    );
    const [contextEditorOpen, setContextEditorOpen] = useState(false);
    const [contextDraft, setContextDraft] = useState("");
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [sessionToDelete, setSessionToDelete] = useState<string | null>(null);
    const requestDeleteSession = useCallback((id: string) => {
        setSessionToDelete(id);
        setDeleteConfirmOpen(true);
    }, []);

    const confirmDeleteSession = useCallback(() => {
        if (sessionToDelete) {
            onDeleteSession?.(sessionToDelete);
            setSessionToDelete(null);
        }
        setDeleteConfirmOpen(false);
    }, [sessionToDelete, onDeleteSession]);

    const openContextEditor = useCallback(() => {
        setContextDraft(config.context);
        setContextEditorOpen(true);
    }, [config.context]);

    const saveContext = useCallback(() => {
        onChange({ ...config, context: contextDraft });
        setContextEditorOpen(false);
    }, [config, contextDraft, onChange]);

    const commitRename = useCallback(() => {
        if (renamingId && renameValue.trim()) {
            onRenameSession?.(renamingId, renameValue.trim());
        }
        setRenamingId(null);
    }, [renamingId, renameValue, onRenameSession]);

    const providersToFetch = useMemo(
        () => Array.from(new Set<LLMProvider>(["lmstudio", ...configuredProviders])),
        [configuredProviders]
    );

    const providerModelsQuery = useQuery({
        queryKey: [
            "provider-models",
            providersToFetch.join("|"),
            settings.apiKeys.anthropic || "",
            settings.apiKeys.openai || "",
            settings.apiKeys.groq || "",
            settings.apiKeys.cerebras || "",
            settings.apiKeys.zen || "",
            settings.lmstudioUrl || "",
        ],
        queryFn: async () => {
            const entries = await Promise.all(
                providersToFetch.map(async (provider) => {
                    const body: { provider: LLMProvider; apiKey?: string; baseUrl?: string } = { provider };
                    if (provider !== "lmstudio") {
                        const key = settings.apiKeys[provider as Exclude<LLMProvider, "lmstudio">];
                        if (!key) return [provider, []] as const;
                        body.apiKey = key;
                    } else {
                        body.baseUrl = settings.lmstudioUrl;
                    }

                    try {
                        const resp = await fetch("/api/provider-models", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(body),
                        });
                        if (!resp.ok) return [provider, []] as const;
                        const data = (await resp.json()) as { models?: Array<string | { id?: string }> };
                        const ids = Array.isArray(data.models)
                            ? data.models
                                .map((entry) => {
                                    if (typeof entry === "string") return entry;
                                    return typeof entry?.id === "string" ? entry.id : "";
                                })
                                .filter((id): id is string => !!id)
                            : [];
                        return [provider, ids] as const;
                    } catch {
                        return [provider, []] as const;
                    }
                })
            );
            const out: Partial<Record<LLMProvider, string[]>> = {};
            for (const [provider, ids] of entries) {
                out[provider] = [...ids];
            }
            return out;
        },
        staleTime: 60_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
    });
    const providerModels = providerModelsQuery.data ?? {};

    const availableModels = useMemo(() => {
        const providers = Array.from(new Set<LLMProvider>(["lmstudio", ...configuredProviders]));
        const seen = new Set<string>();
        const merged: typeof MODELS = [];

        // Remote models first (live from each provider that answered)
        for (const provider of providers) {
            for (const id of providerModels[provider] ?? []) {
                const key = `${provider}:${id}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const isZen = provider === "zen";
                const name = isZen ? zenModelDisplayName(id) : id;
                const free = isZen && isFreeZenModel(id);
                merged.push({
                    id,
                    name: free ? `${name} · free` : name,
                    provider,
                    speed: "fast",
                    description: "Fetched from provider",
                    maxTokens: 4096,
                });
            }
        }

        // Static catalog entries for providers that returned nothing
        // (e.g. LM Studio not running, or a fetch failure) so their
        // defaults don't vanish from the dropdown.
        for (const m of MODELS) {
            if (!providers.includes(m.provider)) continue;
            const key = `${m.provider}:${m.id}`;
            if (!seen.has(key)) {
                seen.add(key);
                merged.push(m);
            }
        }
        return merged;
    }, [configuredProviders, providerModels]);

    const applyTemplate = (template: SessionTemplate) => {
        const roleplayAiVoiceEnabled = template.id === "roleplay" && !!settings.voiceReplyEnabled;
        onChange({
            ...config,
            context: template.contextPrefill,
            triggerMode: template.defaults.triggerMode,
            responseStyle: roleplayAiVoiceEnabled ? "ai-voice" : template.defaults.responseStyle,
            personality: template.defaults.personality ?? config.personality,
            autoIntervalSecs: template.defaults.autoIntervalSecs,
        });
    };

    const groupedModels = useMemo(() => {
        const groups = availableModels.reduce<Record<string, typeof availableModels>>((acc, model) => {
            const key = model.provider;
            if (!acc[key]) acc[key] = [];
            acc[key].push(model);
            return acc;
        }, {});
        // Free tier first, then alphabetical — keeps the 60+ model Zen list scannable
        if (groups.zen) {
            groups.zen.sort((a, b) => {
                const aFree = isFreeZenModel(a.id) ? 0 : 1;
                const bFree = isFreeZenModel(b.id) ? 0 : 1;
                if (aFree !== bFree) return aFree - bFree;
                return a.name.localeCompare(b.name);
            });
        }
        return groups;
    }, [availableModels]);

    const currentSession = sessions.find((s) => s.id === currentSessionId);
    const sessionTitle = currentSession?.title ?? "New Session";

    return (
        <div className="flex flex-col min-h-0 flex-1">
            {/* Section header with session dropdown */}
            <div className="flex items-center h-10 border-b border-border shrink-0">
                <div className="flex-1 min-w-0">
                {mounted ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            render={
                                <button className="flex items-center gap-2 px-4 h-full w-full text-xs font-medium text-foreground/80 hover:text-foreground transition-colors min-w-0">
                                    <SlidersHorizontal weight="bold" className="size-3.5 text-muted-foreground shrink-0" />
                                    {currentSession?.starred && (
                                        <Star weight="fill" className="size-2.5 text-yellow-400 shrink-0" />
                                    )}
                                    <span className="truncate flex-1 text-left">{sessionTitle}</span>
                                    <CaretDown weight="bold" className="size-2.5 shrink-0 text-muted-foreground" />
                                </button>
                            }
                        />
                        <DropdownMenuContent side="bottom" align="start" alignOffset={-2} sideOffset={6} className="w-[277px] ml-4">
                                <DropdownMenuItem
                                    onClick={() => onNewSession?.()}
                                    className="gap-2"
                                >
                                    <Plus weight="bold" className="size-3" />
                                    New Session
                                </DropdownMenuItem>
                                {sessions.length > 0 && <DropdownMenuSeparator />}
                                {sessions.map((session) => (
                                    <DropdownMenuItem
                                        key={session.id}
                                        className={cn(
                                            "flex items-center gap-2 pr-1.5",
                                            session.id === currentSessionId && "bg-accent"
                                        )}
                                        onClick={() => {
                                            if (renamingId !== session.id) {
                                                onSwitchSession?.(session.id);
                                            }
                                        }}
                                    >
                                        {/* Star */}
                                        <button
                                            aria-label={session.starred ? `Unstar ${session.title}` : `Star ${session.title}`}
                                            className={cn(
                                                "shrink-0 p-0.5 transition-colors",
                                                session.starred
                                                    ? "text-yellow-400 hover:text-yellow-300"
                                                    : "text-muted-foreground/30 hover:text-yellow-400"
                                            )}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onStarSession?.(session.id, !session.starred);
                                            }}
                                        >
                                            <Star weight={session.starred ? "fill" : "regular"} className="size-3" />
                                        </button>

                                        {/* Title — inline editable */}
                                        <div className="flex flex-col min-w-0 flex-1">
                                            {renamingId === session.id ? (
                                                <input
                                                    autoFocus
                                                    className="text-xs bg-transparent border-b border-primary/50 outline-none py-0 px-0 w-full text-foreground"
                                                    value={renameValue}
                                                    onChange={(e) => setRenameValue(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter") { e.preventDefault(); commitRename(); }
                                                        if (e.key === "Escape") setRenamingId(null);
                                                        e.stopPropagation();
                                                    }}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onBlur={commitRename}
                                                />
                                            ) : (
                                                <span className="truncate text-xs">{session.title}</span>
                                            )}
                                            <span className="text-[10px] text-muted-foreground">
                                                {session.responseCount} responses
                                                {" \u00b7 "}
                                                {new Date(session.updatedAt).toLocaleDateString([], { month: "short", day: "numeric" })}
                                            </span>
                                        </div>

                                        {/* Actions */}
                                        <button
                                            aria-label={`Rename ${session.title}`}
                                            className="shrink-0 p-0.5 text-muted-foreground/40 hover:text-foreground transition-colors"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setRenamingId(session.id);
                                                setRenameValue(session.title);
                                            }}
                                        >
                                            <PencilLine weight="bold" className="size-3" />
                                        </button>
                                        <button
                                            aria-label={`Delete ${session.title}`}
                                            className="shrink-0 p-0.5 text-muted-foreground/40 hover:text-destructive transition-colors"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                requestDeleteSession(session.id);
                                            }}
                                        >
                                            <Trash weight="bold" className="size-3" />
                                        </button>
                                    </DropdownMenuItem>
                                ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : (
                    <div className="flex items-center gap-2 px-4 min-w-0 w-full">
                        <SlidersHorizontal weight="bold" className="size-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs font-medium text-foreground/80">Session</span>
                    </div>
                )}
                </div>
                {onCollapse && (
                    <button
                        type="button"
                        onClick={onCollapse}
                        className="shrink-0 p-1 mr-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors cursor-pointer"
                        title="Collapse config"
                    >
                        <CaretRight weight="bold" className="size-3.5" />
                    </button>
                )}
            </div>

            {/* Delete session confirmation */}
            <AlertDialog
                open={deleteConfirmOpen}
                onOpenChange={(open) => {
                    setDeleteConfirmOpen(open);
                    if (!open) setSessionToDelete(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete session?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete &quot;{sessions.find((s) => s.id === sessionToDelete)?.title ?? "this session"}&quot; and all its responses. This cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            onClick={confirmDeleteSession}
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Scrollable config content */}
            <div className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-4">
                {/* Templates */}
                <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Quick Start</Label>
                    <div className="grid grid-cols-3 gap-1">
                        {TEMPLATES.map((template) => (
                            <button
                                key={template.id}
                                className={cn(
                                    "px-2 py-1.5 text-[10px] transition-colors border border-border text-center whitespace-nowrap",
                                    config.context === template.contextPrefill
                                        ? "bg-primary text-primary-foreground border-primary"
                                        : "hover:bg-muted text-foreground/70 hover:text-foreground"
                                )}
                                onClick={() => applyTemplate(template)}
                                title={template.description}
                            >
                                {template.name}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Context — clickable excerpt */}
                <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Context</Label>
                    <button
                        type="button"
                        onClick={openContextEditor}
                        className="w-full text-left border border-input hover:border-ring/50 bg-transparent px-2.5 py-2 transition-colors group cursor-pointer"
                    >
                        {config.context ? (
                            <p className="text-[11px] leading-relaxed text-foreground/70 line-clamp-3">
                                {config.context}
                            </p>
                        ) : (
                            <p className="text-[11px] text-muted-foreground/50 italic">
                                Describe what you&apos;re working on...
                            </p>
                        )}
                        <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground/40 group-hover:text-muted-foreground transition-colors">
                            <PencilSimple weight="bold" className="size-2.5" />
                            <span>Edit</span>
                        </div>
                    </button>

                    {/* Context editor dialog */}
                    <Dialog open={contextEditorOpen} onOpenChange={setContextEditorOpen}>
                        <DialogContent className="max-w-2xl">
                            <DialogHeader>
                                <DialogTitle>Edit Context</DialogTitle>
                                <DialogClose
                                    render={
                                        <button className="text-muted-foreground hover:text-foreground transition-colors">
                                            <span className="sr-only">Close</span>
                                            &times;
                                        </button>
                                    }
                                />
                            </DialogHeader>
                            <p className="text-[11px] text-muted-foreground px-4">
                                Use markdown to structure your context. This is sent as the system instruction to the AI.
                            </p>
                            <div className="border-t border-b border-border">
                                <ContextEditor
                                    markdown={contextDraft}
                                    onChange={setContextDraft}
                                />
                            </div>
                            <div className="flex justify-end gap-2 px-4 pb-4">
                                <Button
                                    variant="ghost"
                                    size="xs"
                                    onClick={() => setContextEditorOpen(false)}
                                >
                                    Cancel
                                </Button>
                                <Button size="xs" onClick={saveContext}>
                                    Save
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>

                {/* Model Selection */}
                <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Model</Label>
                    {!mounted ? (
                        <div className="flex h-7 w-full items-center border border-input bg-transparent px-2.5 text-xs text-muted-foreground">
                            Select a model
                        </div>
                    ) : availableModels.length > 0 ? (
                        <Select
                            value={config.model}
                            onValueChange={(value) => {
                                const model = availableModels.find(
                                    (m) => m.id === value
                                );
                                if (model) {
                                    onChange({
                                        ...config,
                                        model: model.id,
                                        provider: model.provider,
                                    });
                                }
                            }}
                        >
                            <SelectTrigger className="w-full h-7 text-xs">
                                <SelectValue placeholder="Select a model" />
                            </SelectTrigger>
                            <SelectContent>
                                {Object.entries(groupedModels).map(([provider, models]) => (
                                    <SelectGroup key={provider}>
                                        <SelectLabel>
                                            {provider === "lmstudio"
                                                ? "LM Studio"
                                                : provider === "zen"
                                                    ? "OpenCode Zen"
                                                    : provider.charAt(0).toUpperCase() + provider.slice(1)}
                                        </SelectLabel>
                                        {models.map((model) => (
                                            <SelectItem key={model.id} value={model.id}>
                                                {model.name}
                                                <span className="text-muted-foreground ml-1">({model.speed})</span>
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : (
                        <p className="text-[10px] text-muted-foreground/50">
                            Add an API key in Settings to select a model
                        </p>
                    )}
                </div>

                <Separator />

                {/* Trigger Mode */}
                <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Trigger</Label>
                    <div className="flex border border-border">
                        {(["manual", "auto", "smart"] as TriggerMode[]).map((mode) => (
                            <button
                                key={mode}
                                aria-label={`${mode} trigger mode`}
                                aria-pressed={config.triggerMode === mode}
                                className={cn(
                                    "flex-1 px-2 py-1.5 text-[10px] transition-colors uppercase tracking-wide",
                                    mode !== "manual" && "border-l border-border",
                                    config.triggerMode === mode
                                        ? "bg-primary text-primary-foreground"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                )}
                                onClick={() => onChange({ ...config, triggerMode: mode })}
                            >
                                {mode}
                            </button>
                        ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground/50">
                        {config.triggerMode === "manual" && `Press ${settings.shortcuts.analyze.label} to trigger`}
                        {config.triggerMode === "auto" && "Triggers on a timer interval"}
                        {config.triggerMode === "smart" && "AI decides when to chime in based on context"}
                    </p>
                </div>

                {/* Auto Interval */}
                {(config.triggerMode === "auto" || config.triggerMode === "smart") && (
                    <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            {config.triggerMode === "smart" ? "Check Interval" : "Interval"}
                        </Label>
                        <div className="flex items-center gap-3">
                            <input
                                type="range"
                                aria-label="Auto-trigger interval in seconds"
                                className="flex-1 accent-primary h-0.5"
                                min="10"
                                max="120"
                                step="5"
                                value={config.autoIntervalSecs}
                                onChange={(e) =>
                                    onChange({
                                        ...config,
                                        autoIntervalSecs: parseInt(e.target.value),
                                    })
                                }
                            />
                            <span className="text-[10px] text-muted-foreground tabular-nums w-8 text-right">
                                {config.autoIntervalSecs}s
                            </span>
                        </div>
                    </div>
                )}

                {/* Context Size */}
                <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Context Size</Label>
                    <div className="flex items-center gap-3">
                        <input
                            type="range"
                            aria-label="Context size in tokens"
                            className="flex-1 accent-primary h-0.5"
                            min="2000"
                            max="16000"
                            step="1000"
                            value={config.contextSize || 6000}
                            onChange={(e) =>
                                onChange({
                                    ...config,
                                    contextSize: parseInt(e.target.value),
                                })
                            }
                        />
                        <span className="text-[10px] text-muted-foreground tabular-nums w-8 text-right">
                            {((config.contextSize || 6000) / 1000).toFixed(0)}k
                        </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground/50">
                        {(config.contextSize || 6000) <= 3000
                            ? "Small — fast & cheap"
                            : (config.contextSize || 6000) <= 8000
                                ? "Medium — balanced"
                                : "Large — deep context"}
                    </p>
                </div>

                {/* Personality */}
                <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Personality</Label>
                    <div className="grid grid-cols-2 gap-1">
                        {PERSONALITIES.map((p) => (
                            <button
                                key={p.id}
                                aria-label={`${p.name} personality: ${p.description}`}
                                aria-pressed={config.personality === p.id}
                                className={cn(
                                    "px-2 py-1.5 text-[10px] transition-colors border border-border text-center whitespace-nowrap truncate",
                                    config.personality === p.id
                                        ? "bg-primary text-primary-foreground border-primary"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                )}
                                onClick={() => onChange({ ...config, personality: p.id })}
                                title={p.description}
                            >
                                {p.name}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Response Style */}
                <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Response Style</Label>
                    <div className="flex border border-border">
                        <button
                            className={cn(
                                "flex-1 px-3 py-1.5 text-[10px] transition-colors uppercase tracking-wide",
                                config.responseStyle === "concise"
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            )}
                            onClick={() =>
                                onChange({ ...config, responseStyle: "concise" as ResponseStyle })
                            }
                        >
                            Concise
                        </button>
                        <button
                            className={cn(
                                "flex-1 px-3 py-1.5 text-[10px] transition-colors border-l border-border uppercase tracking-wide",
                                config.responseStyle === "detailed"
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                            )}
                            onClick={() =>
                                onChange({ ...config, responseStyle: "detailed" as ResponseStyle })
                            }
                        >
                            Detailed
                        </button>
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <div className="flex-1">
                                        <button
                                            className={cn(
                                                "w-full px-3 py-1.5 text-[10px] transition-colors border-l border-border uppercase tracking-wide",
                                                !aiVoiceReplyEnabled && "opacity-50 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground",
                                                config.responseStyle === "ai-voice"
                                                    ? "bg-primary text-primary-foreground"
                                                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                            )}
                                            onClick={() =>
                                                aiVoiceReplyEnabled && onChange({ ...config, responseStyle: "ai-voice" as ResponseStyle })
                                            }
                                            disabled={!aiVoiceReplyEnabled}
                                        >
                                            AI Voice
                                        </button>
                                    </div>
                                }
                            />
                            {!aiVoiceReplyEnabled && (
                                <TooltipContent>
                                    Enable AI Voice Reply in TTS settings first
                                </TooltipContent>
                            )}
                        </Tooltip>
                    </div>
                    <p className="text-[10px] text-muted-foreground/50">
                        {!aiVoiceReplyEnabled
                            ? "Enable AI Voice Reply in TTS settings to use AI Voice style."
                            : config.responseStyle === "ai-voice"
                            ? "Single direct line to say in-game. No headers, no markdown."
                            : config.responseStyle === "concise"
                                ? "Short, skimmable response."
                                : "Expanded response with structure."}
                    </p>
                </div>
            </div>
        </div>
    );
});
