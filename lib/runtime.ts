/** True inside the Tauri webview (desktop app), false in a plain browser. */
export function isTauri(): boolean {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
