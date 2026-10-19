/**
 * Runs once when the server starts (Next.js instrumentation). Test-only AI settings (base-URL overrides, mock mode)
 * are refused in production here too, so a bad deploy fails at boot instead of on the first user's AI request.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertAiConfigSafe } = await import("@videozilla/ai/config");
  assertAiConfigSafe();
}
