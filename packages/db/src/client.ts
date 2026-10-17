import { MongoClient } from "mongodb";

const cache = globalThis as unknown as { __vzMongoClients?: Map<string, MongoClient> };

/**
 * One long-lived MongoClient per app name and connection string in a process (and per hot reload in dev), so
 * serverless instances reuse their connection pool instead of opening a new one per request. The driver connects
 * lazily on first use and reconnects by itself if the server goes away and comes back.
 *
 * Never close() a client from here. Short scripts (migrations, the dev database) create their own `new MongoClient`
 * and close that one.
 */
export function getMongoClient(uri: string, appName = "videozilla"): MongoClient {
  const clients = (cache.__vzMongoClients ??= new Map());
  const key = `${appName}\n${uri}`;
  let client = clients.get(key);
  if (!client) {
    client = new MongoClient(uri, { maxPoolSize: 10, appName });
    clients.set(key, client);
  }
  return client;
}
