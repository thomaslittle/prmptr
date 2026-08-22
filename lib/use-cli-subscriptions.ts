"use client";

import { useQuery } from "@tanstack/react-query";
import { CliSubscriptionStatus } from "./cli-providers";

/**
 * Polls the loopback detection route for installed + logged-in AI CLIs.
 * Returns an empty list while loading or when nothing is detected, so
 * callers can spread the result straight into their provider lists.
 */
export function useCliSubscriptions() {
    return useQuery({
        queryKey: ["cli-subscriptions"],
        queryFn: async (): Promise<CliSubscriptionStatus[]> => {
            try {
                const resp = await fetch("/api/cli-providers");
                if (!resp.ok) return [];
                const data = (await resp.json()) as { subscriptions?: CliSubscriptionStatus[] };
                return Array.isArray(data.subscriptions) ? data.subscriptions : [];
            } catch {
                return [];
            }
        },
        staleTime: 60_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
    });
}

/** Detected, logged-in subscriptions the user hasn't opted out of. */
export function activeCliSubscriptions(
    statuses: CliSubscriptionStatus[] | undefined,
    optOuts: Partial<Record<CliSubscriptionStatus["id"], boolean>> | undefined
): CliSubscriptionStatus[] {
    return (statuses ?? []).filter(
        (sub) => sub.detected && sub.loggedIn && optOuts?.[sub.id] !== false
    );
}
