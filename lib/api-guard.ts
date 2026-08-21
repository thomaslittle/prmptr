import { NextRequest } from "next/server";

/**
 * Server-side guards for the local API routes.
 *
 * The Next.js dev server runs on the user's machine while the Tauri app is
 * active. Without these guards, any local process (or any web page open in
 * the user's browser, via cross-site fetch) could reach the routes and make
 * the server fetch arbitrary URLs (SSRF), including relaying internal
 * service responses back to the caller.
 */

function isLoopbackHostname(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1" ||
        host.endsWith(".localhost")
    );
}

function jsonResponse(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

/**
 * Reject requests that did not originate from our own loopback UI.
 * - Host header must be a loopback name.
 * - If an Origin header is present it must also be loopback (browsers send
 *   Origin on cross-site fetches; drive-by web pages fail here).
 * - Sec-Fetch-Site must not be cross-site when present.
 */
export function guardTrustedRequest(request: NextRequest): Response | null {
    const hostHeader = request.headers.get("host") ?? "";
    const host = hostHeader.split(":")[0] ?? "";
    if (!isLoopbackHostname(host)) {
        return jsonResponse({ error: "Forbidden" }, 403);
    }

    const origin = request.headers.get("origin");
    if (origin && origin !== "null") {
        try {
            if (!isLoopbackHostname(new URL(origin).hostname)) {
                return jsonResponse({ error: "Forbidden" }, 403);
            }
        } catch {
            return jsonResponse({ error: "Forbidden" }, 403);
        }
    }

    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite && ["cross-site", "cross-origin"].includes(fetchSite)) {
        return jsonResponse({ error: "Forbidden" }, 403);
    }

    return null;
}

export class LocalUrlError extends Error {}

/**
 * Parse and validate a URL that will be fetched server-side. Only plain
 * http/https to loopback hosts is allowed — screenpipe and LM Studio both
 * run locally on this machine; there is no legitimate remote target.
 */
export function parseLocalHttpUrl(rawUrl: string): string {
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new LocalUrlError("Invalid URL");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new LocalUrlError("Only http(s) URLs are allowed");
    }
    if (!isLoopbackHostname(url.hostname)) {
        throw new LocalUrlError("Only loopback hosts are allowed");
    }
    // Normalize: strip trailing slashes and any query/hash.
    const normalized = `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
    return normalized;
}

/** Convert a validated local http(s) base URL into a ws(s) base URL. */
export function httpUrlToWebSocketUrl(localHttpUrl: string): string {
    return localHttpUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
}

/** Non-throwing variant: returns the normalized loopback base URL or null. */
export function localHttpBaseUrl(rawUrl: string): string | null {
    try {
        return parseLocalHttpUrl(rawUrl);
    } catch {
        return null;
    }
}

/** Alias for guardTrustedRequest kept for readability at call sites. */
export const rejectUntrustedRequest = guardTrustedRequest;
