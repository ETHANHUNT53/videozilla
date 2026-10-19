/**
 * What `generateJson` needs from an AI provider: send one request, get the reply text back. Retries, the deadline,
 * cooldowns, the repair round and logging stay in `generateJson`, the same for every provider.
 */

/** Who answered a call (recorded in `ai_calls`). */
export type AiProvider = "gemini" | "groq" | "openrouter" | "mock";

/** One turn of the conversation after the system prompt (the repair round adds model + user turns). */
export interface ChatTurn {
  role: "user" | "model";
  text: string;
}

export interface BackendReply {
  text: string;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Gemini stopped the reply because it repeated existing text (worth one more try in own words). */
  recited?: boolean;
}

export interface Backend {
  provider: AiProvider;
  model: string;
  /** Time kept back for this backend when it's the fallback, while the main model runs. */
  reserveMs: number;
  /**
   * About how long this model needs for our requests. While it runs, every later tier's reserve is kept back only if
   * that still leaves it this much; otherwise only the next tier's (see `generateJson`).
   */
  typicalMs: number;
  complete(req: { system: string; turns: ChatTurn[]; temperature: number; signal: AbortSignal; mock?: () => unknown }): Promise<BackendReply>;
}

/**
 * The AI stayed busy (or slow) past the deadline, on every model. Retry later. `unavailable`: every model is skipped
 * because its account is out of credits (402), so it won't come back in a minute; a person has to top up billing.
 */
export class AiBusyError extends Error {
  constructor(
    readonly retryAfterSec = 30,
    readonly unavailable = false,
  ) {
    super(unavailable ? "The AI is unavailable (out of credits)" : "The AI is busy");
    this.name = "AiBusyError";
  }
}

/**
 * The provider's own safety systems blocked the prompt or the reply (Gemini's block reasons, OpenRouter's moderation).
 * Not worth retrying: the same request is blocked again. The app answers it like a refusal (422 UNSAFE_CONTENT).
 */
export class AiBlockedError extends Error {
  constructor(
    readonly reason: string,
    readonly inputTokens: number | null = null,
  ) {
    super(`The AI provider blocked the request (${reason})`);
    this.name = "AiBlockedError";
  }
}

/** The model answered, but not with JSON of the right shape, even after the repair round. */
export class AiOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiOutputError";
  }
}

/**
 * A provider error already sorted by what to do about it (the OpenAI-compatible adapter sorts its HTTP errors; Gemini's
 * are sorted by their message in `generateJson`):
 * - `busy`: try again / move on to the fallback;
 * - `quota`, `billing`: skip this model for `cooldownMs`;
 * - `bad_json`: the model wrote text that isn't JSON (`text`); goes to the repair round like an unparsable reply;
 * - `too_large`: this request is bigger than the model's limit (Groq's 413 against its whole per-minute token limit),
 *   so it can never fit there: move on to the next tier for this request only, with no retry and no cooldown (other,
 *   smaller requests still fit);
 * - `fatal`: a setup problem (bad key, bad request). `setup: true` when it's the provider's setup (key rejected, model
 *   unknown), which no request can fix: the chain skips that provider for a while and moves on. Other fatal errors
 *   (a bad request) move on to the next tier without a cooldown, and are thrown when no tier is left.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "busy" | "quota" | "billing" | "bad_json" | "too_large" | "fatal",
    readonly extra: { cooldownMs?: number; text?: string; setup?: boolean } = {},
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
