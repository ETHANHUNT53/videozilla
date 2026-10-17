import "server-only";
import type { ClientSession } from "mongodb";
import { ApiError } from "../api/errors";
import { collections } from "../db/mongo";

/**
 * Daily usage limits (PRD §20.6, DB Design §4.17, §7.5): per user, per IST day. A counter is checked and incremented
 * in one database operation, so concurrent requests can't both take the last slot. See docs/features/F1.13.
 */

export const LIMITED_COUNTERS = ["storyboards", "revisions", "builds", "renders", "illustrations", "ideas"] as const;
export type LimitedCounter = (typeof LIMITED_COUNTERS)[number];
/** Counted for cost tracking, never limited. */
export type TrackedCounter = "voiceCharacters";
export type UsageCounter = LimitedCounter | TrackedCounter;

/** PRD §20.6 defaults; `ideas` (idea suggestions, briefs and idea chat together) was added in M2 (approved 2026-10-17). */
export const DEFAULT_LIMITS: Record<LimitedCounter, number> = { storyboards: 20, revisions: 100, builds: 15, renders: 10, illustrations: 40, ideas: 150 };

const LABELS: Record<LimitedCounter, string> = {
  storyboards: "storyboard generations",
  revisions: "revisions",
  builds: "video builds",
  renders: "renders",
  illustrations: "AI illustrations",
  ideas: "AI idea requests",
};

const IST_OFFSET_MS = 5.5 * 3600_000; // India has no daylight saving
const KEEP_DAYS = 40;

/** The IST calendar day of `now` (`YYYY-MM-DD`) and the moment it ends (next IST midnight). */
export function istDay(now = new Date()): { date: string; resetsAt: Date } {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const date = ist.toISOString().slice(0, 10);
  const resetsAt = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1) - IST_OFFSET_MS);
  return { date, resetsAt };
}

// Admin-wide overrides (config key "limits", DB Design §4.19), read through a 60-second cache.
let configCache: { at: number; value: Partial<Record<LimitedCounter, number>> } | null = null;
const CONFIG_TTL_MS = 60_000;

/** Forget the cached config (tests, or after an admin change). */
export function resetLimitsCache(): void {
  configCache = null;
}

function validLimits(raw: unknown): Partial<Record<LimitedCounter, number>> {
  if (!raw || typeof raw !== "object") return {};
  return Object.fromEntries(
    LIMITED_COUNTERS.filter((c) => Number.isInteger((raw as Record<string, unknown>)[c]) && ((raw as Record<string, number>)[c] ?? -1) >= 0).map((c) => [
      c,
      (raw as Record<string, number>)[c],
    ]),
  );
}

/** The user's limits: PRD defaults, then the admin-wide config, then the user's own override. */
export async function limitsFor(userId: string): Promise<Record<LimitedCounter, number>> {
  if (!configCache || Date.now() - configCache.at > CONFIG_TTL_MS) {
    const doc = await collections.config().findOne({ key: "limits" });
    configCache = { at: Date.now(), value: validLimits(doc?.value) };
  }
  const profile = await collections.profiles().findOne({ userId }, { projection: { limitsOverride: 1 } });
  return { ...DEFAULT_LIMITS, ...configCache.value, ...validLimits(profile?.limitsOverride) };
}

export interface UsageResult {
  counter: UsageCounter;
  used: number;
  limit: number | null;
  resetsAt: Date;
}

/**
 * Counts `amount` against today's `counter`, or throws `429 LIMIT_REACHED` (nothing counted) when that would pass the
 * limit. Pass `session` to make it part of the transaction that starts the work (DB Design §6.2, §6.8).
 *
 * Two steps, neither of which can fail with a duplicate key (a write error would abort the caller's transaction):
 * 1. make sure today's document exists: an upsert on exactly `{ userId, date }` (the unique index), which MongoDB
 *    retries by itself when two first requests of the day race;
 * 2. increment the counter only while it stays within the limit (no upsert). Matching nothing means the limit is
 *    reached. One atomic update, so concurrent requests can't both take the last slot.
 */
export async function consumeUsage(userId: string, counter: UsageCounter, opts: { amount?: number; session?: ClientSession; now?: Date } = {}): Promise<UsageResult> {
  const amount = opts.amount ?? 1;
  // A zero, negative, fractional or NaN amount would skip the check, lower the count or corrupt it.
  if (!Number.isInteger(amount) || amount < 1) throw new Error(`Usage amount must be a positive whole number (got ${amount} for ${counter})`);
  const { date, resetsAt } = istDay(opts.now);
  const limit = counter === "voiceCharacters" ? null : (await limitsFor(userId))[counter];
  const expiresAt = new Date(resetsAt.getTime() + KEEP_DAYS * 86_400_000);
  const session = opts.session;

  if (limit === null || amount <= limit) {
    await collections.usageCounters().updateOne({ userId, date }, { $setOnInsert: { userId, date, expiresAt } }, { upsert: true, session });
    // Within the limit after adding `amount`, or this counter not used yet today (the document exists for the day, but
    // maybe only with other counters).
    const room = limit === null ? {} : { $or: [{ [counter]: { $lte: limit - amount } }, { [counter]: { $exists: false } }] };
    const doc = await collections.usageCounters().findOneAndUpdate(
      { userId, date, ...room },
      { $inc: { [counter]: amount }, $set: { updatedAt: new Date() } },
      { returnDocument: "after", session },
    );
    if (doc) return { counter, used: doc[counter] as number, limit, resetsAt };
  }

  const current = await collections.usageCounters().findOne({ userId, date }, { session });
  const raw = current?.[counter];
  if (raw !== undefined && typeof raw !== "number") {
    // Not a real "limit reached": the stored count is broken. Fail loudly so it shows up in the logs.
    throw new Error(`Usage counter ${counter} for ${userId} on ${date} isn't a number (${JSON.stringify(raw)})`);
  }
  const used = raw ?? 0;
  throw new ApiError("LIMIT_REACHED", {
    message: `You've reached today's limit for ${LABELS[counter as LimitedCounter]}. It resets at midnight (IST).`,
    details: [{ field: counter, issue: `limit ${limit} per day reached`, counter, limit, used, resetsAt: resetsAt.toISOString() }],
    retryAfterSec: Math.max(1, Math.ceil((resetsAt.getTime() - (opts.now ?? new Date()).getTime()) / 1000)),
  });
}

/** `GET /api/v1/me/usage` (API Design §13.1): today's counts and limits. */
export async function getUsage(userId: string, now = new Date()) {
  const { date, resetsAt } = istDay(now);
  const [limits, doc] = await Promise.all([limitsFor(userId), collections.usageCounters().findOne({ userId, date })]);
  return {
    date,
    resetsAt: resetsAt.toISOString(),
    counters: Object.fromEntries(LIMITED_COUNTERS.map((c) => [c, { used: (doc?.[c] as number | undefined) ?? 0, limit: limits[c] }])) as Record<LimitedCounter, { used: number; limit: number }>,
  };
}

/** IETF draft RateLimit headers for a limited endpoint's response (API Design §11). */
export function rateLimitHeaders(u: UsageResult, now = new Date()): Record<string, string> {
  if (u.limit === null) return {};
  return {
    "RateLimit-Limit": String(u.limit),
    "RateLimit-Remaining": String(Math.max(0, u.limit - u.used)),
    "RateLimit-Reset": String(Math.max(0, Math.ceil((u.resetsAt.getTime() - now.getTime()) / 1000))),
  };
}
