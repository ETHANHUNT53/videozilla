import type { Db } from "mongodb";
import { COLLECTIONS } from "./collections";

/**
 * The newest migration this code needs. Update it with every new migration file (a test checks it is the last one).
 * Kept as a plain name so the web app can check it without reading the migrations folder.
 */
export const LATEST_MIGRATION = "002_profile_defaults";

/** Throws a clear error when the database is behind this code (migrations not run on this database yet). */
export async function assertMigrated(db: Db): Promise<void> {
  const record = await db.collection(COLLECTIONS.migrations).findOne({ name: LATEST_MIGRATION }, { projection: { _id: 1 } });
  if (!record) {
    throw new Error(
      `Database "${db.databaseName}" is missing migration ${LATEST_MIGRATION}. Run \`npm run db:migrate\` against it ` +
        "(locally `npm run db` does this on start).",
    );
  }
}
