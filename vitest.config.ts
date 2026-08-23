import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit-test configuration.
//
// - `@/*` mirrors the tsconfig path alias used by app/lib/components code so
//   suites importing `@/lib/...` resolve identically to Next.js builds.
// - Test discovery is scoped to `lib/__tests__/`; standalone node assertion
//   scripts under `scripts/*.test.mjs` keep their own runner
//   (`npm run speech:benchmark:test`) and are not vitest suites.
export default defineConfig({
    resolve: {
        alias: {
            "@": fileURLToPath(new URL(".", import.meta.url)),
        },
    },
    test: {
        include: ["lib/__tests__/**/*.test.{ts,tsx}"],
        environment: "node",
    },
});
