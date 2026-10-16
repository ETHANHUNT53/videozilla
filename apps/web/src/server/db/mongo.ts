import "server-only";
import { MongoClient, type Db } from "mongodb";
import { env } from "../env";
import type { ProfileDoc, ProjectDoc } from "./types";

/**
 * One MongoClient per server process (and per hot-reload in dev), so serverless instances reuse their
 * connection pool instead of opening a new one per request.
 */
const globalForMongo = globalThis as unknown as { __vzMongo?: { client: MongoClient; indexes?: Promise<void> } };

export function mongoClient(): MongoClient {
  globalForMongo.__vzMongo ??= { client: new MongoClient(env.mongoUri, { maxPoolSize: 10, appName: "videozilla-web" }) };
  return globalForMongo.__vzMongo.client;
}

export function db(): Db {
  return mongoClient().db(env.mongoDb);
}

export const collections = {
  projects: () => db().collection<ProjectDoc>("projects"),
  profiles: () => db().collection<ProfileDoc>("profiles"),
};

/** Creates indexes once per process (PRD §18). Safe to call repeatedly. */
export function ensureIndexes(): Promise<void> {
  const g = globalForMongo.__vzMongo ?? (mongoClient(), globalForMongo.__vzMongo!);
  g.indexes ??= (async () => {
    await collections.projects().createIndexes([
      { key: { userId: 1, deletedAt: 1, updatedAt: -1 }, name: "library" },
      { key: { purgeAt: 1 }, name: "purge", partialFilterExpression: { purgeAt: { $type: "date" } } },
    ]);
    await collections.profiles().createIndex({ userId: 1 }, { unique: true, name: "user" });
  })().catch((err) => {
    g.indexes = undefined;
    throw err;
  });
  return g.indexes;
}
