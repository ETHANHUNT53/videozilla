/**
 * AI settings that must never be live in production, checked without loading any AI SDK (import from
 * `@videozilla/ai/config`), so the web app can also run it at boot (apps/web/src/instrumentation.ts) and a bad deploy
 * fails at once instead of on the first user's request.
 */

/**
 * API address overrides for testing against fake servers. The key goes to that address, so in production a stray or
 * tampered value would send it to another host. `GOOGLE_GEMINI_BASE_URL` is read by the Gemini SDK itself.
 */
export const BASE_URL_SETTINGS = ["GOOGLE_GEMINI_BASE_URL", "GROQ_BASE_URL", "OPENROUTER_BASE_URL"] as const;

/** Throws when a test-only AI setting is set in production; does nothing otherwise. */
export function assertAiConfigSafe(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV !== "production") return;
  for (const name of BASE_URL_SETTINGS) {
    if (env[name]?.trim()) throw new Error(`${name} is for testing against fake servers only; remove it in production (the API key would be sent there).`);
  }
  if ((env.AI_PROVIDER ?? "").trim().toLowerCase() === "mock") throw new Error("AI_PROVIDER=mock is for development only.");
}
