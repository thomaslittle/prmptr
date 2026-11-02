"use client";

import { useQuery } from "@tanstack/react-query";
import { localAiToProviderModel, type ProviderModel } from "./provider-models";
import { listLocalAiModels } from "./tauri";

export const LOCAL_AI_MODELS_QUERY_KEY = ["local-ai-models"] as const;

/**
 * Models from the AI apps the user already has signed in, via OriginLM.
 *
 * Scanning spawns metadata probes, so it never runs on app start: pass
 * `enabled` once the user opens the model picker / settings (or already has a
 * local-ai model selected). Cached data is returned even while disabled, so a
 * scan from Settings also feeds the picker.
 */
export function useLocalAiModels(enabled: boolean) {
    return useQuery({
        queryKey: LOCAL_AI_MODELS_QUERY_KEY,
        queryFn: async (): Promise<ProviderModel[]> => (await listLocalAiModels()).map(localAiToProviderModel),
        enabled,
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
        retry: false,
        refetchOnWindowFocus: false,
    });
}

/** Group models by AI app (OriginLM `providerName`), preserving backend order. */
export function groupLocalAiModels(models: ProviderModel[]): Array<{ group: string; models: ProviderModel[] }> {
    const out: Array<{ group: string; models: ProviderModel[] }> = [];
    for (const m of models) {
        const group = m.group || "Other";
        let bucket = out.find((g) => g.group === group);
        if (!bucket) {
            bucket = { group, models: [] };
            out.push(bucket);
        }
        bucket.models.push(m);
    }
    return out;
}
