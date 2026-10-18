import { AiBlockedError, ProviderError, type AiProvider, type Backend } from "./backend";

/**
 * One adapter for OpenAI-compatible chat APIs: Groq (main in development) and OpenRouter (backup). Plain `fetch`, no
 * SDK: the official SDK retries on its own, which would fight `generateJson`'s retry and deadline logic.
 * Docs checked 2026-10-18: console.groq.com/docs (structured outputs, rate limits, errors, reasoning) and
 * openrouter.ai/docs (limits, errors, structured outputs, provider routing).
 */

export interface OpenAiCompatConfig {
  provider: Exclude<AiProvider, "gemini">;
  baseUrl: string;
  apiKey: string;
  model: string;
  reserveMs: number;
  /** Name of the env setting that holds the key, for error messages. */
  keyName: string;
  headers?: Record<string, string>;
  /** Provider-specific request fields (OpenRouter's routing options). */
  body?: Record<string, unknown>;
}

const MAX_OUTPUT_TOKENS = 4096;
const MIN_COOLDOWN_MS = 10_000;
const MAX_COOLDOWN_MS = 24 * 3600_000;
/** How long to skip a model whose account is out of credits: a top-up is a manual step. */
export const BILLING_COOLDOWN_MS = 30 * 60_000;

/**
 * Per-model request settings (Groq). gpt-oss reasons before answering; these short creative tasks don't need much of
 * it, and hiding the reasoning keeps it out of `content`. Qwen 3.8 can skip reasoning altogether.
 */
function modelParams(provider: OpenAiCompatConfig["provider"], model: string): Record<string, unknown> {
  if (provider !== "groq") return {};
  if (model.startsWith("openai/gpt-oss")) return { reasoning_effort: "low", include_reasoning: false };
  if (model.startsWith("qwen/qwen3")) return { reasoning_effort: "none" };
  return {};
}

export function openAiCompatBackend(cfg: OpenAiCompatConfig): Backend {
  return {
    provider: cfg.provider,
    model: cfg.model,
    reserveMs: cfg.reserveMs,
    async complete({ system, turns, temperature, signal }) {
      const body = {
        model: cfg.model,
        messages: [{ role: "system", content: system }, ...turns.map((t) => ({ role: t.role === "model" ? "assistant" : "user", content: t.text }))],
        response_format: { type: "json_object" },
        temperature,
        // Groq's current name for the output cap; OpenRouter's is max_tokens.
        [cfg.provider === "groq" ? "max_completion_tokens" : "max_tokens"]: MAX_OUTPUT_TOKENS,
        ...modelParams(cfg.provider, cfg.model),
        ...cfg.body,
      };
      let res: Response;
      try {
        res = await fetch(`${cfg.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json", ...cfg.headers },
          body: JSON.stringify(body),
          signal,
        });
      } catch (err) {
        const name = (err as Error)?.name;
        if (name === "AbortError" || name === "TimeoutError") throw err;
        throw new ProviderError(`${cfg.provider}: network error: ${(err as Error)?.message ?? err}`, "busy");
      }
      const raw = await res.text();
      let json: ApiReply | null = null;
      try {
        json = JSON.parse(raw) as ApiReply;
      } catch {
        // Not JSON (an HTML error page from a proxy): judged by the status below.
      }
      if (!res.ok) throw httpError(cfg, res.status, res.headers, json, raw);
      // OpenRouter answers 200 once a host accepts the request, so a later failure comes as a 200 with only `error`.
      if (json?.error) throw httpError(cfg, Number(json.error.code) || 502, res.headers, json, raw);
      const choice = json?.choices?.[0];
      if (!choice) throw new ProviderError(`${cfg.provider}: reply without choices`, "busy");
      if (choice.finish_reason === "error" || choice.error) throw new ProviderError(`${cfg.provider}: ${choice.error?.message ?? "the reply failed midway"}`, "busy");
      return { text: choice.message?.content ?? "", inputTokens: json?.usage?.prompt_tokens ?? null, outputTokens: json?.usage?.completion_tokens ?? null };
    },
  };
}

interface ApiError {
  code?: number | string;
  message?: string;
  type?: string;
  /** Groq: the text the model wrote when it wasn't valid JSON (code json_validate_failed). */
  failed_generation?: string;
  metadata?: { error_type?: string; limit_source?: string; provider_name?: string; raw?: unknown };
}
interface ApiReply {
  error?: ApiError;
  choices?: { message?: { content?: string | null }; finish_reason?: string; error?: { message?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Sorts an HTTP error into what `generateJson` should do about it (see `ProviderError`). */
export function httpError(cfg: Pick<OpenAiCompatConfig, "provider" | "keyName">, status: number, headers: Headers, json: ApiReply | null, raw: string): Error {
  const e = json?.error;
  const message = `${cfg.provider} ${status}: ${String(e?.message ?? raw).slice(0, 300)}`;
  const type = e?.metadata?.error_type ?? "";

  if (status === 402) {
    // OpenRouter: too many paid requests in flight is a short wait; otherwise the account needs credits.
    if (e?.metadata?.limit_source === "openrouter_in_flight_budget") return new ProviderError(message, "busy");
    return new ProviderError(message, "billing", { cooldownMs: BILLING_COOLDOWN_MS });
  }
  if (status === 429) {
    // A host behind OpenRouter rate-limited us (not our own limit): a busy model, no cooldown.
    if (cfg.provider === "openrouter" && (e?.metadata?.provider_name || e?.metadata?.raw)) return new ProviderError(message, "busy");
    return new ProviderError(message, "quota", { cooldownMs: rateLimitCooldownMs(headers, String(e?.message ?? raw)) });
  }
  if (status === 400 && (e?.code === "json_validate_failed" || typeof e?.failed_generation === "string")) {
    return new ProviderError(message, "bad_json", { text: e?.failed_generation ?? "" });
  }
  if (status === 403 && (type === "content_policy_violation" || type === "refusal" || /moderation|flagged|content policy/i.test(String(e?.message)))) {
    return new AiBlockedError(`${cfg.provider} moderation`);
  }
  if (status === 408 || status === 422 || status === 498 || status >= 500) return new ProviderError(message, "busy");
  if (status === 401 || status === 403) return new ProviderError(`${message} (check ${cfg.keyName} in apps/web/.env.local)`, "fatal");
  return new ProviderError(message, "fatal");
}

/**
 * How long to skip a rate-limited model: the provider's own `retry-after` (seconds), else OpenRouter's
 * `X-RateLimit-Reset` (epoch ms), else Groq's "try again in 2m59.56s", else 30 min for a daily cap and 1 min otherwise.
 */
export function rateLimitCooldownMs(headers: Headers, message: string): number {
  let ms: number | null = null;
  const after = Number(headers.get("retry-after"));
  if (headers.get("retry-after") && Number.isFinite(after)) ms = after * 1000;
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (ms === null && reset > 1e12) ms = reset - Date.now();
  const again = message.match(/try again in ((?:\d+(?:\.\d+)?(?:ms|h|m|s))+)/i);
  if (ms === null && again) ms = durationMs(again[1]);
  if (ms === null) ms = /per day|\(RPD\)|\(TPD\)|per-day|daily/i.test(message) ? 30 * 60_000 : 60_000;
  return Math.min(Math.max(ms, MIN_COOLDOWN_MS), MAX_COOLDOWN_MS);
}

/** "2m59.56s" → 179560. */
function durationMs(text: string): number {
  let ms = 0;
  for (const [, n, unit] of text.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) ms += Number(n) * { ms: 1, s: 1000, m: 60_000, h: 3600_000 }[unit as "ms" | "s" | "m" | "h"];
  return ms;
}
