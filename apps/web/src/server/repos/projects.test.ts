import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@videozilla/db/migrate";
import { MongoClient, ObjectId, type ClientSession, type Db } from "mongodb";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectDoc } from "../db/types";

// The repository talks to a throwaway MongoDB (a one-node replica set, so transactions work) with the real
// migrations (validators + indexes) applied. `failIdeaInsert` makes the idea-session insert fail, to test rollback.
const state = vi.hoisted(() => ({ db: undefined as unknown as Db, client: undefined as unknown as MongoClient, failIdeaInsert: false }));
vi.mock("../db/mongo", () => ({
  db: () => state.db,
  mongoClient: () => state.client,
  ensureMigrated: async () => {},
  withTransaction: async <T>(fn: (session: ClientSession) => Promise<T>) => {
    const session = state.client.startSession();
    try {
      return await session.withTransaction(fn);
    } finally {
      await session.endSession();
    }
  },
  collections: {
    projects: () => state.db.collection("projects"),
    profiles: () => state.db.collection("profiles"),
    ideaSessions: () => {
      const real = state.db.collection("idea_sessions");
      if (!state.failIdeaInsert) return real;
      return Object.assign(Object.create(real), { insertOne: async () => Promise.reject(new Error("idea insert failed")) });
    },
  },
}));
const sessionUser = vi.hoisted(() => vi.fn());
vi.mock("../api/session", () => ({ sessionUser }));

import { DELETE, GET, POST } from "@/app/api/v1/projects/route";
import { ApiError } from "../api/errors";
import { createProject, deleteAllForUser, duplicateProject, listProjects, normalizeSearch, purgeExpiredProjects, softDeleteProject } from "./projects";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const CACHED_BINARY_DIR = path.join(ROOT, "apps/web/node_modules/.cache/mongodb-memory-server");

const ME = "6ad20f12aa355a5a9f3db9cb";
const OTHER = "6ad2130caa355a5a9f3db9d6";
const APP = "http://localhost:3000";

let server: MongoMemoryReplSet;
let client: MongoClient;

beforeAll(async () => {
  server = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    ...(existsSync(CACHED_BINARY_DIR) ? { binary: { downloadDir: CACHED_BINARY_DIR } } : {}),
  });
  client = await MongoClient.connect(server.getUri());
  state.client = client;
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
  state.failIdeaInsert = false;
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

  it("can leave out the needs-attention projects, with full pages and its own cursors", async () => {
    const docs = await seed([
      ...Array.from({ length: 5 }, (_, n) => project(n, { status: "needs_attention" })),
      ...Array.from({ length: 5 }, (_, n) => project(n + 5)),
    ]);
    const healthy = docs.filter((d) => d.status !== "needs_attention");
    const first = await listProjects(ME, { limit: 3, excludeAttention: true });
    expect(first.items).toHaveLength(3);
    expect(await all({ limit: 3, excludeAttention: true })).toEqual(ordered(healthy));
    // A cursor from the full list doesn't work for the reduced one, and the other way round.
    await expect(listProjects(ME, { limit: 3, cursor: first.nextCursor! })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  });

  it("cleans the search one way, so a cursor made from the page's raw search works for the API's cleaned one", async () => {
    await seed([project(1, { title: "संश्लेषण 1" }), project(2, { title: "संश्लेषण 2" }), project(3, { title: "संश्लेषण 3" })]);
    const decomposed = " संश्लेषण ".normalize("NFD");
    const first = await listProjects(ME, { limit: 1, q: decomposed });
    expect(first.items).toHaveLength(1);
    const cleaned = normalizeSearch(decomposed)!;
    expect(cleaned).toBe("संश्लेषण".normalize("NFC"));
    expect((await listProjects(ME, { limit: 1, q: cleaned, cursor: first.nextCursor! })).items).toHaveLength(1);
  });

  it("cuts a long search to 80 characters without splitting an emoji", () => {
    expect(Array.from(normalizeSearch(`${"a".repeat(79)}🎬🎬`)!)).toHaveLength(80);
    expect(normalizeSearch("   ")).toBeUndefined();
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

  it("counts the 80-character search limit in characters, so emoji searches the page allows are accepted", async () => {
    const q = encodeURIComponent("🎬".repeat(80));
    expect((await call(`?q=${q}`)).status).toBe(200);
    expect((await call(`?q=${encodeURIComponent("🎬".repeat(81))}`)).status).toBe(400);
  });

  it("supports exclude=attention for the Library's main list", async () => {
    await seed([project(1, { status: "publish_failed" }), project(2)]);
    const body = await (await call("?exclude=attention")).json();
    expect(body.items.map((p: { status: string }) => p.status)).toEqual(["idea_draft"]);
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

  it("answers other methods with 405", async () => {
    const res = await DELETE(new Request(`${APP}/api/v1/projects`, { method: "DELETE", headers: { origin: APP } }));
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, POST");
  });
});

const PROFILE = {
  defaultLanguage: "hi" as const,
  defaultLengthPreset: 90 as const,
  defaultVoiceGender: "male" as const,
  defaultStyleId: "midnight",
  defaultAudience: "college" as const,
  defaultBoardOrExam: "jee" as const,
};

describe("createProject", () => {
  it("creates an idea draft with every field of DB Design §4.3, from the profile defaults", async () => {
    const p = await createProject(ME, PROFILE);
    const saved = await state.db.collection("projects").findOne({ _id: p._id });
    expect(saved).toMatchObject({
      userId: ME,
      title: "Untitled video",
      language: "hi",
      lengthPreset: 90,
      audience: "college",
      boardOrExam: "jee",
      styleId: "midnight",
      voiceGender: "male",
      captionsEnabled: false,
      status: "idea_draft",
      attention: null,
      currentStoryboardVersion: null,
      currentTimelineId: null,
      latestRenderId: null,
      exportOutdated: false,
      postedAt: null,
      permalink: null,
      duplicatedFrom: null,
      revisionCount: 0,
      rev: 0,
      deletedAt: null,
      purgeAt: null,
    });
    expect(saved).not.toHaveProperty("failedStep");
    expect(saved!.statusChangedAt).toEqual(saved!.createdAt);
  });

  it("creates the project's empty idea session with it", async () => {
    const p = await createProject(ME, PROFILE);
    const idea = await state.db.collection("idea_sessions").findOne({ projectId: p._id });
    expect(idea).toMatchObject({ userId: ME, schemaVersion: 1, mode: "topic", topicInput: "", ideaInput: "", notesText: "", suggestions: [], brief: null, rev: 0 });
  });

  it("lets the request override title, language, length and voice", async () => {
    const p = await createProject(ME, PROFILE, { title: "  Why is the sky blue?  ", language: "en", lengthPreset: 60, voiceGender: "female" });
    expect(p).toMatchObject({ title: "Why is the sky blue?", language: "en", lengthPreset: 60, voiceGender: "female", audience: "college" });
  });

  it("saves nothing if the idea session can't be created (one transaction)", async () => {
    state.failIdeaInsert = true;
    await expect(createProject(ME, PROFILE)).rejects.toThrow("idea insert failed");
    expect(await state.db.collection("projects").countDocuments()).toBe(0);
    expect(await state.db.collection("idea_sessions").countDocuments()).toBe(0);
  });
});

describe("duplicateProject", () => {
  it("copies the settings and the idea, and starts the copy fresh", async () => {
    const src = await createProject(ME, PROFILE, { title: "Photosynthesis" });
    await state.db.collection("idea_sessions").updateOne({ projectId: src._id }, { $set: { mode: "notes", notesText: "Chapter 6 notes", rev: 5 } });
    await state.db.collection("projects").updateOne({ _id: src._id }, { $set: { rev: 3, revisionCount: 4 } });

    const copyId = await duplicateProject(ME, src._id.toHexString());
    const copy = await state.db.collection("projects").findOne({ _id: new ObjectId(copyId!) });
    expect(copy).toMatchObject({ title: "Photosynthesis (copy)", language: "hi", voiceGender: "male", status: "idea_draft", duplicatedFrom: src._id, rev: 0, revisionCount: 0 });
    expect(await state.db.collection("idea_sessions").findOne({ projectId: copy!._id })).toMatchObject({ mode: "notes", notesText: "Chapter 6 notes", rev: 0 });
    expect(await state.db.collection("idea_sessions").findOne({ projectId: src._id })).toMatchObject({ notesText: "Chapter 6 notes", rev: 5 });
  });

  it("gives an M1-draft project without an idea session an empty one, and drops failedStep", async () => {
    const [old] = await seed([project(1)]);
    const copyId = await duplicateProject(ME, old._id.toHexString());
    const copy = await state.db.collection("projects").findOne({ _id: new ObjectId(copyId!) });
    expect(copy).not.toHaveProperty("failedStep");
    expect(await state.db.collection("idea_sessions").countDocuments({ projectId: copy!._id })).toBe(1);
  });

  it("copies only the settings: no stray or later fields come along from the source", async () => {
    const [src] = await seed([project(1, { latestRenderId: new ObjectId(), permalink: "https://instagram.com/p/x", postedAt: base, status: "posted" })]);
    await state.db.collection("projects").updateOne({ _id: src._id }, { $set: { someFutureField: "keep out" } });
    const copy = await state.db.collection("projects").findOne({ _id: new ObjectId((await duplicateProject(ME, src._id.toHexString()))!) });
    expect(copy).toMatchObject({ status: "idea_draft", latestRenderId: null, permalink: null, postedAt: null, title: "Video 1 (copy)" });
    expect(copy).not.toHaveProperty("someFutureField");
  });

  it("can't copy another user's project", async () => {
    const [theirs] = await seed([project(1, { userId: OTHER })]);
    expect(await duplicateProject(ME, theirs._id.toHexString())).toBeNull();
  });
});

describe("softDeleteProject", () => {
  it("follows the status rules: not while the video is being posted to Instagram", async () => {
    const [publishing, draft] = await seed([project(1, { status: "publishing" }), project(2)]);
    expect(await softDeleteProject(ME, publishing._id.toHexString())).toBe(false);
    expect(await state.db.collection("projects").findOne({ _id: publishing._id })).toMatchObject({ deletedAt: null });
    expect(await softDeleteProject(ME, draft._id.toHexString())).toBe(true);
  });
});

describe("purgeExpiredProjects", () => {
  it("removes expired projects together with their idea sessions, and nothing else", async () => {
    const old = await createProject(ME, PROFILE, { title: "Old" });
    const kept = await createProject(ME, PROFILE, { title: "Kept" });
    const past = new Date(Date.now() - 1000);
    await state.db.collection("projects").updateOne({ _id: old._id }, { $set: { deletedAt: past, purgeAt: past } });
    expect(await purgeExpiredProjects()).toBe(1);
    expect(await state.db.collection("projects").countDocuments({ _id: old._id })).toBe(0);
    expect(await state.db.collection("idea_sessions").countDocuments({ projectId: old._id })).toBe(0);
    expect(await state.db.collection("idea_sessions").countDocuments({ projectId: kept._id })).toBe(1);
  });

  it("with ids, removes only those projects (the ones whose files the job deleted)", async () => {
    const [a, b] = await seed([project(1), project(2)]);
    const past = new Date(Date.now() - 1000);
    await state.db.collection("projects").updateMany({}, { $set: { deletedAt: past, purgeAt: past } });
    expect(await purgeExpiredProjects(new Date(), [a._id.toHexString()])).toBe(1);
    expect(await state.db.collection("projects").countDocuments({ _id: b._id })).toBe(1);
  });
});

describe("deleteAllForUser", () => {
  it("removes the user's projects, idea sessions and profile, and nobody else's", async () => {
    await createProject(ME, PROFILE);
    const theirs = await createProject(OTHER, PROFILE);
    await deleteAllForUser(ME);
    expect(await state.db.collection("projects").countDocuments({ userId: ME })).toBe(0);
    expect(await state.db.collection("idea_sessions").countDocuments({ userId: ME })).toBe(0);
    expect(await state.db.collection("idea_sessions").countDocuments({ projectId: theirs._id })).toBe(1);
  });
});

describe("POST /api/v1/projects", () => {
  const post = (body: string | undefined, headers: Record<string, string> = {}) =>
    POST(new Request(`${APP}/api/v1/projects`, { method: "POST", headers: { origin: APP, "content-type": "application/json", ...headers }, body }));

  it("creates a project from the profile defaults: 201, Location and the Project resource", async () => {
    const res = await post("{}");
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(res.headers.get("location")).toBe(`/api/v1/projects/${body.id}`);
    expect(Object.keys(body).sort()).toEqual(
      [
        "activePublishJob", "allowedActions", "attention", "audience", "boardOrExam", "captionsEnabled", "coverUrl", "createdAt",
        "currentStoryboardVersion", "exportOutdated", "id", "language", "latestRender", "lengthPreset", "permalink", "postedAt",
        "rev", "revisionCount", "status", "styleId", "title", "updatedAt", "voiceGender",
      ].sort(),
    );
    expect(body).toMatchObject({ title: "Untitled video", status: "idea_draft", language: "en", lengthPreset: 60, voiceGender: "female", audience: "students", rev: 0 });
    expect(body.allowedActions).toEqual(["edit_idea", "generate", "rename", "delete", "duplicate"]);
    expect(await state.db.collection("idea_sessions").countDocuments({ projectId: new ObjectId(body.id as string) })).toBe(1);
  });

  it("uses the values sent and shows the new project first in the list", async () => {
    const body = await (await post(JSON.stringify({ title: "प्रकाश संश्लेषण", language: "hi", lengthPreset: 90, voiceGender: "male" }))).json();
    expect(body).toMatchObject({ title: "प्रकाश संश्लेषण", language: "hi", lengthPreset: 90, voiceGender: "male" });
    const list = await (await GET(new Request(`${APP}/api/v1/projects`))).json();
    expect(list.items[0].id).toBe(body.id);
  });

  it("counts the 80-character title limit in characters, like rename and the database", async () => {
    const res = await post(JSON.stringify({ title: "🎬".repeat(80) }));
    expect(res.status).toBe(201);
    expect(Array.from((await res.json()).title as string)).toHaveLength(80);
    expect((await post(JSON.stringify({ title: "🎬".repeat(81) }))).status).toBe(400);
  });

  it("rejects invalid or unknown fields", async () => {
    for (const bad of [{ lengthPreset: 70 }, { language: "fr" }, { voiceGender: "robot" }, { title: "" }, { title: "x".repeat(81) }, { status: "posted" }]) {
      const res = await post(JSON.stringify(bad));
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(await state.db.collection("projects").countDocuments()).toBe(0);
  });

  it("is protected like every write: Origin, JSON and a verified user", async () => {
    expect((await post("{}", { origin: "https://evil.example" })).status).toBe(403);
    expect((await post("title=x", { "content-type": "application/x-www-form-urlencoded" })).status).toBe(415);
    sessionUser.mockResolvedValue({ id: ME, name: "Asha", email: "asha@example.com", emailVerified: false, image: null, createdAt: base });
    expect((await post("{}")).status).toBe(403);
    expect(await state.db.collection("projects").countDocuments()).toBe(0);
  });
});
