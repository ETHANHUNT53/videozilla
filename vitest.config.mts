import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const webSrc = fileURLToPath(new URL("./apps/web/src/", import.meta.url));

/**
 * Unit tests (System Design §19): the shared packages and the web app's server code. Run with `npm test` from the
 * repository root. For web tests, `@/` resolves like in Next.js and `server-only` is an empty stub (it only guards
 * against importing server code into client bundles).
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: webSrc },
      { find: /^server-only$/, replacement: fileURLToPath(new URL("./apps/web/test/server-only.ts", import.meta.url)) },
    ],
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/web/src/**/*.test.ts"],
    environment: "node",
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
