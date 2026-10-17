import "server-only";
import { COLLECTIONS, getMongoClient } from "@videozilla/db";
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

export const collections = {
  projects: () => db().collection<ProjectDoc>(COLLECTIONS.projects),
  profiles: () => db().collection<ProfileDoc>(COLLECTIONS.profiles),
};
