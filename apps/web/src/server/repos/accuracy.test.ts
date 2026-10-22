import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/mongo", async () => (await import("../../../test/mongo")).mongoModule);
const sessionUser = vi.hoisted(() => vi.fn());
vi.mock("../api/session", () => ({ sessionUser }));
const send = vi.hoisted(() => vi.fn());
vi.mock("../jobs/inngest", () => ({ inngest: { send, createFunction: (config: unknown, fn: unknown) => ({ config, fn }) } }));

import * as checkRoute from "@/app/api/v1/projects/[id]/storyboard/accuracy-check/route";
import * as dismissRoute from "@/app/api/v1/projects/[id]/storyboard/accuracy-flags/[flagId]/dismiss/route";
import * as restoreRoute from "@/app/api/v1/projects/[id]/storyboard/accuracy-flags/[flagId]/restore/route";
import * as generate from "@/app/api/v1/projects/[id]/storyboard/generate/route";
import * as storyboardRoute from "@/app/api/v1/projects/[id]/storyboard/route";
import * as sceneRoute from "@/app/api/v1/projects/[id]/storyboard/scenes/[sceneId]/route";
import * as socialRoute from "@/app/api/v1/projects/[id]/storyboard/social/route";
import { clearCollections, startTestMongo, stopTestMongo, testMongo } from "../../../test/mongo";
import { runStoryboardJob } from "../jobs/storyboard";
import { runAccuracyCheck } from "./accuracy";
import { getOrCreateProfile } from "./profiles";
import { createProject } from "./projects";
import { resetLimitsCache } from "./usage";

/** F3.7: the accuracy check (after generate and on Check now), dismissing, carrying over; mock AI only, no real AI. */

const APP = "http://localhost:3000";
const ME = { id: new ObjectId().toHexString(), name: "Me", email: "me@example.com", emailVerified: true, image: null, createdAt: new Date() };
const BRIEF = { title: "Why the sky is blue", hook: "Why blue?", angle: "Light", audience: "students", keyPoints: ["Sunlight", "Scattering", "Sunsets"], outOfScope: [] };

let projectId: string;
const oid = () => new ObjectId(projectId);
const versionsOf = () => testMongo.db.collection("storyboard_versions").find({ projectId: oid() }).sort({ version: 1 }).toArray();
const revisions = async () => (await testMongo.db.collection("usage_counters").findOne({ userId: ME.id }))?.revisions ?? 0;

function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${APP}/api/v1/projects/${projectId}${path}`, {
    method,
    headers: { origin: APP, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const out = async (res: Response) => ({ status: res.status, json: await res.json().catch(() => null) });
const p = () => ({ params: Promise.resolve({ id: projectId }) });
const fp = (flagId: string) => ({ params: Promise.resolve({ id: projectId, flagId }) });
const current = async () => out(await storyboardRoute.GET(req("GET", "/storyboard"), p()));
const checkNow = async (ifMatch: string | null = '"1"') => out(await checkRoute.POST(req("POST", "/storyboard/accuracy-check", undefined, ifMatch === null ? {} : { "if-match": ifMatch }), p()));
const dismiss = async (flagId: string, ifMatch = '"1"') => out(await dismissRoute.POST(req("POST", `/storyboard/accuracy-flags/${flagId}/dismiss`, undefined, { "if-match": ifMatch }), fp(flagId)));
const bringBack = async (flagId: string, ifMatch = '"1"') => out(await restoreRoute.POST(req("POST", `/storyboard/accuracy-flags/${flagId}/restore`, undefined, { "if-match": ifMatch }), fp(flagId)));
const patchScene = async (sceneId: string, body: unknown, ifMatch: string) =>
  out(await sceneRoute.PATCH(req("PATCH", `/storyboard/scenes/${sceneId}`, body, { "if-match": ifMatch }), { params: Promise.resolve({ id: projectId, sceneId }) }));
const setTitle = (title: string, version = 1) => testMongo.db.collection("storyboard_versions").updateOne({ projectId: oid(), version }, { $set: { "data.title": title } });

async function generateWith(title = BRIEF.title) {
  await testMongo.db.collection("idea_sessions").updateOne({ projectId: oid() }, { $set: { brief: { ...BRIEF, title } } });
  const res = await generate.POST(req("POST", "/storyboard/generate", {}), p());
  await runStoryboardJob((await res.json()).run.id);
}

beforeAll(startTestMongo, 120_000);
afterAll(stopTestMongo);
beforeEach(async () => {
  await clearCollections(["projects", "idea_sessions", "profiles", "usage_counters", "ai_calls", "config", "pipeline_runs", "storyboard_versions"]);
  resetLimitsCache();
  const profile = await getOrCreateProfile(ME.id, ME.name);
  projectId = (await createProject(ME.id, profile, { title: "Sky" }))._id.toHexString();
  vi.stubEnv("BETTER_AUTH_URL", APP);
  vi.stubEnv("AI_PROVIDER", "mock");
  sessionUser.mockResolvedValue(ME);
  send.mockResolvedValue({ ids: ["evt"] });
});

describe("after generate (automatic, free)", () => {
  it("checks the new version: flags quoting the scene, English notes; not counted; logged as accuracy", async () => {
    await generateWith();
    const { status, json } = await current();
    expect(status).toBe(200);
    expect(json.accuracy).toMatchObject({ status: "done", openCount: 1, dismissedCount: 0, uncheckedSceneIds: [] });
    const [flag] = json.accuracyFlags;
    expect(flag).toMatchObject({ id: "f1", dismissed: false });
    const scene = json.storyboard.scenes.find((s: { id: string }) => s.id === flag.sceneId);
    expect(scene.narration).toContain(flag.claim);
    expect(flag.note).toMatch(/^\[Mock\] [A-Za-z]/);
    expect(await revisions()).toBe(0);
    expect(await testMongo.db.collection("ai_calls").countDocuments({ userId: ME.id, task: "accuracy" })).toBe(1);
    expect((await testMongo.db.collection("pipeline_runs").findOne({}))!.status).toBe("succeeded");
  });

  it("a failed check never fails the run: the storyboard is saved, the report says failed", async () => {
    await generateWith("Sky [mock:facts-busy]");
    const { json } = await current();
    expect(json.version).toBe(1);
    expect(json.accuracy.status).toBe("failed");
    expect(json.accuracyFlags).toEqual([]);
    expect((await testMongo.db.collection("pipeline_runs").findOne({}))!.status).toBe("succeeded");
  });

  it("a Hindi video: the claim stays in Devanagari, the note in English", async () => {
    await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { language: "hi" } });
    await generateWith();
    const { json } = await current();
    const [flag] = json.accuracyFlags;
    expect(flag.claim).toMatch(/[ऀ-ॿ]/);
    expect(flag.note).not.toMatch(/[ऀ-ॿ]/);
  });
});

describe("POST …/storyboard/accuracy-check (Check now)", () => {
  beforeEach(() => generateWith());

  it("200: checks again; 1 revision; a dismissed claim stays dismissed", async () => {
    expect((await dismiss("f1")).json.version.accuracy).toMatchObject({ openCount: 0, dismissedCount: 1 });
    const res = await checkNow();
    expect(res.status).toBe(200);
    expect(res.json.version.accuracy).toMatchObject({ status: "done", openCount: 0, dismissedCount: 1 });
    expect(res.json.version.version).toBe(1);
    expect(await revisions()).toBe(1);
  });

  it("503 when the check fails: the unit is given back and the earlier flags stay", async () => {
    await setTitle("Sky [mock:facts-busy]");
    const res = await checkNow();
    expect(res.status).toBe(503);
    expect(res.json.error.code).toBe("AI_BUSY");
    expect(await revisions()).toBe(0);
    const { json } = await current();
    expect(json.accuracy).toMatchObject({ status: "done", openCount: 1 });
  });

  it("400 without If-Match, 412 on an older version, 409 while generating, 429 at the revisions limit", async () => {
    expect((await checkNow(null)).status).toBe(400);
    expect((await checkNow('"7"')).status).toBe(412);
    await testMongo.db.collection("usage_counters").updateMany({ userId: ME.id }, { $set: { revisions: 100 } });
    expect((await checkNow()).status).toBe(429);
    await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { status: "storyboard_generating" } });
    expect((await checkNow()).status).toBe(409);
  });

  it("a check that finds nothing: done with no flags", async () => {
    await setTitle("Sky [mock:facts-none]");
    const res = await checkNow();
    expect(res.json.version.accuracy).toMatchObject({ status: "done", openCount: 0, dismissedCount: 0 });
  });
});

describe("dismiss and bring back", () => {
  beforeEach(() => generateWith());

  it("hides a flag and brings it back, without a new version or a count; 404 / 412", async () => {
    const d = await dismiss("f1");
    expect(d.status).toBe(200);
    expect(d.json.version.accuracyFlags[0].dismissed).toBe(true);
    expect((await bringBack("f1")).json.version.accuracyFlags[0].dismissed).toBe(false);
    expect((await versionsOf()).length).toBe(1);
    expect(await revisions()).toBe(0);
    expect((await dismiss("f9")).status).toBe(404);
    expect((await dismiss("f1", '"4"')).status).toBe(412);
  });
});

describe("new versions carry the flags of unchanged scenes", () => {
  beforeEach(() => generateWith());

  it("a manual edit keeps flags (dismissed too) on unchanged scenes; the edited scene waits for Check now", async () => {
    const flagged = (await current()).json.accuracyFlags[0].sceneId as string;
    await dismiss("f1");
    const other = flagged === "s3" ? "s4" : "s3";
    const v2 = await patchScene(other, { narration: "A new narration for this scene, written by hand." }, '"1"');
    expect(v2.json.version.accuracy).toMatchObject({ status: "done", openCount: 0, dismissedCount: 1, uncheckedSceneIds: [other] });
    // Editing the flagged scene drops its flag.
    const v3 = await patchScene(flagged, { narration: "Rewritten by hand, with nothing left to check here." }, '"2"');
    expect(v3.json.version.accuracyFlags).toEqual([]);
    expect(v3.json.version.accuracy.uncheckedSceneIds.sort()).toEqual([other, flagged].sort());
    // Check now checks every scene again.
    const checked = await checkNow('"3"');
    expect(checked.json.version.accuracy.uncheckedSceneIds).toEqual([]);
  });

  it("a caption edit keeps every flag", async () => {
    const res = await out(await socialRoute.PATCH(req("PATCH", "/storyboard/social", { caption: "A new caption by hand." }, { "if-match": '"1"' }), p()));
    expect(res.status).toBe(201);
    expect(res.json.version.accuracy).toMatchObject({ status: "done", openCount: 1, uncheckedSceneIds: [] });
  });

  it("an edit saved while the check ran gets the result for its unchanged scenes", async () => {
    await testMongo.db.collection("storyboard_versions").updateOne({ projectId: oid(), version: 1 }, { $set: { accuracyReport: { status: "pending", flags: [], uncheckedSceneIds: [], startedAt: new Date(), checkedAt: null } } });
    const flagged = (await versionsOf())[0].data.scenes[1].id as string; // the mock flags scene 2 (no numbers in the mock script)
    const v2 = await patchScene("s5", { narration: "A new narration for this scene, written by hand." }, '"1"');
    expect(v2.json.version.accuracy.status).toBe("none");
    const done = await runAccuracyCheck(ME.id, oid(), 1);
    expect(done.ok).toBe(true);
    const { json } = await current();
    expect(json.version).toBe(2);
    expect(json.accuracy).toMatchObject({ status: "done", uncheckedSceneIds: ["s5"] });
    expect(json.accuracyFlags.map((f: { sceneId: string }) => f.sceneId)).toEqual([flagged]);
  });
});
