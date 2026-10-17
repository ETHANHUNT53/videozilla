import "server-only";
import { env } from "../env";
import { deleteUserCollection, deleteUserData, findOrphanedUserIds, USER_DATA_COLLECTIONS } from "../repos/account";
import { deletePrefix, userPrefix } from "../storage/r2";
import { inngest } from "./inngest";

/**
 * Account deletion job (DB Design §6.12). Runs after Better Auth has removed the sign-in records: deletes the user's
 * documents collection by collection (one step each, so a retry resumes where it stopped), then their files.
 */
export const deleteAccountData = inngest.createFunction(
  { id: "delete-account-data", triggers: [{ event: "account/deleted" }], retries: 5 },
  async ({ event, step }) => {
    const userId = (event.data as { userId: string }).userId;
    const counts: Record<string, number> = {};
    for (const collection of USER_DATA_COLLECTIONS) {
      counts[collection] = await step.run(`delete-${collection}`, () => deleteUserCollection(userId, collection));
    }
    const files = env.r2.configured ? await step.run("delete-files", () => deletePrefix(userPrefix(userId))) : 0;
    return { userId, counts, files };
  },
);

/** Daily safety net: finishes any deletion whose job never ran or gave up (data left behind with no account). */
export const purgeOrphanedUserData = inngest.createFunction(
  { id: "purge-orphaned-user-data", triggers: [{ cron: "TZ=Asia/Kolkata 0 4 * * *" }] },
  async ({ step }) => {
    const orphans = await step.run("find-orphans", () => findOrphanedUserIds());
    for (const userId of orphans) {
      await step.run(`delete-${userId}`, async () => {
        const counts = await deleteUserData(userId);
        const files = env.r2.configured ? await deletePrefix(userPrefix(userId)) : 0;
        return { counts, files };
      });
    }
    return { finished: orphans.length };
  },
);

/**
 * Called right after the account is deleted: hands the data deletion to the job. If the job system can't be reached
 * (e.g. locally without `npm run jobs`), the deletion runs here instead; anything still left is caught by the daily
 * sweep. Never throws: the account is already gone, and the user must see the deletion succeed.
 */
export async function requestAccountDataDeletion(userId: string): Promise<"queued" | "deleted" | "deferred"> {
  try {
    // The event id makes a repeated request a no-op in Inngest.
    await inngest.send({ id: `account-deleted-${userId}`, name: "account/deleted", data: { userId } });
    return "queued";
  } catch (err) {
    console.warn(`[account] couldn't queue the data deletion for ${userId}; deleting now instead:`, err instanceof Error ? err.message : err);
  }
  try {
    await deleteUserData(userId);
    if (env.r2.configured) await deletePrefix(userPrefix(userId));
    return "deleted";
  } catch (err) {
    console.error(`[account] data deletion for ${userId} failed; the daily sweep will finish it:`, err);
    return "deferred";
  }
}
