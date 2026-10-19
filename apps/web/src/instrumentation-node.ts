/**
 * The Node-only part of the boot check (loaded by instrumentation.ts only when NEXT_RUNTIME is "nodejs", so the Edge
 * build never sees `process.exit`). Test-only AI settings (base-URL overrides, mock mode) are refused in production:
 * a thrown error alone only gets logged (the server still says "Ready" and every route answers 500, which a health
 * check could take for alive), so the process exits.
 */
import { assertAiConfigSafe } from "@videozilla/ai/config";

export function checkAiConfigAtBoot(): void {
  try {
    assertAiConfigSafe();
  } catch (err) {
    console.error(`[boot] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
