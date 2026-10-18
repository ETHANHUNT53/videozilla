import type { ZodType } from "zod";
import { AiBlockedError, AiBusyError, AiOutputError, ProviderError, type AiProvider, type Backend, type ChatTurn } from "./backend";
import { aiBackends } from "./providers";

/**
 * One structured AI call for the interactive features (idea suggestions, briefs, idea chat — System Design §8.1,
 * §8.2): JSON output checked with a Zod schema (one repair round), a quick retry when the model is busy, then the
 * fallback model, all inside a deadline (15 s by default) so the request never hangs. Every call is reported through
 * `onCall` for the `ai_calls` log. The provider (Groq + OpenRouter, or Gemini) comes from `AI_PROVIDER` (providers.ts).
 */

export { AiBlockedError, AiBusyError, AiOutputError, ProviderError, type AiProvider } from "./backend";
export { DEFAULT_FALLBACK_MODEL, DEFAULT_FAST_MODEL, DEFAULT_GROQ_MODEL, DEFAULT_OPENROUTER_MODEL, aiProvider } from "./providers";

export interface AiCallLog {
  provider: AiProvider;
  model: string;
  status: "ok" | "retry" | "failed" | "fallback";
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  error?: string;
}

export interface GenerateJsonOptions<T> {
  system: string;
  prompt: string;
  schema: ZodType<T>;
  /** Whole-call budget, retries and repair included. */
  deadlineMs?: number;
  temperature?: number;
  onCall?: (log: AiCallLog) => void | Promise<void>;
}

const BUSY = /\b(429|500|502|503|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|overloaded|high demand|timed? ?out|aborted/i;
const isBusy = (err: unknown) => BUSY.test(String((err as Error)?.message ?? err)) || (err as Error)?.name === "AbortError" || (err as Error)?.name === "TimeoutError";
const isTimeout = (err: unknown) => (err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError" || /timed? ?out|aborted/i.test(String((err as Error)?.message));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const RECITATION_FIX =
  "Your reply was stopped because it repeated existing text word for word. Write it again entirely in your own words: don't quote poems, lyrics or other published text. Return the full JSON only.";

/**
 * Quota circuit breaker (per server process): a model whose quota or credits ran out (e.g. Groq's free daily tokens,
 * OpenRouter's 50 free requests a day) is skipped until the provider says to retry, so requests don't waste their time
 * budget on it. Keyed by provider and model.
 */
const cooldownUntil = new Map<string, number>();
const MAX_COOLDOWN_MS = 24 * 3600_000;
const key = (b: Backend) => `${b.provider}:${b.model}`;

/** Forget all quota cooldowns (tests). */
export function resetModelCooldowns(): void {
  cooldownUntil.clear();
}

/** Gemini's "pay first" answers (the key's prepaid credits are used up). */
const BILLING = /prepayment credits are depleted|"code"\s*:\s*402\b|\b402\b.*billing/i;
/** How long to skip a model whose key is out of credits: a top-up is a manual step. */
const BILLING_COOLDOWN_MS = 30 * 60_000;

/**
 * How long to skip a Gemini model after this error, or null when it isn't a quota error. Uses Gemini's own
 * `retryDelay`; without one, 30 minutes for a daily quota and 1 minute otherwise.
 */
export function quotaCooldownMs(err: unknown): number | null {
  const msg = String((err as Error)?.message ?? err);
  // Out of paid credits (402 "Your prepayment credits are depleted"): nothing works until billing is topped up, on any
  // model of this key, so skip the calls for a while instead of spending three failed calls on every request.
  if (BILLING.test(msg)) return BILLING_COOLDOWN_MS;
  if (!/exceeded your current quota|quota exceeded for metric/i.test(msg)) return null;
  const delay = msg.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  const ms = delay ? Number(delay[1]) * 1000 : /PerDay/i.test(msg) ? 30 * 60_000 : 60_000;
  return Math.min(Math.max(ms, 10_000), MAX_COOLDOWN_MS);
}

/** What to do about a failed call: the adapter's own verdict, or (Gemini SDK errors) one read from the message. */
function classify(err: unknown): { kind: ProviderError["kind"]; cooldownMs?: number; text?: string } {
  if (err instanceof ProviderError) return { kind: err.kind, ...err.extra };
  const cooldownMs = quotaCooldownMs(err);
  if (cooldownMs !== null) return { kind: BILLING.test(String((err as Error)?.message ?? err)) ? "billing" : "quota", cooldownMs };
  return { kind: isBusy(err) ? "busy" : "fatal" };
}

/** Where a person tops up credits, for the loud server-log line. */
const BILLING_HELP: Record<AiProvider, string> = {
  gemini: "top up billing in Google AI Studio",
  groq: "check billing at console.groq.com",
  openrouter: "add credits at openrouter.ai",
};

export async function generateJson<T>(opts: GenerateJsonOptions<T>): Promise<{ data: T; model: string; provider: AiProvider }> {
  const { main, backup } = aiBackends();
  // Two tries on the main model (the second after a short pause, only if the first failed fast), then the fallback.
  const plan = backup ? [main, main, backup] : [main, main];
  const deadline = Date.now() + (opts.deadlineMs ?? 15_000);
  const turns: ChatTurn[] = [{ role: "user", text: opts.prompt }];
  const coolingDown = (b: Backend) => (cooldownUntil.get(key(b)) ?? 0) > Date.now();
  const log = async (entry: AiCallLog) => {
    try {
      await opts.onCall?.(entry);
    } catch {
      // Logging must never break the feature.
    }
  };

  let step = 0; // position in `plan`; a busy model moves us on, and we stay there for the repair round
  const skipLogged = new Set<string>(); // one "skipped" row per model per request
  const call = async (): Promise<{ text: string; backend: Backend; recited?: boolean }> => {
    for (; step < plan.length; step++) {
      const backend = plan[step];
      const { provider, model } = backend;
      if (coolingDown(backend)) {
        // Out of quota: don't spend time on it, but leave a trace in the call log (why the fallback was used, or why
        // the request failed without a single call).
        if (!skipLogged.has(key(backend))) {
          skipLogged.add(key(backend));
          await log({ provider, model, status: "retry", latencyMs: 0, inputTokens: null, outputTokens: null, error: `skipped: quota cooldown until ${new Date(cooldownUntil.get(key(backend))!).toISOString()}` });
        }
        continue;
      }
      // The main model never uses the fallback's reserved time (unless the fallback is out of quota itself).
      const reserve = backend === main && backup && !coolingDown(backup) ? backup.reserveMs : 0;
      const remaining = deadline - Date.now() - reserve;
      if (remaining < 1_000) continue;
      const started = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const res = await Promise.race([
          backend.complete({ system: opts.system, turns, temperature: opts.temperature ?? 0.8, signal: AbortSignal.timeout(remaining) }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error("timed out"), { name: "TimeoutError" })), remaining);
          }),
        ]).finally(() => clearTimeout(timer));
        if (res.recited) {
          await log({ provider, model, status: "failed", latencyMs: Date.now() - started, inputTokens: res.inputTokens, outputTokens: null, error: "recitation" });
          return { text: "", backend, recited: true };
        }
        await log({ provider, model, status: backend === main ? "ok" : "fallback", latencyMs: Date.now() - started, inputTokens: res.inputTokens, outputTokens: res.outputTokens });
        return { text: res.text, backend };
      } catch (err) {
        if (err instanceof AiBlockedError) {
          await log({ provider, model, status: "failed", latencyMs: Date.now() - started, inputTokens: err.inputTokens, outputTokens: null, error: `blocked: ${err.reason}` });
          throw err;
        }
        const verdict = classify(err);
        const message = String((err as Error)?.message ?? err).slice(0, 300);
        // The model wrote text that isn't JSON (Groq won't pass it on in JSON mode): an unusable reply, which the
        // repair round answers like any other.
        if (verdict.kind === "bad_json") {
          await log({ provider, model, status: "failed", latencyMs: Date.now() - started, inputTokens: null, outputTokens: null, error: message });
          return { text: verdict.text ?? "", backend };
        }
        // Out of quota or credits counts as busy (move on to the fallback, answer 503 with a refund), never as a bug.
        const busy = verdict.kind !== "fatal";
        await log({ provider, model, status: busy ? "retry" : "failed", latencyMs: Date.now() - started, inputTokens: null, outputTokens: null, error: message });
        if (!busy) throw err;
        const cooldown = verdict.cooldownMs ?? null;
        if (cooldown !== null) cooldownUntil.set(key(backend), Date.now() + cooldown);
        if (verdict.kind === "billing") {
          // Needs a person: say so loudly in the server log (ai_calls has the full error too).
          console.error(`[ai] ${provider} says the account's prepaid credits are used up (${model}); ${BILLING_HELP[provider]}. Skipping it for ${Math.round((cooldown ?? 0) / 60_000)} min.`);
        }
        // Out of quota, or too slow: a second try won't help, go straight to the fallback. A quick "busy" gets one retry.
        if (backend === main && (cooldown !== null || isTimeout(err))) step = backup ? plan.length - 2 : plan.length - 1;
        else if (step === 0) await sleep(1_000);
      }
    }
    // Every model is out of quota: say when the first one is back (capped at an hour, since a free tier's daily reset
    // is hours away and a paid key may be added meanwhile).
    const backends = backup ? [main, backup] : [main];
    const waits = backends.filter(coolingDown).map((b) => (cooldownUntil.get(key(b))! - Date.now()) / 1000);
    throw new AiBusyError(waits.length === backends.length ? Math.min(3600, Math.ceil(Math.min(...waits))) : undefined);
  };

  let problem = "";
  for (let round = 0; round < 2; round++) {
    const { text, backend, recited } = await call();
    if (recited) {
      problem = "The reply repeated existing text (recitation).";
      // No reply text to answer, so the instruction joins the last user turn (turns must alternate).
      turns[turns.length - 1].text += `\n\n${RECITATION_FIX}`;
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      problem = "The reply was not valid JSON.";
      // An empty model turn is refused by some APIs, so an empty reply is described instead.
      turns.push({ role: "model", text: text || "(empty reply)" }, { role: "user", text: `${problem} Return only the JSON object.` });
      continue;
    }
    const result = opts.schema.safeParse(parsed);
    if (result.success) return { data: result.data, model: backend.model, provider: backend.provider };
    problem = result.error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    turns.push({ role: "model", text }, { role: "user", text: `The JSON did not match the required shape: ${problem}. Fix it and return the full corrected JSON only.` });
  }
  throw new AiOutputError(`The model's reply didn't match the expected shape: ${problem}`);
}
