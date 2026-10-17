import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

/**
 * Lint for the shared packages (`npm run lint` runs this and the web app's own config in apps/web).
 * Same TypeScript rules the web app gets from eslint-config-next/typescript.
 */
export default defineConfig([
  globalIgnores(["**/node_modules/**", "**/dist/**", "apps/**", "m0/**", ".cache/**", ".claude/**"]),
  {
    files: ["packages/**/*.ts"],
    extends: [tseslint.configs.recommended],
  },
]);
