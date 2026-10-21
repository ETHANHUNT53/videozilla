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
    storyboardVersions: () => state.db.collection("storyboard_versions"),
    pipelineRuns: () => state.db.collection("pipeline_runs"),
    publishJobs: () => state.db.collection("publish_jobs"),
    renderJobs: () => state.db.collection("render_jobs"),
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
import * as one from "@/app/api/v1/projects/[id]/route";
import * as duplicateRoute from "@/app/api/v1/projects/[id]/duplicate/route";
import * as restoreRoute from "@/app/api/v1/projects/[id]/restore/route";
import { ApiError } from "../api/errors";
import { createProject, deleteProject, duplicateProject, listProjects, normalizeSearch, purgeExpiredProjects, restoreProject, updateProject } from "./projects";

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

// One migrated database for the whole file (migrating builds 36 indexes, too slow to repeat per test); each test
// starts from empty collections instead.
const TOUCHED = ["projects", "idea_sessions", "profiles", "pipeline_runs", "publish_jobs", "render_jobs"];
let migrated: Db | undefined;

beforeEach(async () => {
  if (!migrated) {
    migrated = client.db(`t_${new ObjectId().toHexString()}`);
    await runMigrations(migrated, { log: () => {} });
  }
  state.db = migrated;
  await Promise.all(TOUCHED.map((name) => migrated!.collection(name).deleteMany({})));
  state.failIdeaInsert = false;
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
    const copy = await state.db.collection("projects").findOne({ _id: copyId!._id });
    expect(copy).toMatchObject({ title: "Photosynthesis (copy)", language: "hi", voiceGender: "male", status: "idea_draft", duplicatedFrom: src._id, rev: 0, revisionCount: 0 });
    expect(await state.db.collection("idea_sessions").findOne({ projectId: copy!._id })).toMatchObject({ mode: "notes", notesText: "Chapter 6 notes", rev: 0 });
    expect(await state.db.collection("idea_sessions").findOne({ projectId: src._id })).toMatchObject({ notesText: "Chapter 6 notes", rev: 5 });
  });

  it("gives an M1-draft project without an idea session an empty one, and drops failedStep", async () => {
    const [old] = await seed([project(1)]);
    const copyId = await duplicateProject(ME, old._id.toHexString());
    const copy = await state.db.collection("projects").findOne({ _id: copyId!._id });
    expect(copy).not.toHaveProperty("failedStep");
    expect(await state.db.collection("idea_sessions").countDocuments({ projectId: copy!._id })).toBe(1);
  });

  it("copies only the settings: no stray or later fields come along from the source", async () => {
    const [src] = await seed([project(1, { latestRenderId: new ObjectId(), permalink: "https://instagram.com/p/x", postedAt: base, status: "posted" })]);
    await state.db.collection("projects").updateOne({ _id: src._id }, { $set: { someFutureField: "keep out" } });
    const copy = await state.db.collection("projects").findOne({ _id: (await duplicateProject(ME, src._id.toHexString()))!._id });
    expect(copy).toMatchObject({ status: "idea_draft", latestRenderId: null, permalink: null, postedAt: null, title: "Video 1 (copy)" });
    expect(copy).not.toHaveProperty("someFutureField");
  });

  it("can't copy another user's project", async () => {
    const [theirs] = await seed([project(1, { userId: OTHER })]);
    expect(await duplicateProject(ME, theirs._id.toHexString())).toBeNull();
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
    expect(body.allowedActions).toEqual(["edit_idea", "edit_script_settings", "generate", "rename", "delete", "duplicate"]);
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

  it("is protected like every write: Origin, JSON and a session (an unverified email is fine since 2026-10-20)", async () => {
    expect((await post("{}", { origin: "https://evil.example" })).status).toBe(403);
    expect((await post("title=x", { "content-type": "application/x-www-form-urlencoded" })).status).toBe(415);
    expect(await state.db.collection("projects").countDocuments()).toBe(0);
    sessionUser.mockResolvedValue({ id: ME, name: "Asha", email: "asha@example.com", emailVerified: false, image: null, createdAt: base });
    expect((await post("{}")).status).toBe(201);
  });
});

describe("updateProject", () => {
  const id = (p: ProjectDoc) => p._id.toHexString();

  it("renames in any status that allows it and bumps rev", async () => {
    const [posted] = await seed([project(1, { status: "posted", rev: 2 })]);
    const res = await updateProject(ME, id(posted), { title: "  New title  " });
    expect(res).toMatchObject({ ok: true, requiresRegeneration: false, project: { title: "New title", rev: 3 } });
  });

  it("renames even while the video is being posted (title is editable in every status, DB Design §5.2)", async () => {
    const [p] = await seed([project(1, { status: "publishing" })]);
    expect(await updateProject(ME, id(p), { title: "Still fine" })).toMatchObject({ ok: true, project: { title: "Still fine" } });
  });

  it("changes script settings only before the build, and says a regeneration is needed on a storyboard", async () => {
    const [draft, ready, built] = await seed([project(1), project(2, { status: "storyboard_ready" }), project(3, { status: "preview_ready" })]);
    expect(await updateProject(ME, id(draft), { language: "hi", lengthPreset: 90 })).toMatchObject({ ok: true, requiresRegeneration: false, project: { language: "hi", lengthPreset: 90 } });
    expect(await updateProject(ME, id(ready), { audience: "kids" })).toMatchObject({ ok: true, requiresRegeneration: true });
    expect(await updateProject(ME, id(built), { language: "hi" })).toMatchObject({ ok: false, reason: "invalid_state", fields: ["language"] });
  });

  it("changes voice / captions only once there is a storyboard, and marks a built video's export outdated", async () => {
    const [draft, built] = await seed([project(1), project(2, { status: "exported" })]);
    expect(await updateProject(ME, id(draft), { voiceGender: "male" })).toMatchObject({ ok: false, reason: "invalid_state", fields: ["voiceGender"] });
    expect(await updateProject(ME, id(built), { captionsEnabled: true })).toMatchObject({ ok: true, project: { captionsEnabled: true, exportOutdated: true } });
  });

  it("treats unchanged values as no change (no rev bump, no status check)", async () => {
    const [p] = await seed([project(1, { status: "posted", rev: 4 })]);
    expect(await updateProject(ME, id(p), { language: "en", title: "Video 1" })).toMatchObject({ ok: true, project: { rev: 4 } });
  });

  it("applies If-Match: the right rev updates, a stale rev returns the current project", async () => {
    const [p] = await seed([project(1, { rev: 5 })]);
    expect(await updateProject(ME, id(p), { title: "A" }, 5)).toMatchObject({ ok: true, project: { title: "A", rev: 6 } });
    expect(await updateProject(ME, id(p), { title: "B" }, 5)).toMatchObject({ ok: false, reason: "precondition_failed", current: { title: "A", rev: 6 } });
  });

  it("can't touch another user's, a deleted or a malformed project", async () => {
    const [theirs, deleted] = await seed([project(1, { userId: OTHER }), project(2, { deletedAt: base, purgeAt: base })]);
    for (const target of [id(theirs), id(deleted), "nope"]) expect(await updateProject(ME, target, { title: "X" })).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("deleteProject", () => {
  const job = (projectId: ObjectId, over: Record<string, unknown>) => ({ projectId, userId: ME, createdAt: base, updatedAt: base, ...over });

  it("soft-deletes for 30 days and cancels active runs, scheduled posts and queued renders, in one go", async () => {
    const [p] = await seed([project(1, { status: "scheduled" })]);
    const pid = p._id;
    await state.db.collection("pipeline_runs").insertMany([
      job(pid, { kind: "build", status: "running", active: true, trigger: { by: "user" }, idempotencyKey: "r1", steps: [] }),
      job(pid, { kind: "storyboard", status: "succeeded", active: false, trigger: { by: "user" }, idempotencyKey: "r2", steps: [] }),
    ]);
    await state.db.collection("publish_jobs").insertOne(
      job(pid, { renderId: new ObjectId(), igAccountId: new ObjectId(), caption: "Sky", shareToFeed: true, mode: "scheduled", scheduledAt: base, waitForNewExport: false, status: "scheduled", attempts: 0, idempotencyKey: "p1", active: true, rev: 0 }),
    );
    await state.db.collection("render_jobs").insertOne(job(pid, { renderId: new ObjectId(), timelineKey: "k", status: "queued", priority: 0, attempt: 0, progress: 0 }));

    const res = await deleteProject(ME, pid.toHexString());
    expect(res).toMatchObject({ ok: true, cancelled: { runs: 1, scheduledPosts: 1 } });
    const days = ((res as { restoreUntil: Date }).restoreUntil.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(await state.db.collection("projects").findOne({ _id: pid })).toMatchObject({ deletedAt: expect.any(Date), purgeAt: expect.any(Date), rev: 1 });
    expect(await state.db.collection("pipeline_runs").countDocuments({ projectId: pid, active: true })).toBe(0);
    expect(await state.db.collection("publish_jobs").findOne({ projectId: pid })).toMatchObject({ status: "cancelled", active: false });
    expect(await state.db.collection("render_jobs").findOne({ projectId: pid })).toMatchObject({ status: "cancelled" });
  });

  it("is idempotent: deleting again returns the same restore date and cancels nothing", async () => {
    const [p] = await seed([project(1)]);
    const first = await deleteProject(ME, p._id.toHexString());
    const second = await deleteProject(ME, p._id.toHexString());
    expect(second).toEqual({ ok: true, restoreUntil: (first as { restoreUntil: Date }).restoreUntil, cancelled: { runs: 0, scheduledPosts: 0 } });
  });

  it("refuses while the video is being posted, and changes nothing", async () => {
    const [p] = await seed([project(1, { status: "publishing" })]);
    expect(await deleteProject(ME, p._id.toHexString())).toEqual({ ok: false, reason: "publish_in_progress" });
    expect(await state.db.collection("projects").findOne({ _id: p._id })).toMatchObject({ deletedAt: null, rev: 0 });
  });

  it("can't delete another user's project", async () => {
    const [theirs] = await seed([project(1, { userId: OTHER })]);
    expect(await deleteProject(ME, theirs._id.toHexString())).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("restoreProject", () => {
  it("brings a deleted project back", async () => {
    const [p] = await seed([project(1)]);
    await deleteProject(ME, p._id.toHexString());
    expect(await restoreProject(ME, p._id.toHexString())).toMatchObject({ deletedAt: null, purgeAt: null, status: "idea_draft", rev: 2 });
  });

  it.each([
    ["building", "storyboard_ready"],
    ["rendering", "preview_ready"],
    ["scheduled", "exported"],
    ["storyboard_generating", "idea_draft"],
    ["exported", "exported"],
  ] as const)("returns a project deleted while %s to %s (the cancelled work isn't revived)", async (from, to) => {
    const [p] = await seed([project(1, { status: from })]);
    await deleteProject(ME, p._id.toHexString());
    expect((await restoreProject(ME, p._id.toHexString()))!.status).toBe(to);
  });

  it("is gone after its purge date, and harmless on a project that isn't deleted", async () => {
    const [expired, live] = await seed([project(1, { deletedAt: base, purgeAt: new Date(Date.now() - 1000) }), project(2, { rev: 7 })]);
    expect(await restoreProject(ME, expired._id.toHexString())).toBeNull();
    expect(await restoreProject(ME, live._id.toHexString())).toMatchObject({ rev: 7 });
  });
});

describe("/api/v1/projects/{id} endpoints", () => {
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const req = (method: string, init: { body?: unknown; headers?: Record<string, string> } = {}) =>
    new Request(`${APP}/api/v1/projects/x`, {
      method,
      headers: { ...(method !== "GET" && { origin: APP }), ...(init.body !== undefined && { "content-type": "application/json" }), ...init.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

  it("GET returns the project with an ETag, and 404 for unknown, foreign or malformed ids", async () => {
    const [mine, theirs] = await seed([project(1, { rev: 3 }), project(2, { userId: OTHER })]);
    const res = await one.GET(req("GET"), ctx(mine._id.toHexString()));
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe('"3"');
    expect((await res.json()).allowedActions).toContain("rename");
    for (const target of [theirs._id.toHexString(), new ObjectId().toHexString(), "not-an-id"]) expect((await one.GET(req("GET"), ctx(target))).status).toBe(404);
  });

  it("PATCH renames with If-Match and answers a stale one with 412 and the current project", async () => {
    const [p] = await seed([project(1, { rev: 1 })]);
    const ok = await one.PATCH(req("PATCH", { body: { title: "Renamed" }, headers: { "if-match": '"1"' } }), ctx(p._id.toHexString()));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("etag")).toBe('"2"');
    expect(await ok.json()).toMatchObject({ title: "Renamed", rev: 2, requiresRegeneration: false });

    const stale = await one.PATCH(req("PATCH", { body: { title: "Again" }, headers: { "if-match": '"1"' } }), ctx(p._id.toHexString()));
    expect(stale.status).toBe(412);
    const error = (await stale.json()).error;
    expect(error.code).toBe("PRECONDITION_FAILED");
    expect(error.details[0].current).toMatchObject({ title: "Renamed", rev: 2 });
  });

  it("PATCH rejects bad input and says why a setting is locked", async () => {
    const [built] = await seed([project(1, { status: "preview_ready" })]);
    const target = ctx(built._id.toHexString());
    for (const body of [{}, { lengthPreset: 45 }, { status: "posted" }, { title: "" }]) expect((await one.PATCH(req("PATCH", { body }), target)).status, JSON.stringify(body)).toBe(400);
    // If-Match only in our strong form "<rev>": weak, bare or half-quoted values are 400, never a skipped check.
    for (const ifMatch of ["abc", 'W/"1"', "1", '"1', '1"']) {
      expect((await one.PATCH(req("PATCH", { body: { title: "x" }, headers: { "if-match": ifMatch } }), target)).status, ifMatch).toBe(400);
    }
    const locked = await one.PATCH(req("PATCH", { body: { language: "hi" } }), target);
    expect(locked.status).toBe(409);
    expect((await locked.json()).error).toMatchObject({ code: "INVALID_STATE", details: [{ field: "language", current: "preview_ready" }] });
  });

  it("DELETE then restore round-trips; delete while posting is 409", async () => {
    const [p, posting] = await seed([project(1), project(2, { status: "publishing" })]);
    const del = await one.DELETE(req("DELETE"), ctx(p._id.toHexString()));
    expect(await del.json()).toMatchObject({ ok: true, restoreUntil: expect.any(String), cancelled: { runs: 0, scheduledPosts: 0 } });
    expect((await one.GET(req("GET"), ctx(p._id.toHexString()))).status).toBe(404);

    const restored = await restoreRoute.POST(req("POST"), ctx(p._id.toHexString()));
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ id: p._id.toHexString(), status: "idea_draft" });

    const blocked = await one.DELETE(req("DELETE"), ctx(posting._id.toHexString()));
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.code).toBe("PUBLISH_IN_PROGRESS");
  });

  it("duplicate returns 201 with the copy, and 404 for someone else's project", async () => {
    const [p, theirs] = await seed([project(1, { status: "posted" }), project(2, { userId: OTHER })]);
    const res = await duplicateRoute.POST(req("POST"), ctx(p._id.toHexString()));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(res.headers.get("location")).toBe(`/api/v1/projects/${body.id}`);
    expect(body).toMatchObject({ title: "Video 1 (copy)", status: "idea_draft" });
    expect((await duplicateRoute.POST(req("POST"), ctx(theirs._id.toHexString()))).status).toBe(404);
  });

  it("writes need our Origin", async () => {
    const [p] = await seed([project(1)]);
    const res = await one.DELETE(req("DELETE", { headers: { origin: "https://evil.example" } }), ctx(p._id.toHexString()));
    expect(res.status).toBe(403);
    expect(await state.db.collection("projects").findOne({ _id: p._id })).toMatchObject({ deletedAt: null });
  });
});
