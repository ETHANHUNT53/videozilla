/**
 * What `generateJson` needs from an AI provider: send one request, get the reply text back. Retries, the deadline,
 * cooldowns, the repair round and logging stay in `generateJson`, the same for every provider.
 */

/** Who answered a call (recorded in `ai_calls`). */
export type AiProvider = "gemini" | "groq" | "openrouter";

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
  complete(req: { system: string; turns: ChatTurn[]; temperature: number; signal: AbortSignal }): Promise<BackendReply>;
}

/** The AI stayed busy (or slow) past the deadline, on every model. Retry later. */
export class AiBusyError extends Error {
  constructor(readonly retryAfterSec = 30) {
    super("The AI is busy");
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
 * - `fatal`: a setup problem (bad key, bad request), thrown at once.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: "busy" | "quota" | "billing" | "bad_json" | "fatal",
    readonly extra: { cooldownMs?: number; text?: string } = {},
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
