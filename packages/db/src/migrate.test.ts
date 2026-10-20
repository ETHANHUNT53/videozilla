import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient, MongoServerError, ObjectId, type CollectionInfo, type Db, type Document } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AUTH_COLLECTIONS, COLLECTIONS } from "./collections";
import * as enums from "./enums";
import { listMigrations, migrationStatus, runMigrations } from "./migrate";
import { assertMigrated, LATEST_MIGRATION } from "./schema-version";
import { truncateChars } from "./text";

/** Reuse the MongoDB binary `npm run db` already downloaded, so tests don't fetch ~100 MB again. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CACHED_BINARY_DIR = path.join(ROOT, "apps/web/node_modules/.cache/mongodb-memory-server");

let server: MongoMemoryServer;
let client: MongoClient;
let db: Db;
const quiet = { log: () => {} };

beforeAll(async () => {
  server = await MongoMemoryServer.create(existsSync(CACHED_BINARY_DIR) ? { binary: { downloadDir: CACHED_BINARY_DIR } } : {});
  client = await MongoClient.connect(server.getUri());
}, 120_000);

afterAll(async () => {
  await client?.close();
  await server?.stop();
});

/** A new, empty database on the test server. */
const freshDb = () => client.db(`t_${new ObjectId().toHexString()}`);

const USER = "6ad20f12aa355a5a9f3db9cb";
const now = new Date();

/** Inserting `doc` into `collection` fails the database validator. */
async function rejected(collection: string, doc: Document) {
  const err = await db.collection(collection).insertOne(doc).then(() => null, (e: unknown) => e);
  return err instanceof MongoServerError && err.code === 121;
}

const project = (over: Document = {}) => ({
  userId: USER,
  title: "Why is the sky blue?",
  language: "en",
  lengthPreset: 60,
  audience: "students",
  styleId: "midnight",
  voiceGender: "female",
  status: "idea_draft",
  rev: 0,
  deletedAt: null,
  purgeAt: null,
  createdAt: now,
  updatedAt: now,
  ...over,
});

const profile = (over: Document = {}) => ({
  userId: USER,
  displayName: "Asha",
  defaultLanguage: "en",
  defaultLengthPreset: 60,
  defaultVoiceGender: "female",
  defaultStyleId: "midnight",
  defaultAudience: "students",
  timezone: "Asia/Kolkata",
  emailNotifications: true,
  role: "user",
  createdAt: now,
  updatedAt: now,
  ...over,
});

const run = (projectId = new ObjectId(), over: Document = {}) => ({
  projectId,
  userId: USER,
  kind: "storyboard",
  status: "queued",
  active: true,
  trigger: { by: "user" },
  idempotencyKey: new ObjectId().toHexString(),
  steps: [],
  createdAt: now,
  updatedAt: now,
  ...over,
});

/** Every migration file, in order (so these tests don't change when a migration is added). */
const allMigrations = async () => (await listMigrations()).map((f) => f.name);

describe("runMigrations", () => {
  beforeEach(() => {
    db = freshDb();
  });

  it("creates every collection and the whole index catalogue", async () => {
    const result = await runMigrations(db, quiet);
    expect(result).toEqual({ applied: await allMigrations(), alreadyApplied: [] });
    expect(result.applied.slice(0, 2)).toEqual(["001_initial_schema", "002_profile_defaults"]);

    const names = (await db.listCollections().toArray()).map((c) => c.name).sort();
    expect(names).toEqual([...Object.values(COLLECTIONS), ...Object.values(AUTH_COLLECTIONS)].sort());

    let indexCount = 0;
    for (const name of names.filter((n) => n !== COLLECTIONS.migrations)) {
      indexCount += (await db.collection(name).indexes()).filter((i) => i.name !== "_id_").length;
    }
    expect(indexCount).toBe(38); // one per row of DB Design §8, plus user.email and rateLimit.key (004)
  });

  it("records each migration with a checksum and does nothing on the next run", async () => {
    await runMigrations(db, quiet);
    const files = await listMigrations();
    const records = await db.collection(COLLECTIONS.migrations).find().sort({ name: 1 }).toArray();
    expect(records.map((r) => [r.name, r.checksum])).toEqual(files.map((f) => [f.name, f.checksum]));

    expect(await runMigrations(db, quiet)).toEqual({ applied: [], alreadyApplied: await allMigrations() });
    expect((await migrationStatus(db)).map((m) => m.state)).toEqual(files.map(() => "applied"));
  });

  it("refuses to run when an applied migration was edited", async () => {
    await runMigrations(db, quiet);
    await db.collection(COLLECTIONS.migrations).updateOne({ name: "001_initial_schema" }, { $set: { checksum: "something-else" } });
    await expect(runMigrations(db, quiet)).rejects.toThrow("Migration 001_initial_schema was changed after it was applied");
    expect((await migrationStatus(db))[0].state).toBe("changed");
  });

  it("applies only migrations that haven't run yet", async () => {
    await runMigrations(db, quiet);
    // A folder with just a new migration: 001 and 002 are already recorded, so only 003 runs.
    const dir = await mkdtemp(path.join(tmpdir(), "vz-migrations-"));
    try {
      await writeFile(path.join(dir, "003_add_flag.ts"), `export default { async up({ db }) { await db.collection("config").insertOne({ key: "flag", value: 1 }); } };\n`);
      await writeFile(path.join(dir, "notes.md"), "ignored");
      const logs: string[] = [];
      expect((await runMigrations(db, { dir, log: (m) => logs.push(m) })).applied).toEqual(["003_add_flag"]);
      expect(await db.collection("config").countDocuments({ key: "flag" })).toBe(1);
      expect(logs).toContain("warning: migration 001_initial_schema was applied but its file is missing");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not record a migration that fails, and releases the lock", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vz-migrations-"));
    try {
      await writeFile(path.join(dir, "001_broken.ts"), `export default { async up() { throw new Error("boom"); } };\n`);
      await expect(runMigrations(db, { ...quiet, dir })).rejects.toThrow("Migration 001_broken failed: boom");
      expect(await db.collection(COLLECTIONS.migrations).countDocuments()).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("waits for another run's lock, but takes over a stale one", async () => {
    await db.collection(COLLECTIONS.migrations).insertOne({ name: "__lock__", lockedAt: new Date(), holder: "other" });
    await expect(runMigrations(db, quiet)).rejects.toThrow("Another migration run is in progress");

    await db.collection(COLLECTIONS.migrations).updateOne({ name: "__lock__" }, { $set: { lockedAt: new Date(Date.now() - 60 * 60_000) } });
    expect((await runMigrations(db, quiet)).applied).toEqual(await allMigrations());
    expect(await db.collection(COLLECTIONS.migrations).countDocuments({ name: "__lock__" })).toBe(0);
  });

  it("stops when another run took the lock over, and leaves that run's lock alone", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "vz-migrations-"));
    try {
      // 001 runs so long that another run takes the lock over meanwhile; 002 must then not start.
      await writeFile(
        path.join(dir, "001_slow.ts"),
        `export default { async up({ db }) { await db.collection("migrations").updateOne({ name: "__lock__" }, { $set: { holder: "other" } }); } };\n`,
      );
      await writeFile(path.join(dir, "002_next.ts"), `export default { async up({ db }) { await db.collection("config").insertOne({ key: "next" }); } };\n`);
      await expect(runMigrations(db, { ...quiet, dir })).rejects.toThrow("Lost the migrations lock");
      expect(await db.collection("config").countDocuments({ key: "next" })).toBe(0);
      expect(await db.collection(COLLECTIONS.migrations).findOne({ name: "__lock__" })).toMatchObject({ holder: "other" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lists applied migrations whose file is gone as missing", async () => {
    await runMigrations(db, quiet);
    const dir = await mkdtemp(path.join(tmpdir(), "vz-migrations-"));
    try {
      expect((await migrationStatus(db, { dir })).map((m) => [m.name, m.state])).toEqual((await allMigrations()).map((name) => [name, "missing"]));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("upgrades a database created by the M1 draft", async () => {
    await db.collection("projects").createIndex({ userId: 1, deletedAt: 1, updatedAt: -1 }, { name: "library" });
    await db.collection("projects").createIndex({ purgeAt: 1 }, { name: "purge", partialFilterExpression: { purgeAt: { $type: "date" } } });
    await db.collection("profiles").createIndex({ userId: 1 }, { unique: true, name: "user" });
    const old = profile();
    delete (old as Document).defaultAudience;
    delete (old as Document).role;
    await db.collection("profiles").insertOne(old);
    await db.collection("projects").insertOne({ ...project(), failedStep: null, currentStoryboardVersion: null });

    await runMigrations(db, quiet);
    expect(await db.collection("profiles").findOne({ userId: USER })).toMatchObject({ defaultAudience: "students", role: "user" });
    const library = (await db.collection("projects").indexes()).find((i) => i.name === "library");
    expect(library?.key).toEqual({ userId: 1, deletedAt: 1, updatedAt: -1, _id: -1 });
  });

  it("004 stops with a clear message when an email already has two accounts, and drops repeated rate-limit rows", async () => {
    await db.collection("user").insertMany([{ email: "asha@example.com" }, { email: "ASHA@example.com" }]);
    await expect(runMigrations(db, quiet)).rejects.toThrow("belong to more than one account (for example asha@example.com)");
    await db.collection("user").deleteOne({ email: "ASHA@example.com" });
    await db.collection("rateLimit").insertMany([{ key: "k", count: 1 }, { key: "k", count: 2 }]);
    await runMigrations(db, quiet);
    expect(await db.collection("rateLimit").countDocuments({ key: "k" })).toBe(1);
  });

  it("gives every existing project (deleted ones too) exactly one empty idea session", async () => {
    const live = (await db.collection("projects").insertOne(project())).insertedId;
    const deleted = (await db.collection("projects").insertOne(project({ deletedAt: new Date(), purgeAt: new Date() }))).insertedId;
    const hasOne = (await db.collection("projects").insertOne(project())).insertedId;
    await db.collection("idea_sessions").insertOne({ projectId: hasOne, userId: USER, schemaVersion: 1, mode: "notes", notesText: "mine", rev: 4 });

    await runMigrations(db, quiet);
    for (const projectId of [live, deleted, hasOne]) expect(await db.collection("idea_sessions").countDocuments({ projectId })).toBe(1);
    expect(await db.collection("idea_sessions").findOne({ projectId: live })).toMatchObject({ userId: USER, schemaVersion: 1, mode: "topic", rev: 0, brief: null, suggestions: [] });
    expect(await db.collection("idea_sessions").findOne({ projectId: hasOne })).toMatchObject({ mode: "notes", notesText: "mine", rev: 4 });
  });
});

describe("database validators", () => {
  beforeAll(async () => {
    db = freshDb();
    await runMigrations(db, quiet);
  });

  it("accepts a valid project and profile (the shapes the web app writes)", async () => {
    await db.collection("projects").insertOne(project({ failedStep: null, currentStoryboardVersion: null }));
    await db.collection("profiles").insertOne(profile());
  });

  it.each([
    ["an unknown status", { status: "done" }],
    ["an empty title", { title: "" }],
    ["a 70-second length", { lengthPreset: 70 }],
    ["an unapproved voice", { voiceGender: "robot" }],
    ["a userId that isn't a user id", { userId: "not-a-user" }],
    ["deletedAt without purgeAt", { deletedAt: now }],
    ["a fractional rev", { rev: 1.5 }],
  ])("rejects a project with %s", async (_, over) => {
    expect(await rejected("projects", project(over))).toBe(true);
  });

  it("accepts a soft-deleted project with both deletedAt and purgeAt", async () => {
    expect(await rejected("projects", project({ deletedAt: now, purgeAt: now }))).toBe(false);
  });

  it("requires the profile defaults, including audience and role", async () => {
    const missingRole: Document = profile();
    delete missingRole.role;
    expect(await rejected("profiles", missingRole)).toBe(true);
    expect(await rejected("profiles", profile({ defaultAudience: "toddlers" }))).toBe(true);
    expect(await rejected("profiles", profile({ displayName: "x".repeat(61) }))).toBe(true);
  });

  it("keeps pipeline_runs.active in step with the status", async () => {
    expect(await rejected("pipeline_runs", run(undefined, { status: "succeeded", active: true }))).toBe(true);
    expect(await rejected("pipeline_runs", run(undefined, { status: "running", active: false }))).toBe(true);
    expect(await rejected("pipeline_runs", run(undefined, { status: "succeeded", active: false }))).toBe(false);
  });

  it("requires a lease on claimed render jobs", async () => {
    const job = { renderId: new ObjectId(), projectId: new ObjectId(), userId: USER, timelineKey: "k", priority: 0, attempt: 1, progress: 0, createdAt: now, updatedAt: now };
    expect(await rejected("render_jobs", { ...job, status: "claimed" })).toBe(true);
    expect(await rejected("render_jobs", { ...job, status: "claimed", agentId: "pc-1", leaseExpiresAt: now })).toBe(false);
    expect(await rejected("render_jobs", { ...job, renderId: new ObjectId(), status: "queued", attempt: 4 })).toBe(true);
  });

  it("requires scheduledAt for scheduled posts", async () => {
    const post = {
      projectId: new ObjectId(), userId: USER, renderId: new ObjectId(), igAccountId: new ObjectId(), caption: "Sky", shareToFeed: true,
      waitForNewExport: false, status: "scheduled", attempts: 0, idempotencyKey: "a", active: true, rev: 0, createdAt: now, updatedAt: now,
    };
    expect(await rejected("publish_jobs", { ...post, mode: "scheduled" })).toBe(true);
    expect(await rejected("publish_jobs", { ...post, mode: "scheduled", scheduledAt: now })).toBe(false);
  });

  it("keeps a token only on connected Instagram accounts", async () => {
    const account = { userId: USER, igUserId: "ig1", username: "asha", accountType: "BUSINESS", tokenExpiresAt: now, tokenRefreshedAt: now, scopes: [], createdAt: now, updatedAt: now };
    expect(await rejected("instagram_accounts", { ...account, status: "active", connected: true })).toBe(true);
    expect(await rejected("instagram_accounts", { ...account, status: "active", connected: true, accessTokenEnc: { v: 1 } })).toBe(false);
    expect(await rejected("instagram_accounts", { ...account, status: "disconnected", connected: true })).toBe(true);
  });

  it("allows only one kind of timeline payload", async () => {
    const t = { projectId: new ObjectId(), userId: USER, storyboardVersion: 1, styleId: "midnight", schemaVersion: 1, durationMs: 1, voiceTrackIds: [], speed: 1, syncReport: {}, createdAt: now };
    expect(await rejected("timelines", { ...t, hash: "a", data: {}, dataKey: "k" })).toBe(true);
    expect(await rejected("timelines", { ...t, hash: "b" })).toBe(true);
    expect(await rejected("timelines", { ...t, hash: "c", dataKey: "k" })).toBe(false);
  });
});

describe("unique and partial indexes", () => {
  beforeAll(async () => {
    db = freshDb();
    await runMigrations(db, quiet);
  });

  const duplicate = (p: Promise<unknown>) => p.then(() => false, (e: unknown) => e instanceof MongoServerError && e.code === 11000);

  it("allows only one active pipeline run per project and kind", async () => {
    const projectId = new ObjectId();
    await db.collection("pipeline_runs").insertOne(run(projectId));
    expect(await duplicate(db.collection("pipeline_runs").insertOne(run(projectId)))).toBe(true);
    expect(await duplicate(db.collection("pipeline_runs").insertOne(run(projectId, { kind: "build" })))).toBe(false);
    expect(await duplicate(db.collection("pipeline_runs").insertOne(run(projectId, { status: "failed", active: false })))).toBe(false);
  });

  it("allows only one latest render per project", async () => {
    const projectId = new ObjectId();
    const render = (isLatest: boolean) => ({ projectId, userId: USER, timelineId: new ObjectId(), status: "exported", progress: 100, isLatest, createdAt: now, updatedAt: now });
    await db.collection("renders").insertOne(render(true));
    expect(await duplicate(db.collection("renders").insertOne(render(true)))).toBe(true);
    expect(await duplicate(db.collection("renders").insertOne(render(false)))).toBe(false);
  });

  it("allows one sign-in account per email and one rate-limit row per key (Better Auth, 004)", async () => {
    await db.collection("user").insertOne({ email: "asha@example.com", name: "Asha" });
    expect(await duplicate(db.collection("user").insertOne({ email: "asha@example.com", name: "Someone else" }))).toBe(true);
    await db.collection("rateLimit").insertOne({ key: "1.2.3.4|/sign-in/email", count: 1, lastRequest: Date.now() });
    expect(await duplicate(db.collection("rateLimit").insertOne({ key: "1.2.3.4|/sign-in/email", count: 1, lastRequest: Date.now() }))).toBe(true);
  });

  it("allows one profile per user", async () => {
    await db.collection("profiles").insertOne(profile());
    expect(await duplicate(db.collection("profiles").insertOne(profile()))).toBe(true);
  });

  it("expires notifications after 90 days and AI call logs after 180", async () => {
    const ttl = async (c: string) => (await db.collection(c).indexes()).find((i) => i.expireAfterSeconds !== undefined)?.expireAfterSeconds;
    expect(await ttl("notifications")).toBe(90 * 86_400);
    expect(await ttl("ai_calls")).toBe(180 * 86_400);
    expect(await ttl("usage_counters")).toBe(0);
  });
});

describe("validator enums match src/enums.ts", () => {
  beforeAll(async () => {
    db = freshDb();
    await runMigrations(db, quiet);
  });

  it.each([
    ["projects", "status", enums.PROJECT_STATUSES],
    ["projects", "language", enums.LANGUAGES],
    ["projects", "voiceGender", enums.VOICE_GENDERS],
    ["projects", "audience", enums.AUDIENCES],
    ["profiles", "role", enums.PROFILE_ROLES],
    ["storyboard_versions", "source", enums.STORYBOARD_SOURCES],
    ["chat_messages", "thread", enums.CHAT_THREADS],
    ["renders", "status", enums.RENDER_STATUSES],
    ["render_jobs", "status", enums.RENDER_JOB_STATUSES],
    ["publish_jobs", "status", enums.PUBLISH_JOB_STATUSES],
    ["pipeline_runs", "kind", enums.PIPELINE_RUN_KINDS],
    ["pipeline_runs", "status", enums.PIPELINE_RUN_STATUSES],
    ["instagram_accounts", "status", enums.IG_ACCOUNT_STATUSES],
    ["voice_tracks", "timingSource", enums.TIMING_SOURCES],
  ] as const)("%s.%s", async (collection, field, expected) => {
    const [info] = await db.listCollections({ name: collection }, { nameOnly: false }).toArray();
    const validator = (info as CollectionInfo).options!.validator as Document;
    const jsonSchema = (validator.$jsonSchema ?? validator.$and[0].$jsonSchema) as Document;
    expect([...jsonSchema.properties[field].enum].sort()).toEqual([...expected].sort());
  });
});

describe("LATEST_MIGRATION", () => {
  it("is the last migration file", async () => {
    expect((await listMigrations()).at(-1)!.name).toBe(LATEST_MIGRATION);
  });

  it("assertMigrated fails on a database that hasn't been migrated, and passes after", async () => {
    db = freshDb();
    await expect(assertMigrated(db)).rejects.toThrow(`missing migration ${LATEST_MIGRATION}`);
    await runMigrations(db, quiet);
    await expect(assertMigrated(db)).resolves.toBeUndefined();
  });
});

describe("truncateChars", () => {
  it("counts characters like the database does and never splits an emoji", () => {
    expect(truncateChars("abc", 5)).toBe("abc");
    expect(truncateChars(`${"a".repeat(59)}🎬🎬`, 60)).toBe(`${"a".repeat(59)}🎬`);
    expect(truncateChars("प्रकाश", 3)).toHaveLength(3);
  });
});
