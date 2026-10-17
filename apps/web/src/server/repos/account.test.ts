import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/mongo", async () => (await import("../../../test/mongo")).mongoModule);
const send = vi.hoisted(() => vi.fn());
vi.mock("../jobs/inngest", () => ({ inngest: { send, createFunction: (config: unknown, fn: unknown) => ({ config, fn }) } }));
const deletePrefix = vi.hoisted(() => vi.fn(async () => 3));
vi.mock("../storage/r2", () => ({ deletePrefix, userPrefix: (id: string) => `users/${id}/` }));

import { clearCollections, startTestMongo, stopTestMongo, testMongo } from "../../../test/mongo";
import { functions } from "../jobs/functions";
import { accountDeletionSteps, purgeOrphanedUserData, requestAccountDataDeletion } from "../jobs/account-deletion";
import { cancelUserActivity, deleteUserCollection, findOrphanedUserIds, ORPHAN_GRACE_MS, USER_DATA_COLLECTIONS, userExists } from "./account";

/** Runs every deletion step in order, as the job does (inline). */
const deleteUserData = async (userId: string) => {
  const results: Record<string, unknown> = {};
  for (const s of accountDeletionSteps(userId)) results[s.id] = await s.run();
  return results;
};
const r2On = () => {
  vi.stubEnv("R2_ACCOUNT_ID", "a");
  vi.stubEnv("R2_ACCESS_KEY_ID", "b");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "c");
  vi.stubEnv("R2_BUCKET", "d");
};

const GONE = new ObjectId().toHexString(); // a user whose account was deleted
const ACTIVE = new ObjectId().toHexString(); // a user who still exists
const now = new Date();

beforeAll(startTestMongo, 120_000);
afterAll(stopTestMongo);
beforeEach(async () => {
  await clearCollections([...USER_DATA_COLLECTIONS, "user", "verification"]);
  await testMongo.db.collection("user").insertOne({ _id: new ObjectId(ACTIVE), email: "active@example.com", name: "Active", emailVerified: true });
  send.mockReset();
  deletePrefix.mockClear();
});

/**
 * Documents for `userId` in every user collection: `perCollection` each, but one profile (unique per user). Validators
 * are bypassed (the shape doesn't matter here); fields in unique indexes get unique values.
 */
async function seedEverything(userId: string, perCollection = 2) {
  for (const name of USER_DATA_COLLECTIONS) {
    const n = name === "profiles" ? 1 : perCollection;
    const docs = Array.from({ length: n }, (_, i) => {
      const uid = new ObjectId().toHexString();
      return { userId, createdAt: now, idempotencyKey: uid, renderId: new ObjectId(), projectId: new ObjectId(), hash: uid, version: i + 1, date: uid, key: uid, sceneId: uid, textHash: uid };
    });
    await testMongo.db.collection(name).insertMany(docs, { bypassDocumentValidation: true });
  }
}

/** How many documents seedEverything(userId, 2) creates. */
const SEEDED = 2 * (USER_DATA_COLLECTIONS.length - 1) + 1;

const countFor = async (userId: string) => {
  let total = 0;
  for (const name of USER_DATA_COLLECTIONS) total += await testMongo.db.collection(name).countDocuments({ userId });
  return total;
};

describe("deleteUserData", () => {
  it("deletes every user-owned document of a deleted account, and nobody else's", async () => {
    await seedEverything(GONE);
    await seedEverything(ACTIVE);
    const results = await deleteUserData(GONE);
    expect(results).toMatchObject({ "delete-projects": 2, "delete-profiles": 1, "delete-pipeline_runs": 2 });
    expect(await countFor(GONE)).toBe(0);
    expect(await countFor(ACTIVE)).toBe(SEEDED);
  });

  it("works in batches and is safe to run again", async () => {
    await testMongo.db.collection("notifications").insertMany(Array.from({ length: 23 }, () => ({ userId: GONE, createdAt: now })), { bypassDocumentValidation: true });
    expect(await deleteUserCollection(GONE, "notifications", 5)).toBe(23);
    expect(await deleteUserCollection(GONE, "notifications", 5)).toBe(0);
  });

  it("refuses while the account still exists", async () => {
    await seedEverything(ACTIVE);
    await expect(deleteUserData(ACTIVE)).rejects.toThrow("the account still exists");
    expect(await countFor(ACTIVE)).toBe(SEEDED);
  });

  it("covers every collection that holds user data", () => {
    expect([...USER_DATA_COLLECTIONS].sort()).toEqual(
      ["ai_calls", "chat_messages", "idea_sessions", "instagram_accounts", "notifications", "pipeline_runs", "profiles", "projects", "publish_jobs", "render_jobs", "renders", "storyboard_versions", "timelines", "usage_counters", "voice_tracks"].sort(),
    );
    expect(USER_DATA_COLLECTIONS.at(-1)).toBe("profiles"); // the sweep finds leftovers through profiles, so it goes last
  });

  it("cancels queued work first and deletes the files before the profile, so the sweep can still retry them", () => {
    r2On();
    const ids = accountDeletionSteps(GONE).map((s) => s.id);
    expect(ids[0]).toBe("cancel-activity");
    expect(ids.at(-1)).toBe("delete-profiles");
    expect(ids.indexOf("delete-files")).toBeGreaterThan(ids.indexOf("delete-projects"));
    expect(ids.indexOf("delete-files")).toBeLessThan(ids.indexOf("delete-profiles"));
    expect(ids).toContain("delete-auth-tokens");
  });

  it("also deletes Better Auth's leftover reset / delete-account tokens of the user", async () => {
    await testMongo.db.collection("verification").insertMany([
      { identifier: "reset-password:abc", value: GONE, expiresAt: now },
      { identifier: "delete-account-def", value: GONE, expiresAt: now },
      { identifier: "reset-password:xyz", value: ACTIVE, expiresAt: now },
    ]);
    await deleteUserData(GONE);
    expect(await testMongo.db.collection("verification").countDocuments({ value: GONE })).toBe(0);
    expect(await testMongo.db.collection("verification").countDocuments({ value: ACTIVE })).toBe(1);
  });
});

describe("cancelUserActivity", () => {
  it("refuses while the account still exists (a failed account deletion must not cancel scheduled posts)", async () => {
    await expect(cancelUserActivity(ACTIVE)).rejects.toThrow("the account still exists");
  });

  it("cancels active runs, scheduled posts and queued renders, and leaves finished ones", async () => {
    const insert = (name: string, docs: object[]) => testMongo.db.collection(name).insertMany(docs, { bypassDocumentValidation: true });
    const k = () => ({ idempotencyKey: new ObjectId().toHexString(), renderId: new ObjectId(), projectId: new ObjectId() });
    await insert("pipeline_runs", [
      { ...k(), userId: GONE, status: "running", active: true },
      { ...k(), userId: GONE, status: "succeeded", active: false },
      { ...k(), userId: ACTIVE, status: "running", active: true },
    ]);
    await insert("publish_jobs", [
      { ...k(), userId: GONE, status: "scheduled", active: true, rev: 0 },
      { ...k(), userId: GONE, status: "published", active: false, rev: 0 },
    ]);
    await insert("render_jobs", [
      { ...k(), userId: GONE, status: "queued" },
      { ...k(), userId: GONE, status: "done" },
    ]);

    expect(await cancelUserActivity(GONE)).toEqual({ runs: 1, posts: 1, renders: 1 });
    expect(await testMongo.db.collection("pipeline_runs").countDocuments({ userId: GONE, active: true })).toBe(0);
    expect(await testMongo.db.collection("pipeline_runs").countDocuments({ userId: ACTIVE, active: true })).toBe(1);
    expect(await testMongo.db.collection("publish_jobs").countDocuments({ userId: GONE, status: "published" })).toBe(1);
    expect(await testMongo.db.collection("render_jobs").countDocuments({ userId: GONE, status: "done" })).toBe(1);
  });
});

describe("findOrphanedUserIds", () => {
  const later = () => new Date(Date.now() + ORPHAN_GRACE_MS + 60_000);

  it("finds users whose profile outlived their account by more than the grace period", async () => {
    await seedEverything(GONE, 1);
    await seedEverything(ACTIVE, 1);
    expect(await findOrphanedUserIds(100, later())).toEqual([GONE]);
    expect(await userExists(ACTIVE)).toBe(true);
    expect(await userExists("not-an-id")).toBe(false);
  });

  it("never takes a brand-new profile for an orphan (its sign-up may not have committed yet)", async () => {
    await seedEverything(GONE, 1); // profile created just now
    expect(await findOrphanedUserIds()).toEqual([]);
  });
});

describe("purgeOrphanedUserData", () => {
  it("restarts the resumable deletion job for each orphan, with a new event id each day", async () => {
    await testMongo.db.collection("profiles").insertOne({ userId: GONE, createdAt: new Date(Date.now() - 2 * ORPHAN_GRACE_MS) }, { bypassDocumentValidation: true });
    const sendEvent = vi.fn();
    const step = { run: (_id: string, fn: () => unknown) => fn(), sendEvent };
    const job = purgeOrphanedUserData as unknown as { fn: (ctx: { step: typeof step }) => Promise<{ restarted: number }> };
    expect(await job.fn({ step })).toEqual({ restarted: 1 });
    const [, events] = sendEvent.mock.calls[0];
    expect(events).toEqual([{ id: `account-deleted-${GONE}-${new Date().toISOString().slice(0, 10)}`, name: "account/deleted", data: { userId: GONE } }]);
    expect(await testMongo.db.collection("profiles").countDocuments({ userId: GONE })).toBe(1); // the job deletes, not the sweep
  });
});

describe("requestAccountDataDeletion", () => {
  it("queues the background job (and deletes nothing itself) when the job system answers", async () => {
    await seedEverything(GONE);
    send.mockResolvedValue({ ids: ["e1"] });
    expect(await requestAccountDataDeletion(GONE)).toBe("queued");
    expect(send).toHaveBeenCalledWith({ id: `account-deleted-${GONE}-request`, name: "account/deleted", data: { userId: GONE } });
    expect(await countFor(GONE)).toBe(SEEDED);
  });

  it("cancels the user's queued work right away, before queueing", async () => {
    await testMongo.db.collection("pipeline_runs").insertOne({ userId: GONE, status: "running", active: true, idempotencyKey: "k1" }, { bypassDocumentValidation: true });
    send.mockResolvedValue({ ids: ["e1"] });
    await requestAccountDataDeletion(GONE);
    expect(await testMongo.db.collection("pipeline_runs").countDocuments({ userId: GONE, active: true })).toBe(0);
  });

  it("in production, leaves the data to the daily sweep when the job system can't be reached (no big inline work)", async () => {
    await seedEverything(GONE);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    send.mockRejectedValue(new Error("down"));
    expect(await requestAccountDataDeletion(GONE)).toBe("deferred");
    expect(await testMongo.db.collection("profiles").countDocuments({ userId: GONE })).toBe(1);
  });

  it("in development, deletes right away (data and files) when the job system can't be reached", async () => {
    await seedEverything(GONE);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    send.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:8288"));
    r2On();
    expect(await requestAccountDataDeletion(GONE)).toBe("deleted");
    expect(await countFor(GONE)).toBe(0);
    expect(deletePrefix).toHaveBeenCalledWith(`users/${GONE}/`);
  });

  it("never throws: if even that fails, it leaves the rest to the daily sweep", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    send.mockRejectedValue(new Error("down"));
    // The account still exists, so the inline deletion refuses — the request must still resolve.
    expect(await requestAccountDataDeletion(ACTIVE)).toBe("deferred");
  });
});

describe("jobs", () => {
  it("registers the deletion job and the daily sweep", () => {
    const ids = functions.map((f) => (f as unknown as { config: { id: string } }).config.id);
    expect(ids).toEqual(expect.arrayContaining(["delete-account-data", "purge-orphaned-user-data"]));
  });
});
