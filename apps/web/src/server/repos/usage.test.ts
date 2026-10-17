import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/mongo", async () => (await import("../../../test/mongo")).mongoModule);
const sessionUser = vi.hoisted(() => vi.fn());
vi.mock("../api/session", () => ({ sessionUser }));

import { GET } from "@/app/api/v1/me/usage/route";
import { clearCollections, mongoModule, startTestMongo, stopTestMongo, testMongo } from "../../../test/mongo";
import { ApiError } from "../api/errors";
import { consumeUsage, DEFAULT_LIMITS, getUsage, istDay, limitsFor, rateLimitHeaders, resetLimitsCache } from "./usage";

const ME = "6ad20f12aa355a5a9f3db9cb";
const APP = "http://localhost:3000";
const NOON_IST = new Date("2026-10-17T06:30:00.000Z"); // 12:00 IST on 17 Oct

beforeAll(startTestMongo, 120_000);
afterAll(stopTestMongo);
beforeEach(async () => {
  await clearCollections(["usage_counters", "config", "profiles"]);
  resetLimitsCache();
  sessionUser.mockReset().mockResolvedValue({ id: ME, name: "Asha", email: "asha@example.com", emailVerified: true, image: null, createdAt: new Date() });
  vi.stubEnv("BETTER_AUTH_URL", APP);
});

async function limitError(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (err) {
    return err as ApiError;
  }
  throw new Error("expected LIMIT_REACHED");
}

describe("istDay", () => {
  it("uses the Indian calendar day and resets at IST midnight (18:30 UTC)", () => {
    expect(istDay(new Date("2026-10-17T18:29:59.000Z"))).toEqual({ date: "2026-10-17", resetsAt: new Date("2026-10-17T18:30:00.000Z") });
    expect(istDay(new Date("2026-10-17T18:30:00.000Z"))).toEqual({ date: "2026-10-18", resetsAt: new Date("2026-10-18T18:30:00.000Z") });
    expect(istDay(new Date("2026-12-31T20:00:00.000Z")).date).toBe("2027-01-01");
  });
});

describe("consumeUsage", () => {
  it("counts up to the limit, then refuses with 429 LIMIT_REACHED and counts nothing more", async () => {
    for (let i = 1; i <= DEFAULT_LIMITS.renders; i++) expect((await consumeUsage(ME, "renders", { now: NOON_IST })).used).toBe(i);
    const err = await limitError(consumeUsage(ME, "renders", { now: NOON_IST }));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "LIMIT_REACHED", status: 429, retryable: true, retryAfterSec: 12 * 3600 });
    expect(err.message).toBe("You've reached today's limit for renders. It resets at midnight (IST).");
    expect(err.details[0]).toMatchObject({ counter: "renders", limit: 10, used: 10, resetsAt: "2026-10-17T18:30:00.000Z" });
    expect((await testMongo.db.collection("usage_counters").findOne({ userId: ME }))!.renders).toBe(10);
  });

  it("lets every counter start on a day that already has a record for another one", async () => {
    await consumeUsage(ME, "storyboards", { now: NOON_IST });
    expect((await consumeUsage(ME, "renders", { now: NOON_IST })).used).toBe(1);
    expect((await consumeUsage(ME, "builds", { now: NOON_IST })).used).toBe(1);
    expect(await testMongo.db.collection("usage_counters").countDocuments({ userId: ME })).toBe(1);
  });

  it("never lets concurrent requests pass the limit", async () => {
    const results = await Promise.allSettled(Array.from({ length: 15 }, () => consumeUsage(ME, "renders", { now: NOON_IST })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(results.filter((r) => r.status === "rejected").every((r) => ((r as PromiseRejectedResult).reason as ApiError).code === "LIMIT_REACHED")).toBe(true);
    expect((await testMongo.db.collection("usage_counters").findOne({ userId: ME }))!.renders).toBe(10);
  });

  it("starts again the next IST day, and keeps each day's record for 40 days", async () => {
    for (let i = 0; i < 10; i++) await consumeUsage(ME, "renders", { now: NOON_IST });
    const tomorrow = new Date(NOON_IST.getTime() + 86_400_000);
    expect((await consumeUsage(ME, "renders", { now: tomorrow })).used).toBe(1);
    const day = await testMongo.db.collection("usage_counters").findOne({ userId: ME, date: "2026-10-17" });
    expect(day!.expiresAt).toEqual(new Date("2026-11-26T18:30:00.000Z"));
  });

  it("adds amounts, and never limits voice characters", async () => {
    expect((await consumeUsage(ME, "voiceCharacters", { amount: 900, now: NOON_IST })).used).toBe(900);
    expect((await consumeUsage(ME, "voiceCharacters", { amount: 100_000, now: NOON_IST })).used).toBe(100_900);
    await limitError(consumeUsage(ME, "illustrations", { amount: 41, now: NOON_IST }));
    expect(await testMongo.db.collection("usage_counters").countDocuments({ userId: ME, illustrations: { $exists: true } })).toBe(0);
  });

  it("can be part of a transaction: if the work fails to start, nothing is counted", async () => {
    await expect(
      mongoModule.withTransaction(async (session) => {
        await consumeUsage(ME, "storyboards", { session, now: NOON_IST });
        throw new Error("run insert failed");
      }),
    ).rejects.toThrow("run insert failed");
    expect(await testMongo.db.collection("usage_counters").countDocuments({ userId: ME })).toBe(0);
  });
});

describe("limits", () => {
  it("default to PRD §20.6, then the admin config, then the user's override (invalid values ignored)", async () => {
    expect(await limitsFor(ME)).toEqual({ storyboards: 20, revisions: 100, builds: 15, renders: 10, illustrations: 40 });
    await testMongo.db.collection("config").insertOne({ key: "limits", value: { renders: 5, builds: -1, storyboards: "lots" } });
    resetLimitsCache();
    expect(await limitsFor(ME)).toMatchObject({ renders: 5, builds: 15, storyboards: 20 });
    await testMongo.db.collection("profiles").insertOne({ userId: ME, limitsOverride: { renders: 50 } }, { bypassDocumentValidation: true });
    expect((await limitsFor(ME)).renders).toBe(50);
  });

  it("apply to consumeUsage", async () => {
    await testMongo.db.collection("profiles").insertOne({ userId: ME, limitsOverride: { builds: 1 } }, { bypassDocumentValidation: true });
    await consumeUsage(ME, "builds", { now: NOON_IST });
    expect((await limitError(consumeUsage(ME, "builds", { now: NOON_IST }))).details[0]).toMatchObject({ limit: 1, used: 1 });
  });
});

describe("GET /api/v1/me/usage", () => {
  it("returns today's used and limit for every limited counter", async () => {
    await consumeUsage(ME, "storyboards");
    await consumeUsage(ME, "storyboards");
    const res = await GET(new Request(`${APP}/api/v1/me/usage`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.date).toBe(istDay().date);
    expect(body.resetsAt).toBe(istDay().resetsAt.toISOString());
    expect(body.counters).toEqual({
      storyboards: { used: 2, limit: 20 },
      revisions: { used: 0, limit: 100 },
      builds: { used: 0, limit: 15 },
      renders: { used: 0, limit: 10 },
      illustrations: { used: 0, limit: 40 },
    });
  });

  it("needs a verified user", async () => {
    sessionUser.mockResolvedValue(null);
    expect((await GET(new Request(`${APP}/api/v1/me/usage`))).status).toBe(401);
  });

  it("matches getUsage", async () => {
    expect(await getUsage(ME, NOON_IST)).toMatchObject({ date: "2026-10-17", resetsAt: "2026-10-17T18:30:00.000Z" });
  });
});

describe("rateLimitHeaders", () => {
  it("say how many are left and when the day resets", () => {
    const resetsAt = new Date("2026-10-17T18:30:00.000Z");
    expect(rateLimitHeaders({ counter: "renders", used: 8, limit: 10, resetsAt }, NOON_IST)).toEqual({ "RateLimit-Limit": "10", "RateLimit-Remaining": "2", "RateLimit-Reset": String(12 * 3600) });
    expect(rateLimitHeaders({ counter: "voiceCharacters", used: 5, limit: null, resetsAt }, NOON_IST)).toEqual({});
  });
});
