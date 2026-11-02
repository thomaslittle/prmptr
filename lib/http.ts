// Single network entry point for the UI.
//
// Inside the desktop app every request goes through Tauri's Rust HTTP client
// (`@tauri-apps/plugin-http`): it isn't subject to browser CORS, it streams
// response bodies, and its allowlist lives in
// src-tauri/capabilities/default.json, so the webview can only reach the
// provider APIs and loopback services listed there.
//
// Outside Tauri (plain browser, Playwright e2e) it is the platform `fetch`,
// which lets tests intercept provider traffic with `page.route`.

import { isTauri } from "./runtime";

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

let tauriFetch: FetchFn | null = null;

/** Set by the Playwright harness so provider traffic is interceptable while the IPC mock stands in for Rust. */
function preferNativeFetch(): boolean {
    return !isTauri() || (typeof window !== "undefined" && (window as { __PRMPTR_E2E_NATIVE_FETCH__?: boolean }).__PRMPTR_E2E_NATIVE_FETCH__ === true);
}

async function resolveFetch(): Promise<FetchFn> {
    if (preferNativeFetch()) return globalThis.fetch.bind(globalThis);
    if (!tauriFetch) {
        const mod = await import("@tauri-apps/plugin-http");
        tauriFetch = mod.fetch as FetchFn;
    }
    return tauriFetch;
}

export async function appFetch(input: string | URL, init?: RequestInit): Promise<Response> {
    const fetchImpl = await resolveFetch();
    return fetchImpl(input, init);
}

/** `AbortSignal.timeout` merged with an optional caller signal. */
export function timeoutSignal(ms: number, signal?: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(ms);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Fetch JSON with a timeout; resolves to null on any network/HTTP/parse failure. */
export async function fetchJson<T>(
    url: string,
    init: RequestInit & { timeoutMs?: number } = {}
): Promise<T | null> {
    const { timeoutMs = 15_000, ...rest } = init;
    try {
        const resp = await appFetch(url, { ...rest, signal: timeoutSignal(timeoutMs, rest.signal ?? undefined) });
        if (!resp.ok) return null;
        return (await resp.json()) as T;
    } catch {
        return null;
    }
}
