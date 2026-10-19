import type { NextConfig } from "next";
import { assertAiConfigSafe } from "@videozilla/ai/config";

// Test-only AI settings (base-URL overrides, mock mode) are refused in production builds and servers: this config
// loads for `next build` and `next start` (NODE_ENV=production), so a bad deploy fails at build time instead of at
// runtime (instrumentation only runs once the server starts). A no-op in development.
assertAiConfigSafe();

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
