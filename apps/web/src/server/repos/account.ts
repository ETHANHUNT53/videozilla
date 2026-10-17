import "server-only";
import { COLLECTIONS } from "@videozilla/db";
import { ObjectId } from "mongodb";
import { collections, db } from "../db/mongo";

/**
 * Account deletion (PRD F1-FR13, DB Design §6.12): everything a user owns is deleted, collection by collection, in
 * batches (it can be thousands of documents, so it is not one transaction). Each step is idempotent, so a job that
 * stops halfway simply runs again. Better Auth removes the sign-in records (user, session, account) itself.
 */

/**
 * Every collection with user-owned documents (`userId` on each, DB Design §1). Order matters for a resumed run:
 * work queues first (nothing more runs for the user), content next, the profile last, because the orphan sweep finds
 * leftover users through `profiles` and `projects`.
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

const BATCH = 500;

/** Whether the Better Auth user still exists (ids are the user's ObjectId as hex). */
export async function userExists(userId: string): Promise<boolean> {
  if (!ObjectId.isValid(userId) || userId.length !== 24) return false;
  return (await db().collection("user").countDocuments({ _id: new ObjectId(userId) }, { limit: 1 })) > 0;
}

/**
 * Step 1, just before the account is deleted: stop everything that could still act for the user — active pipeline
 * runs, scheduled Instagram posts and queued renders are cancelled. (Disconnecting Instagram joins this in M6.)
 */
export async function cancelUserActivity(userId: string): Promise<{ runs: number; posts: number; renders: number }> {
  const now = new Date();
  const runs = await collections.pipelineRuns().updateMany({ userId, active: true }, { $set: { status: "cancelled", active: false, finishedAt: now, updatedAt: now } });
  const posts = await collections.publishJobs().updateMany(
    { userId, status: "scheduled" },
    { $set: { status: "cancelled", active: false, cancelledAt: now, updatedAt: now }, $inc: { rev: 1 } },
  );
  const renders = await collections.renderJobs().updateMany({ userId, status: "queued" }, { $set: { status: "cancelled", finishedAt: now, updatedAt: now } });
  return { runs: runs.modifiedCount, posts: posts.modifiedCount, renders: renders.modifiedCount };
}

/**
 * Deletes one collection's documents for a user, in batches. Refuses while the user still exists, so a stray or
 * repeated request can never wipe an active account's data.
 */
export async function deleteUserCollection(userId: string, collection: (typeof USER_DATA_COLLECTIONS)[number], batch = BATCH): Promise<number> {
  if (await userExists(userId)) throw new Error(`Refusing to delete ${collection} for ${userId}: the account still exists`);
  const col = db().collection(collection);
  let deleted = 0;
  for (;;) {
    const ids = (await col.find({ userId }, { projection: { _id: 1 } }).limit(batch).toArray()).map((d) => d._id);
    if (!ids.length) return deleted;
    deleted += (await col.deleteMany({ _id: { $in: ids }, userId })).deletedCount;
  }
}

/** All of a user's documents, collection by collection (the job runs the same steps one by one, resumably). */
export async function deleteUserData(userId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const collection of USER_DATA_COLLECTIONS) counts[collection] = await deleteUserCollection(userId, collection);
  return counts;
}

/**
 * Users whose data outlived their account (a deletion job that never started or stopped early). Found through
 * `profiles` and `projects`, which every user with data has; the daily sweep finishes their deletion.
 */
export async function findOrphanedUserIds(limit = 100): Promise<string[]> {
  const ids = new Set<string>([...(await collections.profiles().distinct("userId")), ...(await collections.projects().distinct("userId"))]);
  const orphans: string[] = [];
  for (const id of ids) {
    if (orphans.length >= limit) break;
    if (!(await userExists(id))) orphans.push(id);
  }
  return orphans;
}
