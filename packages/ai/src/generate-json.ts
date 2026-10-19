import type { ZodType } from "zod";
import { AiBlockedError, AiBusyError, AiOutputError, ProviderError, type AiProvider, type Backend, type ChatTurn } from "./backend";
import { aiChain } from "./providers";

/**
 * One structured AI call for the interactive features (idea suggestions, briefs, idea chat — System Design §8.1,
 * §8.2): JSON output checked with a Zod schema (one repair round), a quick retry when the model is busy, then the
 * next model in the chain (Gemini → Groq → OpenRouter by default), all inside a deadline (15 s by default) so the
 * request never hangs. Every call is reported through `onCall` for the `ai_calls` log. The chain (or one provider, or
 * sample data) comes from `AI_PROVIDER` (providers.ts).
 */

export { AiBlockedError, AiBusyError, AiOutputError, ProviderError, type AiProvider } from "./backend";
export { DEFAULT_FALLBACK_MODEL, DEFAULT_FAST_MODEL, DEFAULT_GROQ_MODEL, DEFAULT_OPENROUTER_MODEL, aiChain, aiProvider } from "./providers";

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
  /** The sample reply for `AI_PROVIDER=mock` (mock.ts). Without it, mock mode fails for this task. */
  mock?: () => unknown;
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
 * budget on it and go straight to the next tier. Keyed by provider and model; an account out of credits (402) is
 * keyed by provider, since every model of that key fails the same way.
 */
const cooldownUntil = new Map<string, number>();
const MAX_COOLDOWN_MS = 24 * 3600_000;
const key = (b: Backend) => `${b.provider}:${b.model}`;
/** A whole provider's cooldown (its account is out of credits). */
const providerKey = (b: Backend) => `${b.provider}:*`;
const cooldownEnd = (b: Backend) => Math.max(cooldownUntil.get(key(b)) ?? 0, cooldownUntil.get(providerKey(b)) ?? 0, cooldownUntil.get(`${b.provider}:setup`) ?? 0);
const coolingDown = (b: Backend) => cooldownEnd(b) > Date.now();
/** Skipped because the account is out of credits (rather than a quota). */
const inBillingCooldown = (b: Backend) => (cooldownUntil.get(providerKey(b)) ?? 0) > Date.now();
/** A provider whose key or model was rejected (a setup problem) is skipped for a while, so the chain moves on. */
const setupKey = (b: Backend) => `${b.provider}:setup`;
const inSetupCooldown = (b: Backend) => (cooldownUntil.get(setupKey(b)) ?? 0) > Date.now();
/** How long to skip a provider with a setup problem: fixing a key or model name is a manual step. */
const SETUP_COOLDOWN_MS = 10 * 60_000;

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
function classify(err: unknown): { kind: ProviderError["kind"]; cooldownMs?: number; text?: string; setup?: boolean } {
  if (err instanceof ProviderError) return { kind: err.kind, ...err.extra };
  // Gemini SDK: the key was rejected, or the model doesn't exist (a wrong or retired GEMINI_FAST_MODEL).
  const status = (err as { status?: unknown })?.status;
  if (status === 401 || status === 403 || status === 404 || /API key not valid|API_KEY_INVALID|PERMISSION_DENIED|is not found for API version/i.test(String((err as Error)?.message))) {
    return { kind: "fatal", setup: true };
  }
  // The Gemini SDK's ApiError carries the HTTP status: 402 is always "pay first".
  if ((err as { status?: unknown })?.status === 402) return { kind: "billing", cooldownMs: BILLING_COOLDOWN_MS };
  const cooldownMs = quotaCooldownMs(err);
  if (cooldownMs !== null) return { kind: BILLING.test(String((err as Error)?.message ?? err)) ? "billing" : "quota", cooldownMs };
  return { kind: isBusy(err) ? "busy" : "fatal" };
}

/** Where a person tops up credits, for the loud server-log line. */
const BILLING_HELP: Record<AiProvider, string> = {
  gemini: "top up billing in Google AI Studio",
  groq: "check billing at console.groq.com",
  openrouter: "add credits at openrouter.ai",
  mock: "nothing to do (mock mode)",
};

export async function generateJson<T>(opts: GenerateJsonOptions<T>): Promise<{ data: T; model: string; provider: AiProvider }> {
  // The models to try in order (Gemini → Groq → OpenRouter by default); each later one backs up the one before it.
  const tiers = aiChain();
  const deadline = Date.now() + (opts.deadlineMs ?? 15_000);
  const turns: ChatTurn[] = [{ role: "user", text: opts.prompt }];
  const log = async (entry: AiCallLog) => {
    try {
      await opts.onCall?.(entry);
    } catch {
      // Logging must never break the feature.
    }
  };

  let tier = 0; // position in `tiers`; a busy model moves us on, and we stay there for the repair round
  let retried = false; // one quick retry per request, for the first model that fails fast with "busy"
  const skipLogged = new Set<string>(); // one "skipped" row per model per request
  let lastFatal: unknown; // a tier's bad-request / setup error, thrown only if no later tier answers
  let sawBusy = false; // some tier was merely busy, slow or out of quota: then the answer is "busy", not that error
  const call = async (): Promise<{ text: string; backend: Backend; recited?: boolean }> => {
    for (; tier < tiers.length; tier++) {
      const backend = tiers[tier];
      const { provider, model } = backend;
      for (;;) {
        if (coolingDown(backend)) {
          // Out of quota or credits: don't spend time on it, but leave a trace in the call log (why the fallback was
          // used, or why the request failed without a single call).
          if (!skipLogged.has(key(backend))) {
            skipLogged.add(key(backend));
            const why = inBillingCooldown(backend) ? "billing" : inSetupCooldown(backend) ? "setup" : "quota";
            await log({ provider, model, status: "retry", latencyMs: 0, inputTokens: null, outputTokens: null, error: `skipped: ${why} cooldown until ${new Date(cooldownEnd(backend)).toISOString()}` });
          }
          break;
        }
        // Keep the next available tier's reserve back, so a slow model still leaves it time. When that would leave
        // this model less than its own reserve (a slow earlier tier used most of the deadline), it gets all that's left.
        const next = tiers.slice(tier + 1).find((b) => !coolingDown(b));
        const left = deadline - Date.now();
        const remaining = next && left - next.reserveMs >= backend.reserveMs ? left - next.reserveMs : left;
        if (remaining < 1_000) break;
        const started = Date.now();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const res = await Promise.race([
            backend.complete({ system: opts.system, turns, temperature: opts.temperature ?? 0.8, signal: AbortSignal.timeout(remaining), mock: opts.mock }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(Object.assign(new Error("timed out"), { name: "TimeoutError" })), remaining);
            }),
          ]).finally(() => clearTimeout(timer));
          if (res.recited) {
            await log({ provider, model, status: "failed", latencyMs: Date.now() - started, inputTokens: res.inputTokens, outputTokens: null, error: "recitation" });
            return { text: "", backend, recited: true };
          }
          await log({ provider, model, status: tier === 0 ? "ok" : "fallback", latencyMs: Date.now() - started, inputTokens: res.inputTokens, outputTokens: res.outputTokens });
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
          // Too big for this model: the next tier, for this request only (no retry here, no cooldown for others).
          if (verdict.kind === "too_large") {
            await log({ provider, model, status: "retry", latencyMs: Date.now() - started, inputTokens: null, outputTokens: null, error: message });
            sawBusy = true;
            break;
          }
          // Out of quota or credits counts as busy (move on to the next tier, answer 503 with a refund), never as a bug.
          const busy = verdict.kind !== "fatal";
          await log({ provider, model, status: busy ? "retry" : "failed", latencyMs: Date.now() - started, inputTokens: null, outputTokens: null, error: message });
          if (!busy) {
            if (verdict.setup && !inSetupCooldown(backend)) {
              // The key or model is wrong: skip this provider for a while, and say so once in the server log.
              cooldownUntil.set(setupKey(backend), Date.now() + SETUP_COOLDOWN_MS);
              console.error(`[ai] ${provider} rejected its key or model (${model}): ${message}. Skipping it for ${SETUP_COOLDOWN_MS / 60_000} min.`);
            }
            // A later tier may still answer (the chain exists for this); only when none is left is this error the answer.
            lastFatal = err;
            break;
          }
          sawBusy = true;
          const cooldown = verdict.cooldownMs ?? null;
          // One operator line per billing cooldown per provider (not per model, nor per concurrent request).
          const newBillingCooldown = verdict.kind === "billing" && !inBillingCooldown(backend);
          if (cooldown !== null) {
            // Out of credits is the whole account (every model of this provider); a quota is per model.
            cooldownUntil.set(verdict.kind === "billing" ? providerKey(backend) : key(backend), Date.now() + cooldown);
          }
          if (newBillingCooldown) {
            // Needs a person: say so loudly in the server log (ai_calls has the full error too).
            console.error(`[ai] ${provider} says the account's prepaid credits are used up (${model}); ${BILLING_HELP[provider]}. Skipping it for ${Math.round((cooldown ?? 0) / 60_000)} min.`);
          }
          // Out of quota, or too slow: a second try won't help, go straight to the next tier. A quick "busy" gets one
          // retry per request.
          if (cooldown !== null || isTimeout(err) || retried) break;
          retried = true;
          await sleep(1_000);
        }
      }
    }
    // Every tier we tried failed with a setup or bad-request error (nothing was merely busy): that error is the answer.
    if (lastFatal !== undefined && !sawBusy) throw lastFatal;
    // Every model is out of quota: say when the first one is back (capped at an hour, since a free tier's daily reset
    // is hours away and a paid key may be added meanwhile).
    const waits = tiers.filter(coolingDown).map((b) => (cooldownEnd(b) - Date.now()) / 1000);
    const allOut = waits.length === tiers.length;
    throw new AiBusyError(allOut ? Math.min(3600, Math.ceil(Math.min(...waits))) : undefined, allOut && tiers.every(inBillingCooldown));
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
