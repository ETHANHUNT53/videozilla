import type { ObjectId } from "mongodb";
import type { Migration } from "../src/migrate";
import { AUTH_COLLECTIONS } from "../src/collections";

/**
 * 004 — unique indexes for Better Auth's own collections (PRD D16, sign-in without email). Better Auth's MongoDB
 * adapter creates no indexes, and its "does this email exist?" check and the insert after it aren't atomic: with
 * sign-up now signing you in at once (no verification email to stop a second copy), two sign-ups for the same address
 * at the same moment could make two accounts. The rate limiter's rows are looked up by key on every sign-in and sign-up,
 * and a duplicate row would split the count. Stops with a clear message if duplicates already exist. Frozen once
 * applied.
 */
export default {
  async up({ db, log }) {
    const users = db.collection(AUTH_COLLECTIONS.user);
    const duplicates = await users
      .aggregate<{ _id: string; n: number }>([{ $group: { _id: { $toLower: "$email" }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $limit: 5 }])
      .toArray();
    if (duplicates.length) {
      throw new Error(
        `${duplicates.length}+ email address(es) belong to more than one account (for example ${duplicates[0]._id}). ` +
          "Merge or remove the extra accounts, then run the migration again.",
      );
    }
    await users.createIndex({ email: 1 }, { name: "email", unique: true });
    // Rows from before this migration can repeat a key; they're short-lived counters, so the extras are dropped.
    const rateLimit = db.collection(AUTH_COLLECTIONS.rateLimit);
    for await (const dup of rateLimit.aggregate<{ _id: string; ids: ObjectId[] }>([{ $group: { _id: "$key", ids: { $push: "$_id" }, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }])) {
      await rateLimit.deleteMany({ _id: { $in: dup.ids.slice(1) } });
    }
    await rateLimit.createIndex({ key: 1 }, { name: "key", unique: true });
    log("unique indexes on user.email and rateLimit.key");
  },
} satisfies Migration;
