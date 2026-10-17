/**
 * Local development database: a single-node MongoDB replica set (so transactions work, like Atlas), stored in
 * .cache/mongo so data survives restarts. Run with `npm run db`, then use
 * MONGODB_URI=mongodb://127.0.0.1:27018/?replicaSet=vz-dev in .env.local.
 * On start it applies any pending migrations (packages/db), so the local schema matches production.
 * The MongoDB binary is downloaded from mongodb.org on first run.
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { getMongoClient } from "@videozilla/db";
import { runMigrations } from "@videozilla/db/migrate";
import { MongoMemoryReplSet } from "mongodb-memory-server";

async function migrate(uri: string) {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const dbName = process.env.MONGODB_DB || "videozilla";
  const client = getMongoClient(uri, "videozilla-dev-db");
  try {
    const { applied, alreadyApplied } = await runMigrations(client.db(dbName), { log: (m) => console.log(`  ${m}`) });
    console.log(applied.length ? `Migrated "${dbName}": applied ${applied.join(", ")}.` : `Database "${dbName}" is up to date (${alreadyApplied.length} migrations).`);
  } catch (err) {
    console.error(`\nMigrations failed — the database is running, but fix this before using the app:\n${err instanceof Error ? err.message : err}\n`);
  } finally {
    await client.close();
  }
}

async function main() {
  const dbPath = path.resolve(".cache", "mongo");
  mkdirSync(dbPath, { recursive: true });

  const replSet = await MongoMemoryReplSet.create({
    replSet: { name: "vz-dev", count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port: 27018, dbPath }],
  });

  console.log(`Local MongoDB ready: ${replSet.getUri()}`);
  await migrate(replSet.getUri());
  console.log(`Data is kept in ${dbPath}. Press Ctrl+C to stop.`);

  const stop = async () => {
    await replSet.stop({ doCleanup: false });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
