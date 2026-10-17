import "server-only";
import { assertMigrated, COLLECTIONS, getMongoClient } from "@videozilla/db";
import type { ClientSession, Db, MongoClient } from "mongodb";
import { env } from "../env";
import type { IdeaSessionDoc, ProfileDoc, ProjectDoc } from "./types";

/**
 * The web app's database handle. Collections, validators and indexes are created by migrations (packages/db,
 * `npm run db:migrate`; `npm run db` runs them locally), never at request time.
 */
export function mongoClient(): MongoClient {
  return getMongoClient(env.mongoUri, "videozilla-web");
}

export function db(): Db {
  return mongoClient().db(env.mongoDb);
}

const globalForSchema = globalThis as unknown as { __vzMigrated?: Promise<void> };

/**
 * Fails clearly (once per process) when this database hasn't had the migrations this code needs, instead of running
 * without its unique indexes and validators. A failure is retried on the next call, so running the migration is
 * enough; no restart needed.
 */
export function ensureMigrated(): Promise<void> {
  globalForSchema.__vzMigrated ??= assertMigrated(db()).catch((err) => {
    globalForSchema.__vzMigrated = undefined;
    throw err;
  });
  return globalForSchema.__vzMigrated;
}

export const collections = {
  projects: () => db().collection<ProjectDoc>(COLLECTIONS.projects),
  profiles: () => db().collection<ProfileDoc>(COLLECTIONS.profiles),
  ideaSessions: () => db().collection<IdeaSessionDoc>(COLLECTIONS.ideaSessions),
  // Job collections: written by later features (M2–M6); deleting a project already cancels their active entries (§6.6).
  pipelineRuns: () => db().collection(COLLECTIONS.pipelineRuns),
  publishJobs: () => db().collection(COLLECTIONS.publishJobs),
  renderJobs: () => db().collection(COLLECTIONS.renderJobs),
  usageCounters: () => db().collection(COLLECTIONS.usageCounters),
  config: () => db().collection(COLLECTIONS.config),
};

/**
 * Runs `fn` in one transaction (DB Design §6): snapshot reads, majority writes, and the driver's automatic retry on
 * transient errors. Pass `session` to every read and write inside. No external calls (AI, voice, R2) in here.
 */
export async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = mongoClient().startSession();
  try {
    return await session.withTransaction(fn, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
  } finally {
    await session.endSession();
  }
}
