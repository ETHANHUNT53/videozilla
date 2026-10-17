import { MongoClient } from "mongodb";
import { migrationStatus, runMigrations } from "./migrate";

/**
 * npm run db:migrate              apply pending migrations
 * npm run db:migrate -- --status  list applied / pending migrations
 *
 * Reads MONGODB_URI and MONGODB_DB from the environment (locally: apps/web/.env.local; in CI: the deploy secrets).
 */
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set (locally it comes from apps/web/.env.local).");
  const dbName = process.env.MONGODB_DB || "videozilla";
  const client = new MongoClient(uri, { appName: "videozilla-migrate" });
  try {
    const db = client.db(dbName);
    if (process.argv.includes("--status")) {
      for (const m of await migrationStatus(db)) console.log(`${m.state.padEnd(8)} ${m.name}${m.appliedAt ? `  (${m.appliedAt.toISOString()})` : ""}`);
      return;
    }
    console.log(`Migrating database "${dbName}"…`);
    const { applied, alreadyApplied } = await runMigrations(db);
    console.log(applied.length ? `Applied ${applied.length} migration(s).` : `Up to date (${alreadyApplied.length} applied).`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(`Migration failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
