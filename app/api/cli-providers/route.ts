import { NextRequest } from "next/server";
import { rejectUntrustedRequest } from "@/lib/api-guard";
import { detectCliSubscriptions } from "@/lib/cli-providers-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/cli-providers
 *
 * Reports which local AI coding CLIs (Claude Code, Codex, OpenCode) are
 * installed and logged in, plus the account identifier for each. Loopback-only:
 * the response contains account emails, so it must never be reachable from
 * other origins.
 */
export async function GET(request: NextRequest) {
    const untrusted = rejectUntrustedRequest(request);
    if (untrusted) return untrusted;

    try {
        const subscriptions = await detectCliSubscriptions();
        return new Response(JSON.stringify({ subscriptions }), {
            status: 200,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
    } catch {
        return new Response(JSON.stringify({ subscriptions: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }
}
