import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@videozilla/db/migrate";
import { MongoClient, ObjectId, type ClientSession, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";

/**
 * A throwaway MongoDB for web tests: a one-node replica set (so transactions work) with the real migrations applied
 * once. Use it as the `src/server/db/mongo` module:
 *
 *   vi.mock("../db/mongo", async () => (await import("../../../test/mongo")).mongoModule);
 *   beforeAll(startTestMongo, 120_000); afterAll(stopTestMongo); beforeEach(() => clearCollections());
 */

const CACHED_BINARY_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../node_modules/.cache/mongodb-memory-server");

export const testMongo = { server: undefined as MongoMemoryReplSet | undefined, client: undefined as unknown as MongoClient, db: undefined as unknown as Db };

export async function startTestMongo(): Promise<void> {
  testMongo.server = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    ...(existsSync(CACHED_BINARY_DIR) ? { binary: { downloadDir: CACHED_BINARY_DIR } } : {}),
  });
  testMongo.client = await MongoClient.connect(testMongo.server.getUri());
  testMongo.db = testMongo.client.db(`t_${new ObjectId().toHexString()}`);
  await runMigrations(testMongo.db, { log: () => {} });
}

export async function stopTestMongo(): Promise<void> {
  await testMongo.client?.close();
  await testMongo.server?.stop();
}

/** Empties the app collections between tests (indexes and validators stay). */
export async function clearCollections(names = ["projects", "idea_sessions", "profiles", "pipeline_runs", "publish_jobs", "render_jobs"]): Promise<void> {
  await Promise.all(names.map((n) => testMongo.db.collection(n).deleteMany({})));
}

/** Drop-in replacement for `src/server/db/mongo`. */
export const mongoModule = {
  db: () => testMongo.db,
  mongoClient: () => testMongo.client,
  ensureMigrated: async () => {},
  withTransaction: async <T>(fn: (session: ClientSession) => Promise<T>) => {
    const session = testMongo.client.startSession();
    try {
      return await session.withTransaction(fn);
    } finally {
      await session.endSession();
    }
  },
  collections: {
    projects: () => testMongo.db.collection("projects"),
    profiles: () => testMongo.db.collection("profiles"),
    ideaSessions: () => testMongo.db.collection("idea_sessions"),
    chatMessages: () => testMongo.db.collection("chat_messages"),
    pipelineRuns: () => testMongo.db.collection("pipeline_runs"),
    publishJobs: () => testMongo.db.collection("publish_jobs"),
    renderJobs: () => testMongo.db.collection("render_jobs"),
    usageCounters: () => testMongo.db.collection("usage_counters"),
    config: () => testMongo.db.collection("config"),
    aiCalls: () => testMongo.db.collection("ai_calls"),
  },
};
