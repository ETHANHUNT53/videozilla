import { GoogleGenAI } from "@google/genai";
import type { ZodType } from "zod";

/**
 * One structured Gemini call for the interactive features (idea suggestions, briefs, idea chat — System Design §8.1,
 * §8.2): JSON output checked with a Zod schema (one repair round), a quick retry when the model is busy, then the
 * fallback model, all inside a deadline (15 s by default) so the request never hangs. Every call is reported through
 * `onCall` for the `ai_calls` log.
 */

export const DEFAULT_FAST_MODEL = "gemini-3.8-flash";
export const DEFAULT_FALLBACK_MODEL = "gemini-3.5-flash-lite";

export interface AiCallLog {
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

/** Gemini stayed busy (or slow) past the deadline, on both models. Retry later. */
export class AiBusyError extends Error {
  constructor(readonly retryAfterSec = 30) {
    super("Gemini is busy");
    this.name = "AiBusyError";
  }
}

/** Gemini answered, but not with JSON of the right shape, even after the repair round. */
export class AiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiOutputError";
  }
}

const BUSY = /\b(429|500|502|503|504)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|overloaded|high demand|timed? ?out|aborted/i;
const isBusy = (err: unknown) => BUSY.test(String((err as Error)?.message ?? err)) || (err as Error)?.name === "AbortError" || (err as Error)?.name === "TimeoutError";
const isTimeout = (err: unknown) => (err as Error)?.name === "TimeoutError" || (err as Error)?.name === "AbortError" || /timed? ?out|aborted/i.test(String((err as Error)?.message));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Time kept back for the fallback model while the main one runs. Measured 2026-10-17 on the free tier, for 5 Hindi
 * idea cards: gemini-3.8-flash 9–12 s even with thinking at LOW (15 s at its default), gemini-3.5-flash-lite ~2 s.
 */
const FALLBACK_RESERVE_MS = 4_000;

/**
 * Per-model generation settings. gemini-3.8-flash thinks at length by default (≈1,100 thought tokens, +5 s here);
 * these short creative tasks don't need it. Models not listed get the API defaults (some reject thinking settings).
 */
const MODEL_CONFIG: Record<string, Record<string, unknown>> = {
  "gemini-3.8-flash": { thinkingConfig: { thinkingLevel: "LOW" } },
};

export async function generateJson<T>(opts: GenerateJsonOptions<T>): Promise<{ data: T; model: string }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing. Add it to apps/web/.env.local (see .env.example).");
  const ai = new GoogleGenAI({ apiKey });
  const primary = process.env.GEMINI_FAST_MODEL || DEFAULT_FAST_MODEL;
  const fallback = process.env.GEMINI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;
  // Two tries on the main model (the second after a short pause, only if the first failed fast), then the fallback.
  const hasFallback = Boolean(fallback) && fallback !== primary;
  const plan = hasFallback ? [primary, primary, fallback] : [primary, primary];
  const deadline = Date.now() + (opts.deadlineMs ?? 15_000);
  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [{ role: "user", parts: [{ text: opts.prompt }] }];
  const log = async (entry: AiCallLog) => {
    try {
      await opts.onCall?.(entry);
    } catch {
      // Logging must never break the feature.
    }
  };

  let step = 0; // position in `plan`; a busy model moves us on, and we stay there for the repair round
  const call = async (): Promise<{ text: string; model: string }> => {
    for (; step < plan.length; step++) {
      const model = plan[step];
      // The main model never uses the fallback's reserved time.
      const remaining = deadline - Date.now() - (model === primary && hasFallback ? FALLBACK_RESERVE_MS : 0);
      if (remaining < 1_000) continue;
      const started = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const res = await Promise.race([
          ai.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: opts.system,
              responseMimeType: "application/json",
              temperature: opts.temperature ?? 0.8,
              ...MODEL_CONFIG[model],
              abortSignal: AbortSignal.timeout(remaining),
            },
          }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error("timed out"), { name: "TimeoutError" })), remaining);
          }),
        ]).finally(() => clearTimeout(timer));
        await log({
          model,
          status: model === primary ? "ok" : "fallback",
          latencyMs: Date.now() - started,
          inputTokens: res.usageMetadata?.promptTokenCount ?? null,
          outputTokens: res.usageMetadata?.candidatesTokenCount ?? null,
        });
        return { text: res.text ?? "", model };
      } catch (err) {
        const busy = isBusy(err);
        await log({ model, status: busy ? "retry" : "failed", latencyMs: Date.now() - started, inputTokens: null, outputTokens: null, error: String((err as Error)?.message ?? err).slice(0, 300) });
        if (!busy) throw err;
        // A slow model won't be faster on a second try: go straight to the fallback. A quick "busy" gets one retry.
        if (model === primary && isTimeout(err)) step = hasFallback ? plan.length - 2 : plan.length - 1;
        else if (step === 0) await sleep(1_000);
      }
    }
    throw new AiBusyError();
  };

  let problem = "";
  for (let round = 0; round < 2; round++) {
    const { text, model } = await call();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      problem = "The reply was not valid JSON.";
      contents.push({ role: "model", parts: [{ text }] }, { role: "user", parts: [{ text: `${problem} Return only the JSON object.` }] });
      continue;
    }
    const result = opts.schema.safeParse(parsed);
    if (result.success) return { data: result.data, model };
    problem = result.error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    contents.push(
      { role: "model", parts: [{ text }] },
      { role: "user", parts: [{ text: `The JSON did not match the required shape: ${problem}. Fix it and return the full corrected JSON only.` }] },
    );
  }
  throw new AiOutputError(`Gemini's reply didn't match the expected shape: ${problem}`);
}
