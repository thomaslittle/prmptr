import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests only. Playwright specs under e2e/ run via `npx playwright test`.
export default defineConfig({
    resolve: {
        alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
    },
    test: {
        include: ["lib/**/__tests__/**/*.{test,spec}.{ts,tsx}", "components/**/*.test.{ts,tsx}"],
        exclude: ["node_modules/**", "e2e/**", ".next/**", "out/**", "src-tauri/**"],
        environment: "node",
    },
});
