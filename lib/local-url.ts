// Loopback URL helpers. LM Studio runs on this machine; a user-supplied
// base URL for it must never point anywhere else (we attach provider
// credentials and screen contents to those requests).

function isLoopbackHostname(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}

export class LocalUrlError extends Error {}

/** Validate and normalize a loopback http(s) URL (no query/hash, no trailing slash). */
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
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

/** Non-throwing variant: the normalized loopback base URL, or null. */
export function localHttpBaseUrl(rawUrl: string): string | null {
    try {
        return parseLocalHttpUrl(rawUrl);
    } catch {
        return null;
    }
}

export function httpUrlToWebSocketUrl(localHttpUrl: string): string {
    return localHttpUrl.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
}

/** `http://host:1234` / `http://host:1234/v1/` → `http://host:1234/v1`. */
export function normalizeV1BaseUrl(baseUrl: string | undefined, fallback: string): string {
    const raw = (baseUrl || fallback).trim().replace(/\/+$/, "");
    return raw.endsWith("/v1") ? raw : `${raw}/v1`;
}
