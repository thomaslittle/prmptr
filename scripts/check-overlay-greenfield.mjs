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
    "OverlayCapabilities",
    "WebviewWindowBuilder::new",
    ".always_on_top(true)",
    ".transparent(true)",
    "capture_protection_supported",
    "set_ignore_cursor_events",
    "window.destroy()",
    "center_overlay",
    "should_auto_show",
    "publish_overlay_content",
]) {
    if (!overlayNative.includes(required)) {
        fail(`native overlay runtime is missing required ownership marker: ${required}`);
    }
}
if (!overlayNative.includes('cfg!(any(target_os = "windows", target_os = "macos"))')) {
    fail("capture-protection capability must remain truthful: Windows/macOS only");
}

const cargo = read("src-tauri/Cargo.toml");
if (!cargo.includes('features = ["macos-private-api"]')) {
    fail("macOS transparent overlay support requires Tauri macos-private-api");
}

const overlayStore = read("lib/stores/overlay-store.ts");
if (!overlayStore.includes("enabled: false")) {
    fail("overlay preference must remain opt-in/default-off");
}
if (!overlayStore.includes("captureProtected: true")) {
    fail("overlay capture protection preference must remain default-on");
}
if (!overlayStore.includes("sameNativePreferences")) {
    fail("overlay runtime/store synchronization must retain its no-echo guard");
}
if (!overlayStore.includes("captureProtected: runtime.config.captureProtected")) {
    fail("desired capture-shield preference must stay distinct from effective platform support");
}

const aiResponse = read("components/ai-response.tsx");
if (!aiResponse.includes("setCurrentResponse(currentResponse)")) {
    fail("active AI response text must be mirrored into shared SessionStore state");
}
if (!aiResponse.includes("setIsStreaming(isStreaming)")) {
    fail("active AI streaming state must be mirrored into shared SessionStore state");
}

const overlayPage = read("app/overlay/page.tsx");
if (overlayPage.includes("Waiting for response...")) {
    fail("placeholder overlay UI has returned");
}
if (!overlayPage.includes("getOverlayState") || !overlayPage.includes("onOverlayContent")) {
    fail("overlay renderer must initialize from retained native state and subscribe to content events");
}
if (!overlayPage.includes("currentResponse") || !overlayPage.includes("isStreaming")) {
    fail("overlay renderer must retain live token-stream presentation");
}

const shortcutManager = read("hooks/use-shortcut-manager.ts");
const overlayController = read("components/overlay-feature-controller.tsx");
if (shortcutManager.includes("unregisterAll") || overlayController.includes("unregisterAll")) {
    fail("overlay/global shortcut ownership must never use unregisterAll()");
}
if (!overlayController.includes("Test overlay") || !overlayController.includes("PRMPTR self-test")) {
    fail("tester-facing deterministic overlay preview must remain available");
}
if (!overlayController.includes("captureProtectionSupported")) {
    fail("overlay controls must consume effective native capability reporting");
}

const capability = JSON.parse(read("src-tauri/capabilities/default.json"));
if ((capability.permissions ?? []).includes("global-shortcut:allow-unregister-all")) {
    fail("default capability must not grant unregister-all shortcut authority");
}
if (!(capability.windows ?? []).includes("overlay")) {
    fail("dynamic overlay window must remain covered by a Tauri capability");
}

if (!process.exitCode) {
    console.log("OVERLAY GREENFIELD PASS: optional ownership, live stream bridge, platform capability truth, preview path, state sync, and shortcut isolation guards are intact.");
}
