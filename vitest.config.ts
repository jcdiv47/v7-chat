import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The repo's first test runner. Node environment, TypeScript through the
 * existing tsconfig, no DOM and no setup files — the current suite covers a
 * pure function and needs nothing else.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tui/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
