import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * F1.14 — cross-user security (System Design §13.2, API Design §17): user B must not be able to read, change, delete,
 * restore or copy user A's data through any /api/v1 route, and must get exactly the answer an unknown id gets.
 */

vi.mock("../db/mongo", async () => (await import("../../../test/mongo")).mongoModule);
const sessionUser = vi.hoisted(() => vi.fn());
vi.mock("../api/session", () => ({ sessionUser }));

import * as catchAll from "@/app/api/v1/[...path]/route";
import * as me from "@/app/api/v1/me/route";
import * as profile from "@/app/api/v1/me/profile/route";
import * as usage from "@/app/api/v1/me/usage/route";
import * as projects from "@/app/api/v1/projects/route";
import * as one from "@/app/api/v1/projects/[id]/route";
import * as duplicate from "@/app/api/v1/projects/[id]/duplicate/route";
import * as restore from "@/app/api/v1/projects/[id]/restore/route";
import { clearCollections, startTestMongo, stopTestMongo, testMongo } from "../../../test/mongo";
import { needsWelcome } from "../onboarding";
import { getOrCreateProfile, updateProfile } from "../repos/profiles";
import { createProject, deleteProject, getProject } from "../repos/projects";
import { consumeUsage } from "../repos/usage";

const APP = "http://localhost:3000";
const A = { id: new ObjectId().toHexString(), name: "Asha (A)", email: "a@example.com", emailVerified: true, image: null, createdAt: new Date() };
const B = { id: new ObjectId().toHexString(), name: "Bilal (B)", email: "b@example.com", emailVerified: true, image: null, createdAt: new Date() };
const as = (user: typeof A | null) => sessionUser.mockResolvedValue(user);

type Handler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;
const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });

function req(method: string, url: string, init: { body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request(`${APP}${url}`, {
    method,
    headers: { ...(method !== "GET" && { origin: APP }), ...(init.body !== undefined && { "content-type": "application/json" }), ...init.headers },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

async function call(handler: Handler, method: string, url: string, params?: Record<string, string>, body?: unknown, headers?: Record<string, string>) {
  const res = await handler(req(method, url, { body, headers }), ctx(params));
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/** What A owns, created through the same services the app uses. */
let a: { live: string; deleted: string; attention: string; title: string };
let bProject: string;

beforeAll(startTestMongo, 120_000);
afterAll(stopTestMongo);
beforeEach(async () => {
  await clearCollections(["projects", "idea_sessions", "profiles", "pipeline_runs", "publish_jobs", "render_jobs", "usage_counters", "config"]);

  const aProfile = await getOrCreateProfile(A.id, A.name);
  await updateProfile(A.id, { defaultLanguage: "hi", about: "A's private topic", onboardingCompleted: true });
  const live = await createProject(A.id, aProfile, { title: "A secret: photosynthesis" });
  const deleted = await createProject(A.id, aProfile, { title: "A deleted video" });
  const attention = await createProject(A.id, aProfile, { title: "A needs attention" });
  await deleteProject(A.id, deleted._id.toHexString());
  await testMongo.db.collection("projects").updateOne(
    { _id: attention._id },
    { $set: { status: "needs_attention", attention: { kind: "build", step: "voice", errorCode: "X", message: "m", at: new Date() } } },
  );
  await testMongo.db.collection("pipeline_runs").insertOne(
    { projectId: live._id, userId: A.id, kind: "build", status: "running", active: true, trigger: { by: "user" }, idempotencyKey: "a-run", steps: [], createdAt: new Date(), updatedAt: new Date() },
  );
  await consumeUsage(A.id, "renders");
  await consumeUsage(A.id, "renders");
  a = { live: live._id.toHexString(), deleted: deleted._id.toHexString(), attention: attention._id.toHexString(), title: live.title };

  const bProfile = await getOrCreateProfile(B.id, B.name);
  bProject = (await createProject(B.id, bProfile, { title: "B's own video" }))._id.toHexString();

  vi.stubEnv("BETTER_AUTH_URL", APP);
  as(B);
});

/** A snapshot of everything A owns, to prove nothing changed. */
async function snapshotA() {
  const strip = (docs: Record<string, unknown>[]) => docs.map(({ _id, ...rest }) => ({ _id: String(_id), ...rest }));
  return {
    projects: strip(await testMongo.db.collection("projects").find({ userId: A.id }).sort({ _id: 1 }).toArray()),
    ideas: strip(await testMongo.db.collection("idea_sessions").find({ userId: A.id }).sort({ _id: 1 }).toArray()),
    profile: await testMongo.db.collection("profiles").findOne({ userId: A.id }, { projection: { _id: 0 } }),
    runs: strip(await testMongo.db.collection("pipeline_runs").find({ userId: A.id }).toArray()),
    usage: await testMongo.db.collection("usage_counters").findOne({ userId: A.id }, { projection: { _id: 0 } }),
  };
}

/** Same status and error as an id that doesn't exist (requestId aside), so nothing leaks about A's ids. */
async function expectLikeUnknown(handler: Handler, method: string, suffix: string, foreignId: string, body?: unknown) {
  const unknown = new ObjectId().toHexString();
  const foreign = await call(handler, method, `/api/v1/projects/${foreignId}${suffix}`, { id: foreignId }, body);
  const missing = await call(handler, method, `/api/v1/projects/${unknown}${suffix}`, { id: unknown }, body);
  expect(foreign.status).toBe(404);
  expect({ status: foreign.status, code: foreign.json?.error?.code, message: foreign.json?.error?.message, details: foreign.json?.error?.details }).toEqual({
    status: missing.status,
    code: missing.json?.error?.code,
    message: missing.json?.error?.message,
    details: missing.json?.error?.details,
  });
}

describe("B against A's projects (id routes)", () => {
  it("GET /projects/{id}: 404 like an unknown id, for live, deleted and needs-attention projects", async () => {
    for (const id of [a.live, a.deleted, a.attention]) await expectLikeUnknown(one.GET, "GET", "", id);
  });

  it("PATCH /projects/{id}: 404, with or without If-Match, and A's project is unchanged", async () => {
    const before = await snapshotA();
    await expectLikeUnknown(one.PATCH, "PATCH", "", a.live, { title: "Hacked by B" });
    for (const headers of [{ "if-match": '"0"' }, { "if-match": "*" }]) {
      expect((await call(one.PATCH, "PATCH", `/api/v1/projects/${a.live}`, { id: a.live }, { title: "Hacked", language: "en" }, headers)).status).toBe(404);
    }
    expect(await snapshotA()).toEqual(before);
  });

  it("DELETE /projects/{id}: 404; A's project isn't deleted and A's running job isn't cancelled", async () => {
    const before = await snapshotA();
    await expectLikeUnknown(one.DELETE, "DELETE", "", a.live);
    expect(await snapshotA()).toEqual(before);
  });

  it("POST /projects/{id}/restore: 404; A's deleted project stays deleted", async () => {
    const before = await snapshotA();
    await expectLikeUnknown(restore.POST, "POST", "/restore", a.deleted);
    expect((await call(restore.POST, "POST", `/api/v1/projects/${a.live}/restore`, { id: a.live })).status).toBe(404);
    expect(await snapshotA()).toEqual(before);
  });

  it("POST /projects/{id}/duplicate: 404; no copy is made for anyone and A's idea isn't copied", async () => {
    const before = await snapshotA();
    const countBefore = await testMongo.db.collection("projects").countDocuments();
    await expectLikeUnknown(duplicate.POST, "POST", "/duplicate", a.live);
    expect(await testMongo.db.collection("projects").countDocuments()).toBe(countBefore);
    expect(await testMongo.db.collection("idea_sessions").countDocuments({ userId: B.id })).toBe(1); // B's own only
    expect(await snapshotA()).toEqual(before);
  });

  it("the repository the project page uses gives B nothing either", async () => {
    expect(await getProject(B.id, a.live)).toBeNull();
    expect(await getProject(A.id, a.live)).not.toBeNull();
  });
});

describe("B's collection routes never show or touch A's data", () => {
  it("GET /projects: every filter, a search for A's title and A's own cursor return only B's projects", async () => {
    const aIds = [a.live, a.deleted, a.attention];
    for (const filter of ["all", "drafts", "ready", "scheduled", "posted", "attention"]) {
      const { json } = await call(projects.GET, "GET", `/api/v1/projects?filter=${filter}`);
      expect(json.items.every((p: { id: string }) => !aIds.includes(p.id)), filter).toBe(true);
      if (filter === "all") expect(json.items.map((p: { id: string }) => p.id)).toEqual([bProject]);
    }
    expect((await call(projects.GET, "GET", `/api/v1/projects?q=${encodeURIComponent("secret")}`)).json.items).toEqual([]);

    as(A);
    const aPage = await call(projects.GET, "GET", "/api/v1/projects?limit=1");
    expect(aPage.json.nextCursor).toBeTruthy();
    as(B);
    const withACursor = await call(projects.GET, "GET", `/api/v1/projects?limit=1&cursor=${aPage.json.nextCursor}`);
    expect(withACursor.json.items.every((p: { id: string }) => !aIds.includes(p.id))).toBe(true);
  });

  it("POST /projects: a userId in the body is rejected; B's new project is B's", async () => {
    const before = await snapshotA();
    expect((await call(projects.POST, "POST", "/api/v1/projects", undefined, { title: "x", userId: A.id })).status).toBe(400);
    const created = await call(projects.POST, "POST", "/api/v1/projects", undefined, { title: "Mine" });
    expect(created.status).toBe(201);
    expect((await testMongo.db.collection("projects").findOne({ _id: new ObjectId(created.json.id as string) }))!.userId).toBe(B.id);
    expect(await snapshotA()).toEqual(before);
  });

  it("GET /me and GET /me/usage show only B's own data", async () => {
    const meRes = await call(me.GET, "GET", "/api/v1/me");
    expect(meRes.json.user.id).toBe(B.id);
    expect(meRes.json.profile).toMatchObject({ defaultLanguage: "en", about: null });
    const usageRes = await call(usage.GET, "GET", "/api/v1/me/usage");
    expect(usageRes.json.counters.renders.used).toBe(0); // A used 2
  });

  it("PATCH /me/profile changes only B's profile; userId / role in the body are rejected", async () => {
    const before = await snapshotA();
    for (const body of [{ userId: A.id, defaultLanguage: "hi" }, { role: "admin" }, { _id: "x" }]) {
      expect((await call(profile.PATCH, "PATCH", "/api/v1/me/profile", undefined, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await call(profile.PATCH, "PATCH", "/api/v1/me/profile", undefined, { about: "B's topic" })).json.about).toBe("B's topic");
    expect(await snapshotA()).toEqual(before);
  });

  it("onboarding is decided per user", async () => {
    expect(await needsWelcome(A.id)).toBe(false);
    expect(await needsWelcome(B.id)).toBe(false); // B has a project
    expect(await needsWelcome(new ObjectId().toHexString())).toBe(true);
  });
});

/** Every real handler: [label, handler, method, url, params]. */
const HANDLERS: [string, Handler, string, string, Record<string, string>?][] = [
  ["GET /me", me.GET, "GET", "/api/v1/me"],
  ["PATCH /me/profile", profile.PATCH, "PATCH", "/api/v1/me/profile"],
  ["GET /me/usage", usage.GET, "GET", "/api/v1/me/usage"],
  ["GET /projects", projects.GET, "GET", "/api/v1/projects"],
  ["POST /projects", projects.POST, "POST", "/api/v1/projects"],
  ["GET /projects/{id}", one.GET, "GET", "/api/v1/projects/x", { id: "x" }],
  ["PATCH /projects/{id}", one.PATCH, "PATCH", "/api/v1/projects/x", { id: "x" }],
  ["DELETE /projects/{id}", one.DELETE, "DELETE", "/api/v1/projects/x", { id: "x" }],
  ["POST /projects/{id}/restore", restore.POST, "POST", "/api/v1/projects/x/restore", { id: "x" }],
  ["POST /projects/{id}/duplicate", duplicate.POST, "POST", "/api/v1/projects/x/duplicate", { id: "x" }],
];

describe("every route needs a session, and a verified email", () => {
  it.each(HANDLERS)("%s: 401 signed out", async (_, handler, method, url, params) => {
    as(null);
    expect((await call(handler, method, url, params, method === "GET" ? undefined : { title: "x" })).status).toBe(401);
  });

  it.each(HANDLERS)("%s: 403 with an unverified email (except GET /me)", async (label, handler, method, url, params) => {
    as({ ...B, emailVerified: false });
    const { status } = await call(handler, method, url, params, method === "GET" ? undefined : { title: "x" });
    expect(status).toBe(label === "GET /me" ? 200 : 403);
  });

  it("unknown /api/v1 paths are 404 for everyone", async () => {
    expect((await call(catchAll.GET as Handler, "GET", "/api/v1/users", { path: "users" })).status).toBe(404);
  });
});

describe("coverage", () => {
  it("every /api/v1 route file is in this suite (add a cross-user case when you add a route)", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../app/api/v1");
    const found: string[] = [];
    const walk = (dir: string, rel: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full, `${rel}/${name}`);
        else if (name === "route.ts") found.push(rel || "/");
      }
    };
    walk(root, "");
    const covered = new Set(["/[...path]", ...HANDLERS.map(([label]) => label.split(" ")[1].replace("{id}", "[id]"))]);
    expect(found.sort()).toEqual([...covered].sort());
  });
});
