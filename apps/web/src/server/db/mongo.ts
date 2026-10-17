import "server-only";
import { assertMigrated, COLLECTIONS, getMongoClient } from "@videozilla/db";
import type { Db, MongoClient } from "mongodb";
import { env } from "../env";
import type { ProfileDoc, ProjectDoc } from "./types";

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
};
