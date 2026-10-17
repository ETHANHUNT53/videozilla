import "server-only";
import { COLLECTIONS } from "@videozilla/db";
import { ObjectId } from "mongodb";
import { collections, db } from "../db/mongo";

/**
 * Account deletion (PRD F1-FR13, DB Design §6.12): everything a user owns is deleted, collection by collection, in
 * batches (it can be thousands of documents, so it is not one transaction). Each step is idempotent, so a job that
 * stops halfway simply runs again. Better Auth removes the sign-in records (user, session, account) itself.
 * Every step refuses while the Better Auth user still exists, so a stray or repeated request can never touch an
 * active account.
 */

/**
 * Every collection with user-owned documents (`userId` on each, DB Design §1). Order matters for a resumed run:
 * work queues first (nothing more runs for the user), content next, the profile last, because the orphan sweep finds
 * unfinished deletions through `profiles` (the job also deletes the user's files before the profile).
 */
export const USER_DATA_COLLECTIONS = [
  COLLECTIONS.pipelineRuns,
  COLLECTIONS.renderJobs,
  COLLECTIONS.publishJobs,
  COLLECTIONS.instagramAccounts,
  COLLECTIONS.notifications,
  COLLECTIONS.chatMessages,
  COLLECTIONS.storyboardVersions,
  COLLECTIONS.voiceTracks,
  COLLECTIONS.timelines,
  COLLECTIONS.renders,
  COLLECTIONS.ideaSessions,
  COLLECTIONS.aiCalls,
  COLLECTIONS.usageCounters,
  COLLECTIONS.projects,
  COLLECTIONS.profiles,
] as const;
export type UserDataCollection = (typeof USER_DATA_COLLECTIONS)[number];

const BATCH = 500;
/** Data younger than this is never treated as orphaned: a signing-up user's profile can exist before their account. */
export const ORPHAN_GRACE_MS = 24 * 3600 * 1000;

/** Whether the Better Auth user still exists (ids are the user's ObjectId as hex). */
export async function userExists(userId: string): Promise<boolean> {
  if (!ObjectId.isValid(userId) || userId.length !== 24) return false;
  return (await db().collection("user").countDocuments({ _id: new ObjectId(userId) }, { limit: 1 })) > 0;
}

async function assertAccountGone(userId: string, what: string): Promise<void> {
  if (await userExists(userId)) throw new Error(`Refusing to ${what} for ${userId}: the account still exists`);
}

/**
 * First step once the account is gone: stop everything that could still act for the user (active pipeline runs,
 * scheduled Instagram posts, queued renders). Done after Better Auth deleted the account, never before, so a deletion
 * that fails leaves the user's scheduled posts alone. (Disconnecting Instagram joins this in M6.)
 */
export async function cancelUserActivity(userId: string): Promise<{ runs: number; posts: number; renders: number }> {
  await assertAccountGone(userId, "cancel the activity");
  const now = new Date();
  const runs = await collections.pipelineRuns().updateMany({ userId, active: true }, { $set: { status: "cancelled", active: false, finishedAt: now, updatedAt: now } });
  const posts = await collections.publishJobs().updateMany(
    { userId, status: "scheduled" },
    { $set: { status: "cancelled", active: false, cancelledAt: now, updatedAt: now }, $inc: { rev: 1 } },
  );
  const renders = await collections.renderJobs().updateMany({ userId, status: "queued" }, { $set: { status: "cancelled", finishedAt: now, updatedAt: now } });
  return { runs: runs.modifiedCount, posts: posts.modifiedCount, renders: renders.modifiedCount };
}

/** Deletes one collection's documents for a user, in batches. */
export async function deleteUserCollection(userId: string, collection: UserDataCollection, batch = BATCH): Promise<number> {
  await assertAccountGone(userId, `delete ${collection}`);
  const col = db().collection(collection);
  let deleted = 0;
  for (;;) {
    const ids = (await col.find({ userId }, { projection: { _id: 1 } }).limit(batch).toArray()).map((d) => d._id);
    if (!ids.length) return deleted;
    deleted += (await col.deleteMany({ _id: { $in: ids }, userId })).deletedCount;
  }
}

/**
 * Better Auth's leftover tokens for the user: password-reset and delete-account links live in `verification` with
 * the user's id as their value, and Better Auth doesn't remove them with the user. (Email verification uses signed
 * tokens and stores nothing.)
 */
export async function deleteAuthTokens(userId: string): Promise<number> {
  await assertAccountGone(userId, "delete the sign-in tokens");
  return (await db().collection("verification").deleteMany({ value: userId })).deletedCount;
}

/**
 * Users whose data outlived their account (a deletion job that never started or stopped early), found in one query
 * through `profiles`, which every user has and which is deleted last. Only data older than the grace period counts,
 * so a profile written a moment before its sign-up commits is never taken for an orphan.
 */
export async function findOrphanedUserIds(limit = 100, now = new Date()): Promise<string[]> {
  const rows = await collections
    .profiles()
    .aggregate<{ userId: string }>([
      { $match: { createdAt: { $lt: new Date(now.getTime() - ORPHAN_GRACE_MS) } } },
      { $lookup: { from: "user", let: { uid: "$userId" }, pipeline: [{ $match: { $expr: { $eq: ["$_id", { $toObjectId: "$$uid" }] } } }, { $project: { _id: 1 } }], as: "account" } },
      { $match: { account: { $size: 0 } } },
      { $project: { _id: 0, userId: 1 } },
      { $limit: limit },
    ])
    .toArray();
  return rows.map((r) => r.userId);
}
