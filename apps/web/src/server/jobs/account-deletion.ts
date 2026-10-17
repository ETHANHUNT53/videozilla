import "server-only";
import { env } from "../env";
import { cancelUserActivity, deleteAuthTokens, deleteUserCollection, findOrphanedUserIds, USER_DATA_COLLECTIONS } from "../repos/account";
import { deletePrefix, userPrefix } from "../storage/r2";
import { inngest } from "./inngest";

/**
 * The steps of deleting an account's data (DB Design §6.12), in order: stop the user's queued work, delete each
 * collection, Better Auth's leftover tokens, the stored files, and the profile last. The profile is how the daily sweep
 * finds an unfinished deletion, so nothing (files included) may outlive it. Each step is idempotent.
 */
export function accountDeletionSteps(userId: string): { id: string; run: () => Promise<unknown> }[] {
  const content = USER_DATA_COLLECTIONS.filter((c) => c !== "profiles");
  return [
    { id: "cancel-activity", run: () => cancelUserActivity(userId) },
    ...content.map((collection) => ({ id: `delete-${collection}`, run: () => deleteUserCollection(userId, collection) })),
    { id: "delete-auth-tokens", run: () => deleteAuthTokens(userId) },
    ...(env.r2.configured ? [{ id: "delete-files", run: () => deletePrefix(userPrefix(userId)) }] : []),
    { id: "delete-profiles", run: () => deleteUserCollection(userId, "profiles") },
  ];
}

/** The event that starts (or, from the sweep, restarts) the deletion job for a user. */
function deletionEvent(userId: string, key: string) {
  // The event id makes a repeated send a no-op in Inngest (within its deduplication window).
  return { id: `account-deleted-${userId}-${key}`, name: "account/deleted" as const, data: { userId } };
}

/**
 * Account deletion job: runs after Better Auth has removed the sign-in records. One step per part of the data, so a
 * retry resumes where it stopped.
 */
export const deleteAccountData = inngest.createFunction(
  { id: "delete-account-data", triggers: [{ event: "account/deleted" }], retries: 5 },
  async ({ event, step }) => {
    const userId = (event.data as { userId: string }).userId;
    const results: Record<string, unknown> = {};
    for (const s of accountDeletionSteps(userId)) results[s.id] = await step.run(s.id, s.run);
    return { userId, results };
  },
);

/**
 * Daily safety net: finds deletions that never ran or gave up (data older than a day with no account) and starts the
 * resumable deletion job again for each, so even a very large account is finished step by step.
 */
export const purgeOrphanedUserData = inngest.createFunction(
  { id: "purge-orphaned-user-data", triggers: [{ cron: "TZ=Asia/Kolkata 0 4 * * *" }] },
  async ({ step }) => {
    const orphans = await step.run("find-orphans", () => findOrphanedUserIds());
    if (orphans.length) {
      const day = new Date().toISOString().slice(0, 10); // a new event each day, so a deletion that gave up is retried
      await step.sendEvent("restart-deletions", orphans.map((userId) => deletionEvent(userId, day)));
    }
    return { restarted: orphans.length };
  },
);

/**
 * Called right after the account is deleted. Stops the user's queued work at once (cheap), then hands the data
 * deletion to the job. Never throws: the account is already gone, and the user must see the deletion succeed.
 * If the job system can't be reached, production leaves the data to the daily sweep (a large account must not run
 * inside this request); local development, which often runs without `npm run jobs`, deletes it right here.
 */
export async function requestAccountDataDeletion(userId: string): Promise<"queued" | "deleted" | "deferred"> {
  try {
    await cancelUserActivity(userId);
  } catch (err) {
    console.warn(`[account] couldn't cancel the queued work of ${userId} yet; the deletion job will:`, err instanceof Error ? err.message : err);
  }
  try {
    await inngest.send(deletionEvent(userId, "request"));
    return "queued";
  } catch (err) {
    console.warn(`[account] couldn't queue the data deletion for ${userId}:`, err instanceof Error ? err.message : err);
  }
  if (env.isProduction) {
    console.error(`[account] data deletion for ${userId} deferred to the daily sweep`);
    return "deferred";
  }
  try {
    for (const s of accountDeletionSteps(userId)) await s.run();
    return "deleted";
  } catch (err) {
    console.error(`[account] data deletion for ${userId} failed; the daily sweep will finish it:`, err);
    return "deferred";
  }
}
