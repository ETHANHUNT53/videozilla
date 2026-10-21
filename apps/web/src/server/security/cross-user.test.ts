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
import * as idea from "@/app/api/v1/projects/[id]/idea/route";
import * as brief from "@/app/api/v1/projects/[id]/idea/brief/route";
import * as chat from "@/app/api/v1/projects/[id]/idea/chat/route";
import * as suggestions from "@/app/api/v1/projects/[id]/idea/suggestions/route";
import * as restore from "@/app/api/v1/projects/[id]/restore/route";
import * as status from "@/app/api/v1/projects/[id]/status/route";
import * as storyboard from "@/app/api/v1/projects/[id]/storyboard/route";
import * as generate from "@/app/api/v1/projects/[id]/storyboard/generate/route";
import * as social from "@/app/api/v1/projects/[id]/storyboard/social/route";
import * as rewrite from "@/app/api/v1/projects/[id]/storyboard/social/rewrite/route";
import * as versions from "@/app/api/v1/projects/[id]/storyboard/versions/route";
import * as oneVersion from "@/app/api/v1/projects/[id]/storyboard/versions/[version]/route";
import * as restoreVersion from "@/app/api/v1/projects/[id]/storyboard/versions/[version]/restore/route";
import { clearCollections, startTestMongo, stopTestMongo, testMongo } from "../../../test/mongo";
import { needsWelcome } from "../onboarding";
import { USER_DATA_COLLECTIONS } from "../repos/account";
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

/** Response headers that carry information about a resource; a foreign id must not get any an unknown one doesn't. */
const RESOURCE_HEADERS = ["etag", "location", "allow", "retry-after", "ratelimit-limit", "ratelimit-remaining", "ratelimit-reset", "cache-control", "content-type"];

async function call(handler: Handler, method: string, url: string, params?: Record<string, string>, body?: unknown, headers?: Record<string, string>) {
  const res = await handler(req(method, url, { body, headers }), ctx(params));
  const json = await res.json().catch(() => null);
  return { status: res.status, json, headers: Object.fromEntries(RESOURCE_HEADERS.map((h) => [h, res.headers.get(h)])) };
}

/** What A owns, created through the same services the app uses. */
let a: { live: string; deleted: string; attention: string; title: string };
let bProject: string;

beforeAll(startTestMongo, 120_000);
afterAll(stopTestMongo);
beforeEach(async () => {
  await clearCollections([...USER_DATA_COLLECTIONS, "config"]);

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
  // A's scheduled Instagram post and queued render: a DELETE cascade (by projectId) would cancel exactly these.
  await testMongo.db.collection("publish_jobs").insertOne(
    { projectId: live._id, userId: A.id, renderId: new ObjectId(), status: "scheduled", active: true, mode: "scheduled", idempotencyKey: "a-post", rev: 0, createdAt: new Date(), updatedAt: new Date() },
    { bypassDocumentValidation: true },
  );
  await testMongo.db.collection("render_jobs").insertOne(
    { renderId: new ObjectId(), projectId: live._id, userId: A.id, status: "queued", priority: 1, attempt: 0, progress: 0, createdAt: new Date(), updatedAt: new Date() },
    { bypassDocumentValidation: true },
  );
  await consumeUsage(A.id, "renders");
  await consumeUsage(A.id, "renders");
  a = { live: live._id.toHexString(), deleted: deleted._id.toHexString(), attention: attention._id.toHexString(), title: live.title };

  const bProfile = await getOrCreateProfile(B.id, B.name);
  bProject = (await createProject(B.id, bProfile, { title: "B's own video" }))._id.toHexString();

  vi.stubEnv("BETTER_AUTH_URL", APP);
  as(B);
});

/** A snapshot of everything A owns, in every user-data collection (DB Design §1), to prove nothing changed. */
async function snapshotA() {
  const snapshot: Record<string, unknown[]> = {};
  for (const name of USER_DATA_COLLECTIONS) {
    const docs = await testMongo.db.collection(name).find({ userId: A.id }).sort({ _id: 1 }).toArray();
    snapshot[name] = docs.map(({ _id, ...rest }) => ({ _id: String(_id), ...rest }));
  }
  return snapshot;
}

it("the snapshot really covers A's queued work (so a wrongful cancel would show)", async () => {
  const snap = await snapshotA();
  expect(snap.publish_jobs).toHaveLength(1);
  expect(snap.render_jobs).toHaveLength(1);
  expect(snap.pipeline_runs).toHaveLength(1);
  expect(Object.keys(snap).sort()).toEqual([...USER_DATA_COLLECTIONS].sort());
});

/** Same status and error as an id that doesn't exist (requestId aside), so nothing leaks about A's ids. */
async function expectLikeUnknown(handler: Handler, method: string, suffix: string, foreignId: string, body?: unknown, headers?: Record<string, string>) {
  const unknown = new ObjectId().toHexString();
  const foreign = await call(handler, method, `/api/v1/projects/${foreignId}${suffix}`, { id: foreignId }, body, headers);
  const missing = await call(handler, method, `/api/v1/projects/${unknown}${suffix}`, { id: unknown }, body, headers);
  expect(foreign.status).toBe(404);
  expect({ status: foreign.status, code: foreign.json?.error?.code, message: foreign.json?.error?.message, details: foreign.json?.error?.details, headers: foreign.headers }).toEqual({
    status: missing.status,
    code: missing.json?.error?.code,
    message: missing.json?.error?.message,
    details: missing.json?.error?.details,
    headers: missing.headers,
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

  it("GET /projects/{id}/idea: 404 like an unknown id; A's idea text never comes back", async () => {
    for (const id of [a.live, a.deleted, a.attention]) await expectLikeUnknown(idea.GET, "GET", "/idea", id);
  });

  it("POST /projects/{id}/idea/suggestions: 404 like an unknown id; no AI call, nothing saved for A, B's limit untouched", async () => {
    const before = await snapshotA();
    for (const id of [a.live, a.deleted, a.attention]) await expectLikeUnknown(suggestions.POST, "POST", "/idea/suggestions", id, { topic: "Steal A's ideas" });
    expect(await snapshotA()).toEqual(before);
    expect(await testMongo.db.collection("usage_counters").countDocuments({ userId: B.id })).toBe(0);
    expect(await testMongo.db.collection("ai_calls").countDocuments()).toBe(0);
  });

  it("POST /projects/{id}/idea/brief: 404 like an unknown id for every source; no AI call, A's brief unchanged, B's limit untouched", async () => {
    // A has a brief, 2 other angles and an idea card, so a wrongful brief or switch would show in the snapshot.
    const aBrief = { title: "A's brief", hook: "h", angle: "a", audience: "students", keyPoints: ["1", "2", "3"], outOfScope: [] };
    await testMongo.db.collection("idea_sessions").updateOne(
      { projectId: new ObjectId(a.live) },
      { $set: { ideaInput: "A's idea", notesText: "A's notes about photosynthesis and how plants make food", brief: aBrief, briefAlternatives: [{ ...aBrief, title: "Alt 1" }, { ...aBrief, title: "Alt 2" }], suggestions: [{ id: "sg_0123456789ab", title: "t", hook: "h", angle: "a", keyPoints: ["1", "2", "3"] }] } },
    );
    const before = await snapshotA();
    for (const body of [{ from: "idea" }, { from: "suggestion", suggestionId: "sg_0123456789ab" }, { from: "alternative", index: 0 }, { from: "notes" }, { from: "settings" }]) {
      for (const id of [a.live, a.deleted, a.attention]) await expectLikeUnknown(brief.POST, "POST", "/idea/brief", id, body);
    }
    expect(await snapshotA()).toEqual(before);
    expect(await testMongo.db.collection("usage_counters").countDocuments({ userId: B.id })).toBe(0);
    expect(await testMongo.db.collection("ai_calls").countDocuments()).toBe(0);
  });

  it("GET / POST /projects/{id}/idea/chat: 404 like an unknown id (even with A's own clientMessageId); no AI call, A's thread and brief unchanged", async () => {
    const aBrief = { title: "A's brief", hook: "h", angle: "a", audience: "students", keyPoints: ["1", "2", "3"], outOfScope: [] };
    await testMongo.db.collection("idea_sessions").updateOne({ projectId: new ObjectId(a.live) }, { $set: { brief: aBrief } });
    const aMessageId = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";
    const now = new Date();
    await testMongo.db.collection("chat_messages").insertOne({ projectId: new ObjectId(a.live), userId: A.id, thread: "idea", role: "user", content: "A's secret request", status: "applied", clientMessageId: aMessageId, createdAt: now, updatedAt: now });
    const before = await snapshotA();
    for (const id of [a.live, a.deleted, a.attention]) {
      await expectLikeUnknown(chat.GET, "GET", "/idea/chat", id);
      await expectLikeUnknown(chat.POST, "POST", "/idea/chat", id, { clientMessageId: aMessageId, content: "A's secret request" });
      await expectLikeUnknown(chat.POST, "POST", "/idea/chat", id, { clientMessageId: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", content: "make it about B" });
    }
    expect(await snapshotA()).toEqual(before);
    expect(await testMongo.db.collection("chat_messages").countDocuments({ userId: B.id })).toBe(0);
    expect(await testMongo.db.collection("usage_counters").countDocuments({ userId: B.id })).toBe(0);
    expect(await testMongo.db.collection("ai_calls").countDocuments()).toBe(0);
  });

  it("PATCH /projects/{id}/idea/brief: 404 like an unknown id, even with A's own briefUpdatedAt; A's brief and title unchanged", async () => {
    const at = new Date(Date.now() - 60_000);
    const aBrief = { title: "A's brief", hook: "hook", angle: "angle", audience: "students", keyPoints: ["one", "two", "three"], outOfScope: [] };
    await testMongo.db.collection("idea_sessions").updateOne({ projectId: new ObjectId(a.live) }, { $set: { brief: aBrief, briefAlternatives: [], briefUpdatedAt: at } });
    const before = await snapshotA();
    for (const id of [a.live, a.deleted, a.attention]) await expectLikeUnknown(brief.PATCH, "PATCH", "/idea/brief", id, { briefUpdatedAt: at.toISOString(), title: "B was here" });
    expect(await snapshotA()).toEqual(before);
  });

  it("storyboard routes (generate, current storyboard, status): 404 like an unknown id; nothing counted, no run, A's storyboard and runs unchanged", async () => {
    // A has a brief, a saved storyboard and a stale-looking active run, so a wrongful start, read or recovery would show.
    const aBrief = { title: "A's brief", hook: "h", angle: "a", audience: "students", keyPoints: ["1", "2", "3"], outOfScope: [] };
    await testMongo.db.collection("idea_sessions").updateOne({ projectId: new ObjectId(a.live) }, { $set: { brief: aBrief } });
    await testMongo.db.collection("projects").updateOne({ _id: new ObjectId(a.live) }, { $set: { currentStoryboardVersion: 1 } });
    await testMongo.db.collection("storyboard_versions").insertOne({
      projectId: new ObjectId(a.live), userId: A.id, version: 1, schemaVersion: 1, data: { title: "A's storyboard", scenes: [] }, source: "generate",
      basedOnVersion: null, changeSummary: "First storyboard", changedSceneIds: [], validationReport: { repairs: [], warnings: [], wordCount: 0, estimatedDurationSec: 0 }, createdAt: new Date(),
    });
    await testMongo.db.collection("pipeline_runs").updateOne({ userId: A.id }, { $set: { updatedAt: new Date(Date.now() - 3600_000) } });
    const before = await snapshotA();
    for (const id of [a.live, a.deleted, a.attention]) {
      await expectLikeUnknown(generate.POST, "POST", "/storyboard/generate", id, {});
      await expectLikeUnknown(generate.POST, "POST", "/storyboard/generate", id, { regenerate: true });
      await expectLikeUnknown(storyboard.GET, "GET", "/storyboard", id);
      await expectLikeUnknown(status.GET, "GET", "/status", id);
      // With A's own version number as If-Match.
      await expectLikeUnknown(social.PATCH, "PATCH", "/storyboard/social", id, { coverText: "B was here" }, { "if-match": '"1"' });
      await expectLikeUnknown(rewrite.POST, "POST", "/storyboard/social/rewrite", id, {});
      await expectLikeUnknown(versions.GET, "GET", "/storyboard/versions", id);
    }
    // The version routes take a second path param: same check, by hand.
    for (const id of [a.live, a.deleted, a.attention]) {
      for (const [handler, method, suffix, body] of [
        [oneVersion.GET, "GET", "/storyboard/versions/1", undefined],
        [restoreVersion.POST, "POST", "/storyboard/versions/1/restore", {}],
      ] as const) {
        const unknown = new ObjectId().toHexString();
        const foreign = await call(handler as Handler, method, `/api/v1/projects/${id}${suffix}`, { id, version: "1" }, body, { "if-match": '"1"' });
        const missing = await call(handler as Handler, method, `/api/v1/projects/${unknown}${suffix}`, { id: unknown, version: "1" }, body, { "if-match": '"1"' });
        expect(foreign.status).toBe(404);
        expect({ code: foreign.json?.error?.code, message: foreign.json?.error?.message, headers: foreign.headers }).toEqual({ code: missing.json?.error?.code, message: missing.json?.error?.message, headers: missing.headers });
      }
    }
    expect(await snapshotA()).toEqual(before);
    expect(await testMongo.db.collection("usage_counters").countDocuments({ userId: B.id })).toBe(0);
    expect(await testMongo.db.collection("pipeline_runs").countDocuments({ userId: B.id })).toBe(0);
    expect(await testMongo.db.collection("ai_calls").countDocuments()).toBe(0);
  });

  it("PUT /projects/{id}/idea: 404, with or without If-Match; A's idea and project are unchanged", async () => {
    const before = await snapshotA();
    for (const id of [a.live, a.deleted]) await expectLikeUnknown(idea.PUT, "PUT", "/idea", id, { mode: "idea", ideaInput: "B was here" });
    for (const headers of [{ "if-match": '"0"' }, { "if-match": "*" }]) {
      const res = await call(idea.PUT, "PUT", `/api/v1/projects/${a.live}/idea`, { id: a.live }, { mode: "notes", notesText: "B was here" }, headers);
      expect(res.status).toBe(404);
    }
    expect((await call(idea.PUT, "PUT", `/api/v1/projects/${a.live}/idea`, { id: a.live }, { mode: "idea", userId: B.id })).status).toBe(400);
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
  ["GET /projects/{id}/idea", idea.GET, "GET", "/api/v1/projects/x/idea", { id: "x" }],
  ["PUT /projects/{id}/idea", idea.PUT, "PUT", "/api/v1/projects/x/idea", { id: "x" }],
  ["POST /projects/{id}/idea/suggestions", suggestions.POST, "POST", "/api/v1/projects/x/idea/suggestions", { id: "x" }],
  ["POST /projects/{id}/idea/brief", brief.POST, "POST", "/api/v1/projects/x/idea/brief", { id: "x" }],
  ["PATCH /projects/{id}/idea/brief", brief.PATCH, "PATCH", "/api/v1/projects/x/idea/brief", { id: "x" }],
  ["GET /projects/{id}/idea/chat", chat.GET, "GET", "/api/v1/projects/x/idea/chat", { id: "x" }],
  ["POST /projects/{id}/idea/chat", chat.POST, "POST", "/api/v1/projects/x/idea/chat", { id: "x" }],
  ["POST /projects/{id}/storyboard/generate", generate.POST, "POST", "/api/v1/projects/x/storyboard/generate", { id: "x" }],
  ["GET /projects/{id}/storyboard", storyboard.GET, "GET", "/api/v1/projects/x/storyboard", { id: "x" }],
  ["GET /projects/{id}/status", status.GET, "GET", "/api/v1/projects/x/status", { id: "x" }],
  ["PATCH /projects/{id}/storyboard/social", social.PATCH, "PATCH", "/api/v1/projects/x/storyboard/social", { id: "x" }],
  ["POST /projects/{id}/storyboard/social/rewrite", rewrite.POST, "POST", "/api/v1/projects/x/storyboard/social/rewrite", { id: "x" }],
  ["GET /projects/{id}/storyboard/versions", versions.GET, "GET", "/api/v1/projects/x/storyboard/versions", { id: "x" }],
  ["GET /projects/{id}/storyboard/versions/{version}", oneVersion.GET, "GET", "/api/v1/projects/x/storyboard/versions/1", { id: "x", version: "1" }],
  ["POST /projects/{id}/storyboard/versions/{version}/restore", restoreVersion.POST, "POST", "/api/v1/projects/x/storyboard/versions/1/restore", { id: "x", version: "1" }],
];

describe("every route needs a session, and a verified email", () => {
  it.each(HANDLERS)("%s: 401 signed out", async (_, handler, method, url, params) => {
    as(null);
    expect((await call(handler, method, url, params, method === "GET" ? undefined : { title: "x" })).status).toBe(401);
  });

  it.each(HANDLERS)("%s: an unverified email is no longer refused (no 403; no email verification since 2026-10-20)", async (_, handler, method, url, params) => {
    as({ ...B, emailVerified: false });
    const { status, json } = await call(handler, method, url, params, method === "GET" ? undefined : { title: "x" });
    expect(status).not.toBe(401);
    expect(json?.error?.code).not.toBe("EMAIL_NOT_VERIFIED");
  });

  it("unknown /api/v1 paths are 404 for everyone", async () => {
    expect((await call(catchAll.GET as Handler, "GET", "/api/v1/users", { path: "users" })).status).toBe(404);
  });
});

/** Every route module, by its path under app/api/v1 (the walk below checks this list is complete). */
const MODULES: Record<string, Record<string, unknown>> = {
  "/[...path]": catchAll,
  "/me": me,
  "/me/profile": profile,
  "/me/usage": usage,
  "/projects": projects,
  "/projects/[id]": one,
  "/projects/[id]/duplicate": duplicate,
  "/projects/[id]/idea": idea,
  "/projects/[id]/idea/suggestions": suggestions,
  "/projects/[id]/idea/brief": brief,
  "/projects/[id]/idea/chat": chat,
  "/projects/[id]/restore": restore,
  "/projects/[id]/status": status,
  "/projects/[id]/storyboard": storyboard,
  "/projects/[id]/storyboard/generate": generate,
  "/projects/[id]/storyboard/social": social,
  "/projects/[id]/storyboard/social/rewrite": rewrite,
  "/projects/[id]/storyboard/versions": versions,
  "/projects/[id]/storyboard/versions/[version]": oneVersion,
  "/projects/[id]/storyboard/versions/[version]/restore": restoreVersion,
};
const METHODS = ["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"];

describe("coverage", () => {
  it("every exported method of every route is either a 405 or has a cross-user case above", async () => {
    const covered = new Set(HANDLERS.map(([label]) => label.replace("{id}", "[id]").replace("{version}", "[version]")));
    for (const [route, mod] of Object.entries(MODULES)) {
      if (route === "/[...path]") continue; // the 404 catch-all, checked separately
      for (const method of METHODS.filter((m) => typeof mod[m] === "function")) {
        const label = `${method} ${route}`;
        if (covered.has(label)) continue;
        const url = `/api/v1${route.replace("[id]", "x").replace("[version]", "1")}`;
        const params = route.includes("[id]") ? { id: "x", ...(route.includes("[version]") ? { version: "1" } : {}) } : undefined;
        const { status } = await call(mod[method] as Handler, method, url, params, method === "GET" || method === "HEAD" ? undefined : {});
        expect(status, `${label} is a real handler with no cross-user case: add one to HANDLERS and the tests above`).toBe(405);
      }
    }
  });

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
    expect(found.sort()).toEqual(Object.keys(MODULES).sort());
    const routesWithCases = new Set(["/[...path]", ...HANDLERS.map(([label]) => label.split(" ")[1].replace("{id}", "[id]").replace("{version}", "[version]"))]);
    expect([...routesWithCases].sort()).toEqual(Object.keys(MODULES).sort());
  });
});
