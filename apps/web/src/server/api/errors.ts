/**
 * API error catalogue and format (API Design §7). Clients branch on `code`, never on `message`.
 * Internal details (stack traces, provider payloads, database errors) are never put in a response.
 */

const CATALOGUE = {
  VALIDATION_FAILED: [400, false, "Some of the information sent isn't valid."],
  INVALID_CURSOR: [400, false, "This page link has expired. Reload the list."],
  UNAUTHENTICATED: [401, false, "Please sign in to continue."],
  ORIGIN_NOT_ALLOWED: [403, false, "This request came from a page we don't recognise."],
  FORBIDDEN: [403, false, "You don't have access to this."],
  NOT_FOUND: [404, false, "We couldn't find that."],
  METHOD_NOT_ALLOWED: [405, false, "That action isn't supported here."],
  INVALID_STATE: [409, false, "That can't be done right now."],
  RUN_IN_PROGRESS: [409, false, "This is already in progress."],
  PUBLISH_IN_PROGRESS: [409, true, "This video is being posted to Instagram. Try again in a moment."],
  ALREADY_POSTED: [409, false, "This video was already posted. Duplicate it to post again."],
  EXPORT_OUTDATED: [409, false, "The video changed after it was exported. Export it again first."],
  INSTAGRAM_ALREADY_LINKED: [409, false, "That Instagram account is connected to another Videozilla account."],
  INSTAGRAM_NOT_CONNECTED: [409, false, "Connect your Instagram account first."],
  IG_RECONNECT_REQUIRED: [409, false, "Reconnect your Instagram account to continue."],
  PRECONDITION_FAILED: [412, false, "This was changed in another tab. Reload to see the latest version."],
  PAYLOAD_TOO_LARGE: [413, false, "That's too much to send at once."],
  UNSUPPORTED_MEDIA_TYPE: [415, false, "Requests must be sent as JSON."],
  IDEMPOTENCY_KEY_REUSED: [422, false, "This request key was already used for a different request."],
  UNSAFE_CONTENT: [422, false, "We can't make a video about that."],
  INSTAGRAM_NOT_ELIGIBLE: [422, false, "Only Instagram Creator or Business accounts can post Reels."],
  SCHEDULE_OUT_OF_RANGE: [422, false, "Pick a time between 10 minutes and 75 days from now."],
  CAPTION_INVALID: [422, false, "The caption is too long or has too many hashtags or mentions."],
  RATE_LIMITED: [429, true, "You're going a bit fast. Try again in a moment."],
  LIMIT_REACHED: [429, true, "You've reached today's limit."],
  INTERNAL: [500, true, "Something went wrong on our side. Please try again."],
  UPSTREAM_FAILED: [502, true, "A service we depend on had a problem. Please try again."],
  AI_BUSY: [503, true, "The AI is busy right now. Please try again in a minute."],
  VOICE_PLAN_REQUIRED: [503, false, "Voiceovers are paused until the voice plan is upgraded."],
  MAINTENANCE: [503, true, "Videozilla is being updated. Please try again shortly."],
} as const satisfies Record<string, readonly [number, boolean, string]>;

export type ErrorCode = keyof typeof CATALOGUE;

export interface ErrorDetail {
  field?: string;
  issue: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly details: ErrorDetail[];
  readonly retryAfterSec: number | null;
  /** Extra response headers (e.g. RateLimit-* on 429 LIMIT_REACHED). */
  readonly headers: Record<string, string>;

  constructor(
    readonly code: ErrorCode,
    opts: { message?: string; details?: ErrorDetail[]; retryAfterSec?: number; headers?: Record<string, string> } = {},
  ) {
    const [status, retryable, message] = CATALOGUE[code];
    super(opts.message ?? message);
    this.name = "ApiError";
    this.status = status;
    this.retryable = retryable;
    this.details = opts.details ?? [];
    this.retryAfterSec = opts.retryAfterSec ?? null;
    this.headers = opts.headers ?? {};
  }
}

/** The JSON error body of API Design §7.1. */
export function errorBody(err: ApiError, requestId: string) {
  return {
    error: {
      code: err.code,
      message: err.message,
      details: err.details,
      requestId,
      retryable: err.retryable,
      retryAfterSec: err.retryAfterSec,
    },
  };
}
