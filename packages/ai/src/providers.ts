import { ProviderError, type Backend } from "./backend";
import { geminiBackend } from "./gemini-backend";
import { openAiCompatBackend } from "./openai-compat";

/**
 * Which AI answers, from the environment (System Design §8.1, docs/features/AI-provider-switch.md):
 * - `AI_PROVIDER=chain` (default): Gemini's `GEMINI_FAST_MODEL`, then Groq's `GROQ_MODEL` if Gemini isn't available,
 *   then OpenRouter's free `OPENROUTER_MODEL` if Groq isn't either. A tier without its API key is left out;
 * - `AI_PROVIDER=groq`: Groq's `GROQ_MODEL`, backed up by OpenRouter's free `OPENROUTER_MODEL` (no Gemini);
 * - `AI_PROVIDER=gemini`: `GEMINI_FAST_MODEL`, backed up by `GEMINI_FALLBACK_MODEL` (Gemini only);
 * - `AI_PROVIDER=mock` (manual testing): sample data from mock.ts, no network and no limits spent. Never in production.
 * Switching is a setting, never a code change.
 */

export const DEFAULT_FAST_MODEL = "gemini-3.8-flash";
export const DEFAULT_FALLBACK_MODEL = "gemini-3.5-flash-lite";
export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
export const DEFAULT_OPENROUTER_MODEL = "google/gemma-4-31b-it:free";

export const AI_PROVIDERS = ["chain", "groq", "gemini", "mock"] as const;
export type AiProviderSetting = (typeof AI_PROVIDERS)[number];

/**
 * Time kept back for Groq while an earlier tier (Gemini) runs. Groq answers our requests in 1–3 s, so a slow Gemini
 * still leaves Groq enough time.
 */
const GROQ_RESERVE_MS = 4_000;
/**
 * Time kept back for OpenRouter while an earlier tier runs. Free OpenRouter hosts are slower than Groq (1–3 s for our
 * requests, sometimes more), so more than Groq's.
 */
const OPENROUTER_RESERVE_MS = 6_000;

const missing = (name: string) => new Error(`${name} is missing. Add it to apps/web/.env.local (see .env.example).`);

export function aiProvider(): AiProviderSetting {
  const value = (process.env.AI_PROVIDER || "chain").trim().toLowerCase();
  if (!(AI_PROVIDERS as readonly string[]).includes(value)) throw new Error(`AI_PROVIDER must be chain, groq, gemini or mock (got "${value}").`);
  return value as AiProviderSetting;
}

/** How long a sample reply takes, so loading states can be seen. */
const MOCK_DELAY_MS = 800;

/** Answers with the task's sample reply (or the error a test trigger asks for). */
const mockBackend: Backend = {
  provider: "mock",
  model: "mock",
  reserveMs: 0,
  typicalMs: 0,
  async complete({ mock }) {
    if (!mock) throw new ProviderError("AI_PROVIDER=mock has no sample data for this task.", "fatal");
    await new Promise((r) => setTimeout(r, MOCK_DELAY_MS));
    return { text: JSON.stringify(mock()), inputTokens: null, outputTokens: null };
  },
};

/**
 * The API address, or an override from the environment (`GROQ_BASE_URL`, `OPENROUTER_BASE_URL`, like the Gemini SDK's
 * own `GOOGLE_GEMINI_BASE_URL`), so QA can run the chain against fake servers. Never in production: the API key goes
 * to that address, so a stray or tampered value would send it to another host (in clear text over http).
 */
function baseUrl(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  if (process.env.NODE_ENV === "production") throw new Error(`${name} is for testing against fake servers only; remove it in production (the API key would be sent there).`);
  if (!/^https?:\/\//i.test(value)) throw new Error(`${name} must be an http(s) address (got "${value}").`);
  return value.replace(/\/+$/, "");
}

function groqBackend(apiKey: string): Backend {
  return openAiCompatBackend({
    provider: "groq",
    baseUrl: baseUrl("GROQ_BASE_URL", "https://api.groq.com/openai/v1"),
    apiKey,
    keyName: "GROQ_API_KEY",
    model: process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
    reserveMs: GROQ_RESERVE_MS,
    typicalMs: 3_000, // Groq answers our requests in 1–3 s
  });
}

/** OpenRouter's free model, or null without a key or with OPENROUTER_MODEL set to empty (turned off). */
function openRouterBackend(): Backend | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
  if (!apiKey || !model) return null;
  return openAiCompatBackend({
    provider: "openrouter",
    baseUrl: baseUrl("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
    apiKey,
    keyName: "OPENROUTER_API_KEY",
    model,
    reserveMs: OPENROUTER_RESERVE_MS,
    typicalMs: 4_000,
    headers: { "HTTP-Referer": process.env.BETTER_AUTH_URL || "http://localhost:3000", "X-OpenRouter-Title": "Videozilla" },
    // Only hosts that honour JSON mode.
    body: { provider: { require_parameters: true } },
  });
}

/**
 * The models to try, in order: the first answers, each later one is the backup of the one before it (`generateJson`
 * moves on when a tier is busy, too slow, or out of quota or credits).
 */
export function aiChain(): Backend[] {
  const setting = aiProvider();
  if (setting === "mock") {
    // Sample data must never reach real users.
    if (process.env.NODE_ENV === "production") throw new Error("AI_PROVIDER=mock is for development only.");
    return [mockBackend];
  }
  if (setting === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw missing("GEMINI_API_KEY");
    const primary = process.env.GEMINI_FAST_MODEL || DEFAULT_FAST_MODEL;
    const fallback = process.env.GEMINI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;
    return fallback !== primary ? [geminiBackend(apiKey, primary), geminiBackend(apiKey, fallback)] : [geminiBackend(apiKey, primary)];
  }
  const groqKey = process.env.GROQ_API_KEY;
  const openRouter = openRouterBackend();
  if (setting === "groq") {
    if (!groqKey) throw missing("GROQ_API_KEY");
    return openRouter ? [groqBackend(groqKey), openRouter] : [groqBackend(groqKey)];
  }

  // chain: every tier whose key is set, in the order Gemini → Groq → OpenRouter.
  const geminiKey = process.env.GEMINI_API_KEY;
  const chain = [
    geminiKey ? geminiBackend(geminiKey, process.env.GEMINI_FAST_MODEL || DEFAULT_FAST_MODEL) : null,
    groqKey ? groqBackend(groqKey) : null,
    openRouter,
  ].filter((b): b is Backend => b !== null);
  if (!chain.length) throw new Error("No AI key is set. Add GEMINI_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY to apps/web/.env.local (see .env.example).");
  return chain;
}
