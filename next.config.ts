import type { NextConfig } from "next";

// PRMPTR ships as a Tauri desktop app: the UI is a fully static export served
// from the app bundle (`out/`). There is no Node server in production, so
// nothing here may rely on API routes, middleware, or server rendering at
// request time. Network calls go through `lib/http.ts` (Tauri's Rust HTTP
// client) and native work through Tauri commands.
const nextConfig: NextConfig = {
    output: "export",
    images: { unoptimized: true },
    // Playwright e2e runs a production build on its own port; keep the dev
    // server's indicator out of screenshots.
    devIndicators: false,
};

export default nextConfig;
