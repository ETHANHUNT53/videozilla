import { ProviderError, type Backend } from "./backend";
import { geminiBackend } from "./gemini-backend";
import { openAiCompatBackend } from "./openai-compat";

/**
 * Which AI answers, from the environment (System Design §8.1, docs/features/AI-provider-switch.md):
 * - `AI_PROVIDER=groq` (default for development): Groq's `GROQ_MODEL`, backed up by OpenRouter's free `OPENROUTER_MODEL`;
 * - `AI_PROVIDER=gemini` (later, on the paid plan): `GEMINI_FAST_MODEL`, backed up by `GEMINI_FALLBACK_MODEL`;
 * - `AI_PROVIDER=mock` (manual testing): sample data from mock.ts, no network and no limits spent. Never in production.
 * Switching is a setting, never a code change.
 */

export const DEFAULT_FAST_MODEL = "gemini-3.8-flash";
export const DEFAULT_FALLBACK_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_OPENROUTER_MODEL = "google/gemma-4-31b-it:free";

export const AI_PROVIDERS = ["groq", "gemini", "mock"] as const;
export type AiProviderSetting = (typeof AI_PROVIDERS)[number];

/**
 * Time kept back for the OpenRouter backup while Groq runs. Free OpenRouter hosts are slower than Groq (1–3 s for our
 * requests), so more than Gemini's 4 s.
 */
const OPENROUTER_RESERVE_MS = 6_000;

const missing = (name: string) => new Error(`${name} is missing. Add it to apps/web/.env.local (see .env.example).`);

export function aiProvider(): AiProviderSetting {
  const value = (process.env.AI_PROVIDER || "groq").trim().toLowerCase();
  if (!(AI_PROVIDERS as readonly string[]).includes(value)) throw new Error(`AI_PROVIDER must be groq, gemini or mock (got "${value}").`);
  return value as AiProviderSetting;
}

/** How long a sample reply takes, so loading states can be seen. */
const MOCK_DELAY_MS = 800;

/** Answers with the task's sample reply (or the error a test trigger asks for). */
const mockBackend: Backend = {
  provider: "mock",
  model: "mock",
  reserveMs: 0,
  async complete({ mock }) {
    if (!mock) throw new ProviderError("AI_PROVIDER=mock has no sample data for this task.", "fatal");
    await new Promise((r) => setTimeout(r, MOCK_DELAY_MS));
    return { text: JSON.stringify(mock()), inputTokens: null, outputTokens: null };
  },
};

/** The main model and its backup (none when the backup is turned off or has no key). */
export function aiBackends(): { main: Backend; backup: Backend | null } {
  if (aiProvider() === "mock") {
    // Sample data must never reach real users.
    if (process.env.NODE_ENV === "production") throw new Error("AI_PROVIDER=mock is for development only.");
    return { main: mockBackend, backup: null };
  }
  if (aiProvider() === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw missing("GEMINI_API_KEY");
    const primary = process.env.GEMINI_FAST_MODEL || DEFAULT_FAST_MODEL;
    const fallback = process.env.GEMINI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;
    return { main: geminiBackend(apiKey, primary), backup: fallback !== primary ? geminiBackend(apiKey, fallback) : null };
  }

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) throw missing("GROQ_API_KEY");
  const main = openAiCompatBackend({
    provider: "groq",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKey: groqKey,
    keyName: "GROQ_API_KEY",
    model: process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
    reserveMs: 0,
  });
  // The backup is optional: no key, or OPENROUTER_MODEL set to empty, turns it off.
  const orKey = process.env.OPENROUTER_API_KEY;
  const orModel = process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
  const backup =
    orKey && orModel
      ? openAiCompatBackend({
          provider: "openrouter",
          baseUrl: "https://openrouter.ai/api/v1",
          apiKey: orKey,
          keyName: "OPENROUTER_API_KEY",
          model: orModel,
          reserveMs: OPENROUTER_RESERVE_MS,
          headers: { "HTTP-Referer": process.env.BETTER_AUTH_URL || "http://localhost:3000", "X-OpenRouter-Title": "Videozilla" },
          // Only hosts that honour JSON mode.
          body: { provider: { require_parameters: true } },
        })
      : null;
  return { main, backup };
}
