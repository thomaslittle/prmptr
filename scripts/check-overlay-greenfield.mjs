import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");
const fail = (message) => {
    console.error(`OVERLAY GREENFIELD FAIL: ${message}`);
    process.exitCode = 1;
};

const config = JSON.parse(read("src-tauri/tauri.conf.json"));
const windows = config?.app?.windows ?? [];
if (windows.some((window) => window?.label === "overlay")) {
    fail("tauri.conf.json must not statically create the optional overlay window");
}
if (!windows.some((window) => window?.label === "main")) {
    fail("the main Tauri window is missing");
}

const overlayNative = read("src-tauri/src/overlay/mod.rs");
for (const required of [
    "OverlayManager",
    "WebviewWindowBuilder::new",
    ".always_on_top(true)",
    ".transparent(true)",
    ".content_protected(config.capture_protected)",
    "set_ignore_cursor_events",
    "window.destroy()",
    "publish_overlay_content",
]) {
    if (!overlayNative.includes(required)) {
        fail(`native overlay runtime is missing required ownership marker: ${required}`);
    }
}

const overlayStore = read("lib/stores/overlay-store.ts");
if (!overlayStore.includes("enabled: false")) {
    fail("overlay preference must remain opt-in/default-off");
}
if (!overlayStore.includes("captureProtected: true")) {
    fail("overlay capture protection must remain default-on");
}
if (!overlayStore.includes("sameNativePreferences")) {
    fail("overlay runtime/store synchronization must retain its no-echo guard");
}

const overlayPage = read("app/overlay/page.tsx");
if (overlayPage.includes("Waiting for response...")) {
    fail("placeholder overlay UI has returned");
}
if (!overlayPage.includes("getOverlayState") || !overlayPage.includes("onOverlayContent")) {
    fail("overlay renderer must initialize from retained native state and subscribe to content events");
}

const shortcutManager = read("hooks/use-shortcut-manager.ts");
const overlayController = read("components/overlay-feature-controller.tsx");
if (shortcutManager.includes("unregisterAll") || overlayController.includes("unregisterAll")) {
    fail("overlay/global shortcut ownership must never use unregisterAll()");
}

const capability = JSON.parse(read("src-tauri/capabilities/default.json"));
if ((capability.permissions ?? []).includes("global-shortcut:allow-unregister-all")) {
    fail("default capability must not grant unregister-all shortcut authority");
}
if (!(capability.windows ?? []).includes("overlay")) {
    fail("dynamic overlay window must remain covered by a Tauri capability");
}

if (!process.exitCode) {
    console.log("OVERLAY GREENFIELD PASS: optional ownership, capture shield, renderer transport, no-echo state sync, and shortcut isolation guards are intact.");
}
