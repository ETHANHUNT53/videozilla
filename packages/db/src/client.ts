import { MongoClient } from "mongodb";

const cache = globalThis as unknown as { __vzMongoClients?: Map<string, MongoClient> };

/**
 * One MongoClient per connection string and process (and per hot reload in dev), so serverless instances reuse their
 * connection pool instead of opening a new one per request. The driver connects lazily on first use and reconnects
 * by itself if the server goes away and comes back.
 */
export function getMongoClient(uri: string, appName = "videozilla"): MongoClient {
  const clients = (cache.__vzMongoClients ??= new Map());
  let client = clients.get(uri);
  if (!client) {
    client = new MongoClient(uri, { maxPoolSize: 10, appName });
    clients.set(uri, client);
  }
  return client;
}
