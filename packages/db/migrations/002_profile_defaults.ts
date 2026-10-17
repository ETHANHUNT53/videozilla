import type { Migration } from "../src/migrate";

/**
 * 002 — backfill the profile fields the M1 draft didn't write (DB Design §4.2): `defaultAudience` and `role`.
 * Frozen once applied.
 */
export default {
  async up({ db, log }) {
    const profiles = db.collection("profiles");
    const audience = await profiles.updateMany({ defaultAudience: { $exists: false } }, { $set: { defaultAudience: "students" } });
    const role = await profiles.updateMany({ role: { $exists: false } }, { $set: { role: "user" } });
    log(`profiles: defaultAudience set on ${audience.modifiedCount}, role set on ${role.modifiedCount}`);
  },
} satisfies Migration;
