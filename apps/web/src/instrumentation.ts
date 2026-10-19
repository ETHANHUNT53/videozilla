/**
 * Runs once when the server starts (Next.js instrumentation). Test-only AI settings (base-URL overrides, mock mode)
 * are refused in production here too, so a bad deploy fails at boot instead of on the first user's AI request. A
 * thrown error alone only gets logged (the server still says "Ready" and every route answers 500, which a health check
 * could take for alive), so in production the process exits.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertAiConfigSafe } = await import("@videozilla/ai/config");
  try {
    assertAiConfigSafe();
  } catch (err) {
    console.error(`[boot] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
