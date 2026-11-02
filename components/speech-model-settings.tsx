"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, CircleNotch, DownloadSimple, Lightning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
    downloadSttModel,
    getLocalTranscriptionGpuStatus,
    isTauri,
    listSttModels,
    onSttModelDownloadProgress,
    setSelectedSttModel,
    type SttModelDownloadProgress,
    type SttModelInfo,
} from "@/lib/tauri";
import { glossaryTerms, MAX_GLOSSARY_TERMS } from "@/lib/glossary";

interface SpeechModelSettingsProps {
    preferGpu: boolean;
    onPreferGpuChange: (value: boolean) => void;
    glossary: string;
    onGlossaryChange: (value: string) => void;
}

function formatSize(mb: number): string {
    return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`;
}

/**
 * On-device speech model picker. Models are GGUF files run by transcribe.cpp
 * and downloaded on demand (pinned + SHA-256 verified by the Rust backend).
 */
export function SpeechModelSettings({ preferGpu, onPreferGpuChange, glossary, onGlossaryChange }: SpeechModelSettingsProps) {
    const queryClient = useQueryClient();
    const [progress, setProgress] = useState<Record<string, SttModelDownloadProgress>>({});
    const [errors, setErrors] = useState<Record<string, string>>({});

    const modelsQuery = useQuery({
        queryKey: ["stt-models"],
        queryFn: listSttModels,
        enabled: isTauri(),
        staleTime: 30_000,
    });
    const gpuQuery = useQuery({
        queryKey: ["stt-gpu-status"],
        queryFn: getLocalTranscriptionGpuStatus,
        enabled: isTauri(),
        staleTime: 5 * 60_000,
    });

    useEffect(() => {
        let unlisten: (() => void) | undefined;
        let alive = true;
        onSttModelDownloadProgress((p) => {
            setProgress((prev) => ({ ...prev, [p.model_id]: p }));
        }).then((fn) => {
            if (alive) unlisten = fn;
            else fn();
        });
        return () => {
            alive = false;
            unlisten?.();
        };
    }, []);

    const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ["stt-models"] }), [queryClient]);

    const download = useCallback(
        async (model: SttModelInfo) => {
            setErrors((prev) => ({ ...prev, [model.id]: "" }));
            setProgress((prev) => ({
                ...prev,
                [model.id]: { model_id: model.id, stage: "Starting download…", percent: 0, downloaded_bytes: 0 },
            }));
            try {
                await downloadSttModel(model.id);
            } catch (err) {
                setErrors((prev) => ({ ...prev, [model.id]: err instanceof Error ? err.message : String(err) }));
            } finally {
                setProgress((prev) => {
                    const next = { ...prev };
                    delete next[model.id];
                    return next;
                });
                await refresh();
            }
        },
        [refresh]
    );

    const select = useCallback(
        async (model: SttModelInfo) => {
            await setSelectedSttModel(model.id);
            await refresh();
        },
        [refresh]
    );

    if (!isTauri()) {
        return (
            <p className="text-[10px] text-muted-foreground/70" data-testid="stt-desktop-only">
                Speech models are managed by the PRMPTR desktop app.
            </p>
        );
    }

    const models = modelsQuery.data ?? [];
    const gpu = gpuQuery.data;
    const selected = models.find((m) => m.selected);
    const needsDownload = selected && !selected.installed;

    return (
        <div className="space-y-2" data-testid="stt-model-settings">
            <div>
                <span className="text-[10px] text-foreground/60 font-medium mb-1 block">Speech model</span>
                {modelsQuery.isLoading ? (
                    <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <CircleNotch className="size-3 animate-spin" /> Loading models…
                    </p>
                ) : (
                    <ul className="space-y-1" role="radiogroup" aria-label="Speech model">
                        {models.map((model) => {
                            const p = progress[model.id];
                            const error = errors[model.id];
                            return (
                                <li
                                    key={model.id}
                                    data-testid={`stt-model-${model.id}`}
                                    className={`rounded-sm border p-2 transition-colors ${
                                        model.selected ? "border-primary/60 bg-primary/5" : "border-border bg-background/40"
                                    }`}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <button
                                            type="button"
                                            role="radio"
                                            aria-checked={model.selected}
                                            disabled={!model.installed}
                                            onClick={() => select(model)}
                                            className="min-w-0 flex-1 text-left disabled:cursor-default"
                                        >
                                            <span className="flex items-center gap-1.5 text-[11px] font-medium text-foreground/85">
                                                {model.name}
                                                {model.recommended && (
                                                    <span className="rounded-sm bg-primary/15 px-1 py-px text-[8px] uppercase tracking-wide text-primary">
                                                        Recommended
                                                    </span>
                                                )}
                                                {model.selected && model.installed && (
                                                    <CheckCircle weight="fill" className="size-3 text-primary" aria-label="Active" />
                                                )}
                                            </span>
                                            <span className="block text-[9px] text-muted-foreground/70">
                                                {model.description} · {model.languages} · {formatSize(model.size_mb)}
                                            </span>
                                        </button>
                                        {!model.installed && (
                                            <Button
                                                size="xs"
                                                variant={model.selected || model.recommended ? "default" : "outline"}
                                                disabled={!!p}
                                                onClick={() => download(model)}
                                                aria-label={`Download ${model.name}`}
                                            >
                                                {p ? (
                                                    <>
                                                        <CircleNotch className="size-3 animate-spin" />
                                                        {p.percent > 0 ? `${p.percent}%` : "…"}
                                                    </>
                                                ) : (
                                                    <>
                                                        <DownloadSimple className="size-3" /> Download
                                                    </>
                                                )}
                                            </Button>
                                        )}
                                    </div>
                                    {p && (
                                        <div className="mt-1.5" aria-live="polite">
                                            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                                                <div
                                                    className="h-full bg-primary transition-[width]"
                                                    style={{ width: `${Math.min(100, p.percent)}%` }}
                                                />
                                            </div>
                                            <p className="mt-0.5 text-[9px] text-muted-foreground/70">{p.stage}</p>
                                        </div>
                                    )}
                                    {error && <p className="mt-1 text-[9px] text-destructive">{error}</p>}
                                </li>
                            );
                        })}
                    </ul>
                )}
                {needsDownload && (
                    <p className="mt-1 text-[9px] text-amber-400/90" data-testid="stt-needs-download">
                        Download {selected.name} to start local transcription.
                    </p>
                )}
            </div>

            <div className="rounded-sm border border-border bg-background/40 p-2">
                <label htmlFor="stt-glossary" className="flex items-center justify-between text-[10px] font-medium text-foreground/70">
                    <span>Glossary — names &amp; terms</span>
                    <span className="font-normal text-muted-foreground/60">{glossaryTerms(glossary).length}/{MAX_GLOSSARY_TERMS}</span>
                </label>
                <textarea
                    id="stt-glossary"
                    value={glossary}
                    onChange={(e) => onGlossaryChange(e.target.value)}
                    rows={4}
                    spellCheck={false}
                    placeholder={"Saoirse = Sayers, Sersha\nKubeflow\nQdrant = Drant"}
                    aria-describedby="stt-glossary-help"
                    className="mt-1 w-full resize-y rounded-sm border border-border bg-background/60 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground placeholder:text-muted-foreground/40 focus-visible:outline-2 focus-visible:outline-ring"
                />
                <p id="stt-glossary-help" className="mt-1 text-[9px] leading-relaxed text-muted-foreground/70">
                    One per line. Add what it&apos;s misheard as after <code>=</code> to always correct it. Applies the next time you press
                    Start, and to suggestions right away.
                </p>
            </div>

            <div className="rounded-sm border border-border bg-background/40 p-2">
                <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                        <span className="flex items-center gap-1 text-[10px] text-foreground/70">
                            <Lightning className="size-3" /> GPU acceleration
                        </span>
                        <p className="text-[9px] text-muted-foreground/60" data-testid="stt-gpu-message">
                            {gpu?.message ?? "Checking compute devices…"}
                        </p>
                    </div>
                    <Button
                        size="xs"
                        variant={preferGpu && gpu?.can_use_gpu ? "default" : "outline"}
                        disabled={!gpu?.can_use_gpu}
                        onClick={() => onPreferGpuChange(!preferGpu)}
                        aria-pressed={preferGpu && !!gpu?.can_use_gpu}
                    >
                        {preferGpu && gpu?.can_use_gpu ? "On" : "Off"}
                    </Button>
                </div>
            </div>
        </div>
    );
}
