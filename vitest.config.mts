import { defineConfig } from "vitest/config";

/** Unit tests for the shared engine packages (System Design §19). Run with `npm test` from the repository root. */
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    environment: "node",
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
