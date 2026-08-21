import { NextRequest } from "next/server";
import { localHttpBaseUrl, rejectUntrustedRequest } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

interface ScreenSource {
    id: string;
    label: string;
    appName?: string;
    windowName?: string;
}

function normalizeFrameToDataUrl(frame: string): string | null {
    const raw = frame.trim();
    if (!raw) return null;
    if (/^data:image\//i.test(raw)) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    // Best-effort: Screenpipe commonly returns base64 frame payloads when include_frames=true.
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(raw)) {
        const compact = raw.replace(/\s+/g, "");
        return `data:image/jpeg;base64,${compact}`;
    }
    return null;
}

function toText(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractSource(content: unknown): { appName?: string; windowName?: string } {
    const c = (content ?? {}) as Record<string, unknown>;
    return {
        appName: toText(c.app_name) ?? toText(c.appName),
        windowName: toText(c.window_name) ?? toText(c.windowName),
    };
}

export async function GET(request: NextRequest) {
    const untrusted = rejectUntrustedRequest(request);
    if (untrusted) return untrusted;

    const screenpipeUrl = request.nextUrl.searchParams.get("screenpipeUrl") || "http://localhost:3030";
    const base = localHttpBaseUrl(screenpipeUrl);
    if (!base) {
        return new Response(JSON.stringify({ ok: false, error: "Invalid screenpipeUrl" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }
    const mode = request.nextUrl.searchParams.get("mode") || "";
    const appNameFilter = request.nextUrl.searchParams.get("appName") || "";
    const windowNameFilter = request.nextUrl.searchParams.get("windowName") || "";

    try {
        if (mode === "sources") {
            const sourceSearch = new URLSearchParams({
                content_type: "ocr",
                limit: "120",
                include_frames: "false",
            });
            const sourceResp = await fetch(`${base}/search?${sourceSearch.toString()}`, { method: "GET", signal: AbortSignal.timeout(15_000) });
            if (!sourceResp.ok) {
                return new Response(JSON.stringify({ ok: false, error: `Screenpipe ${sourceResp.status}`, sources: [] }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                });
            }
            const sourceData = (await sourceResp.json()) as { data?: Array<{ content?: unknown }> };
            const seen = new Set<string>();
            const sources: ScreenSource[] = [];
            for (const item of sourceData?.data ?? []) {
                const { appName, windowName } = extractSource(item?.content);
                if (!appName && !windowName) continue;
                const id = `${appName || ""}|||${windowName || ""}`;
                if (seen.has(id)) continue;
                seen.add(id);
                const label = windowName ? `${windowName}${appName ? ` (${appName})` : ""}` : (appName as string);
                sources.push({
                    id,
                    label,
                    appName,
                    windowName,
                });
            }
            return new Response(JSON.stringify({ ok: true, sources }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }

        const search = new URLSearchParams({
            content_type: "ocr",
            limit: "20",
            include_frames: "true",
        });
        if (appNameFilter) search.set("app_name", appNameFilter);
        if (windowNameFilter) search.set("window_name", windowNameFilter);

        const resp = await fetch(`${base}/search?${search.toString()}`, { method: "GET", signal: AbortSignal.timeout(15_000) });
        if (!resp.ok) {
            return new Response(JSON.stringify({ ok: false, error: `Screenpipe ${resp.status}` }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }

        const data = (await resp.json()) as { data?: Array<{ content?: Record<string, unknown> }> };
        const items = Array.isArray(data?.data) ? data.data : [];
        for (const item of items) {
            const frameRaw = item?.content?.frame;
            const frame = typeof frameRaw === "string" ? frameRaw : null;
            if (!frame || typeof frame !== "string") continue;
            const imageDataUrl = normalizeFrameToDataUrl(frame);
            if (imageDataUrl) {
                return new Response(JSON.stringify({ ok: true, imageDataUrl }), {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                });
            }
        }

        return new Response(JSON.stringify({ ok: false, error: "No frame found" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch {
        return new Response(
            JSON.stringify({
                ok: false,
                error: "Failed to reach screenpipe",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
        );
    }
}
