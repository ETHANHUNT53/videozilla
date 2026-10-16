/**
 * Local development database: a single-node MongoDB replica set (so transactions work, like Atlas), stored in
 * .cache/mongo so data survives restarts. Run with `npm run db`, then use
 * MONGODB_URI=mongodb://127.0.0.1:27018/?replicaSet=vz-dev in .env.local.
 * The MongoDB binary is downloaded from mongodb.org on first run.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { MongoMemoryReplSet } from "mongodb-memory-server";

async function main() {
  const dbPath = path.resolve(".cache", "mongo");
  mkdirSync(dbPath, { recursive: true });

  const replSet = await MongoMemoryReplSet.create({
    replSet: { name: "vz-dev", count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port: 27018, dbPath }],
  });

  console.log(`Local MongoDB ready: ${replSet.getUri()}`);
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
