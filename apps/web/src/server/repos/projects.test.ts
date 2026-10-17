import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@videozilla/db/migrate";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDoc } from "../db/types";

// The repository talks to a throwaway MongoDB with the real migrations (validators + indexes) applied.
const state = vi.hoisted(() => ({ db: undefined as unknown as Db }));
vi.mock("../db/mongo", () => ({
  db: () => state.db,
  ensureMigrated: async () => {},
  collections: { projects: () => state.db.collection("projects"), profiles: () => state.db.collection("profiles") },
}));
const sessionUser = vi.hoisted(() => vi.fn());
vi.mock("../api/session", () => ({ sessionUser }));

import { GET } from "@/app/api/v1/projects/route";
import { ApiError } from "../api/errors";
import { listProjects } from "./projects";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const CACHED_BINARY_DIR = path.join(ROOT, "apps/web/node_modules/.cache/mongodb-memory-server");

const ME = "6ad20f12aa355a5a9f3db9cb";
const OTHER = "6ad2130caa355a5a9f3db9d6";
const APP = "http://localhost:3000";

let server: MongoMemoryServer;
let client: MongoClient;

beforeAll(async () => {
  server = await MongoMemoryServer.create(existsSync(CACHED_BINARY_DIR) ? { binary: { downloadDir: CACHED_BINARY_DIR } } : {});
  client = await MongoClient.connect(server.getUri());
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

const base = new Date("2026-10-17T06:00:00.000Z");

function project(n: number, over: Partial<ProjectDoc> = {}): ProjectDoc {
  return {
    _id: new ObjectId(),
    userId: ME,
    title: `Video ${n}`,
    language: "en",
    lengthPreset: 60,
    audience: "students",
    styleId: "midnight",
    voiceGender: "female",
    status: "idea_draft",
    currentStoryboardVersion: null,
    failedStep: null,
    createdAt: base,
    updatedAt: new Date(base.getTime() - n * 60_000),
    deletedAt: null,
    purgeAt: null,
    rev: 0,
    ...over,
  };
}

async function seed(docs: ProjectDoc[]) {
  await state.db.collection("projects").insertMany(docs);
  return docs;
}

/** Expected order: newest change first, ties broken by id (descending). */
const ordered = (docs: ProjectDoc[]) =>
  [...docs].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || (a._id.toHexString() < b._id.toHexString() ? 1 : -1)).map((d) => d._id.toHexString());

async function all(query: Parameters<typeof listProjects>[1]) {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i++) {
    const page = await listProjects(ME, { ...query, cursor });
    ids.push(...page.items.map((p) => p.id));
    if (!page.hasMore) return ids;
    cursor = page.nextCursor!;
  }
  throw new Error("too many pages");
}

beforeEach(async () => {
  state.db = client.db(`t_${new ObjectId().toHexString()}`);
  await runMigrations(state.db, { log: () => {} });
  sessionUser.mockReset().mockResolvedValue({ id: ME, name: "Asha", email: "asha@example.com", emailVerified: true, image: null, createdAt: base });
  vi.stubEnv("BETTER_AUTH_URL", APP);
});

describe("listProjects", () => {
  it("pages newest first with 24 per page by default, without gaps or repeats", async () => {
    const docs = await seed(Array.from({ length: 30 }, (_, n) => project(n)));
    const first = await listProjects(ME);
    expect(first.items).toHaveLength(24);
    expect(first.hasMore).toBe(true);
    const second = await listProjects(ME, { cursor: first.nextCursor! });
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
    expect([...first.items, ...second.items].map((p) => p.id)).toEqual(ordered(docs));
  });

  it("handles many projects changed at the same moment (ties broken by id)", async () => {
    const same = new Date(base);
    const docs = await seed(Array.from({ length: 13 }, (_, n) => project(n, { updatedAt: n % 4 === 0 ? new Date(base.getTime() - n) : same })));
    expect(await all({ limit: 3 })).toEqual(ordered(docs));
  });

  it("returns only this user's projects that aren't deleted", async () => {
    const mine = await seed([project(1), project(2)]);
    await seed([project(3, { userId: OTHER }), project(4, { deletedAt: base, purgeAt: base })]);
    expect(await all({})).toEqual(ordered(mine));
  });

  it("filters by status group", async () => {
    const [draft, building, ready, scheduled, publishing, posted, failed, attention] = await seed([
      project(1, { status: "idea_draft" }),
      project(2, { status: "building" }),
      project(3, { status: "exported" }),
      project(4, { status: "scheduled" }),
      project(5, { status: "publishing" }),
      project(6, { status: "posted" }),
      project(7, { status: "publish_failed" }),
      project(8, { status: "needs_attention" }),
    ]);
    const id = (d: ProjectDoc) => d._id.toHexString();
    expect(await all({ filter: "drafts" })).toEqual([id(draft), id(building)]);
    expect(await all({ filter: "ready" })).toEqual([id(ready)]);
    expect(await all({ filter: "scheduled" })).toEqual([id(scheduled), id(publishing)]);
    expect(await all({ filter: "posted" })).toEqual([id(posted)]);
    expect(await all({ filter: "attention" })).toEqual([id(failed), id(attention)]);
    expect(await all({ filter: "all" })).toHaveLength(8);
  });

  it("searches titles case-insensitively, treating regex characters as text", async () => {
    const [sky, cpp] = await seed([project(1, { title: "Why is the SKY blue?" }), project(2, { title: "C++ (basics)" }), project(3, { title: "Photosynthesis" })]);
    expect(await all({ q: "sky" })).toEqual([sky._id.toHexString()]);
    expect(await all({ q: "c++ (" })).toEqual([cpp._id.toHexString()]);
    expect(await all({ q: ".*" })).toEqual([]);
  });

  it("searches Hindi titles", async () => {
    const [hi] = await seed([project(1, { title: "प्रकाश संश्लेषण कैसे होता है", language: "hi" }), project(2)]);
    expect(await all({ q: "संश्लेषण" })).toEqual([hi._id.toHexString()]);
  });

  it("rejects a cursor made for a different filter or search", async () => {
    await seed(Array.from({ length: 4 }, (_, n) => project(n)));
    const { nextCursor } = await listProjects(ME, { limit: 2 });
    await expect(listProjects(ME, { limit: 2, cursor: nextCursor!, filter: "drafts" })).rejects.toBeInstanceOf(ApiError);
    await expect(listProjects(ME, { limit: 2, cursor: nextCursor!, q: "video" })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });

  it("returns the ProjectSummary shape of API Design §12", async () => {
    await seed([project(1, { rev: 3 })]);
    const [item] = (await listProjects(ME)).items;
    expect(Object.keys(item).sort()).toEqual(["coverUrl", "createdAt", "exportOutdated", "id", "language", "lengthPreset", "postedAt", "rev", "status", "title", "updatedAt"]);
    expect(item).toMatchObject({ coverUrl: null, exportOutdated: false, postedAt: null, rev: 3, title: "Video 1" });
  });
});

describe("GET /api/v1/projects", () => {
  const call = (query = "", init: RequestInit = {}) => GET(new Request(`${APP}/api/v1/projects${query}`, init));

  it("returns a page and a cursor for the next one", async () => {
    await seed(Array.from({ length: 3 }, (_, n) => project(n)));
    const res = await call("?limit=2");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(2);
    expect(body.hasMore).toBe(true);
    const next = await (await call(`?limit=2&cursor=${body.nextCursor}`)).json();
    expect(next).toMatchObject({ hasMore: false, nextCursor: null });
    expect(next.items).toHaveLength(1);
  });

  it("validates filter, q and limit", async () => {
    for (const q of ["?filter=archived", "?limit=0", "?limit=101", "?q=" + "x".repeat(81), "?sort=title"]) {
      const res = await call(q);
      expect(res.status, q).toBe(400);
      expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
    }
  });

  it("answers a cursor from another filter with 400 INVALID_CURSOR", async () => {
    await seed(Array.from({ length: 3 }, (_, n) => project(n)));
    const { nextCursor } = await (await call("?limit=1")).json();
    const res = await call(`?limit=1&filter=drafts&cursor=${nextCursor}`);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_CURSOR");
  });

  it("never shows another user's projects", async () => {
    await seed([project(1, { userId: OTHER })]);
    expect((await (await call()).json()).items).toEqual([]);
  });

  it("needs a signed-in, verified user", async () => {
    sessionUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("answers other methods with 405 until they exist", async () => {
    const { POST } = await import("@/app/api/v1/projects/route");
    const res = await POST(new Request(`${APP}/api/v1/projects`, { method: "POST", headers: { origin: APP } }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET");
  });
});
