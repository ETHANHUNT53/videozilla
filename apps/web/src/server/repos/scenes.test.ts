import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/mongo", async () => (await import("../../../test/mongo")).mongoModule);
const sessionUser = vi.hoisted(() => vi.fn());
vi.mock("../api/session", () => ({ sessionUser }));
const send = vi.hoisted(() => vi.fn());
vi.mock("../jobs/inngest", () => ({ inngest: { send, createFunction: (config: unknown, fn: unknown) => ({ config, fn }) } }));

import * as generate from "@/app/api/v1/projects/[id]/storyboard/generate/route";
import * as sceneRoute from "@/app/api/v1/projects/[id]/storyboard/scenes/[sceneId]/route";
import * as moveRoute from "@/app/api/v1/projects/[id]/storyboard/scenes/[sceneId]/move/route";
import { clearCollections, startTestMongo, stopTestMongo, testMongo } from "../../../test/mongo";
import { runStoryboardJob } from "../jobs/storyboard";
import { getOrCreateProfile } from "./profiles";
import { createProject } from "./projects";
import { resetLimitsCache } from "./usage";

/** F3.6: manual scene edits through the API, against a throwaway MongoDB with the mock AI; no real AI. */

const APP = "http://localhost:3000";
const ME = { id: new ObjectId().toHexString(), name: "Me", email: "me@example.com", emailVerified: true, image: null, createdAt: new Date() };
const BRIEF = { title: "Why the sky is blue", hook: "Why blue?", angle: "Light", audience: "students", keyPoints: ["Sunlight", "Scattering", "Sunsets"], outOfScope: [] };

let projectId: string;
const oid = () => new ObjectId(projectId);
const versionsOf = () => testMongo.db.collection("storyboard_versions").find({ projectId: oid() }).sort({ version: 1 }).toArray();
const project = () => testMongo.db.collection("projects").findOne({ _id: oid() });

function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${APP}/api/v1/projects/${projectId}${path}`, {
    method,
    headers: { origin: APP, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const out = async (res: Response) => ({ status: res.status, json: await res.json().catch(() => null) });
const ctx = (sceneId: string) => ({ params: Promise.resolve({ id: projectId, sceneId }) });
const patchScene = async (sceneId: string, body: unknown, ifMatch: string | null = '"1"') =>
  out(await sceneRoute.PATCH(req("PATCH", `/storyboard/scenes/${sceneId}`, body, ifMatch === null ? {} : { "if-match": ifMatch }), ctx(sceneId)));
const deleteScene = async (sceneId: string, ifMatch = '"1"') => out(await sceneRoute.DELETE(req("DELETE", `/storyboard/scenes/${sceneId}`, undefined, { "if-match": ifMatch }), ctx(sceneId)));
const moveScene = async (sceneId: string, afterSceneId: string | null, ifMatch = '"1"') =>
  out(await moveRoute.POST(req("POST", `/storyboard/scenes/${sceneId}/move`, { afterSceneId }, { "if-match": ifMatch }), ctx(sceneId)));

beforeAll(startTestMongo, 120_000);
afterAll(stopTestMongo);
beforeEach(async () => {
  await clearCollections(["projects", "idea_sessions", "profiles", "usage_counters", "ai_calls", "config", "pipeline_runs", "storyboard_versions"]);
  resetLimitsCache();
  const profile = await getOrCreateProfile(ME.id, ME.name);
  projectId = (await createProject(ME.id, profile, { title: "Sky" }))._id.toHexString();
  await testMongo.db.collection("idea_sessions").updateOne({ projectId: oid() }, { $set: { brief: BRIEF } });
  vi.stubEnv("BETTER_AUTH_URL", APP);
  vi.stubEnv("AI_PROVIDER", "mock");
  sessionUser.mockResolvedValue(ME);
  send.mockResolvedValue({ ids: ["evt"] });
  const res = await generate.POST(req("POST", "/storyboard/generate", {}), { params: Promise.resolve({ id: projectId }) });
  await runStoryboardJob((await res.json()).run.id); // v1: 8 scenes s1–s8
});

describe("PATCH …/storyboard/scenes/{sceneId}", () => {
  it("201: a new manual_edit version with only that scene changed; length measured again; not counted", async () => {
    const res = await patchScene("s3", { narration: "A much shorter narration for this scene now." });
    expect(res.status).toBe(201);
    expect(res.json.version).toMatchObject({ version: 2, source: "manual_edit", basedOnVersion: 1, changeSummary: "Edited scene 3", changedSceneIds: ["s3"] });
    const [v1, v2] = await versionsOf();
    expect(v2.data.scenes.filter((s: { id: string }) => s.id !== "s3")).toEqual(v1.data.scenes.filter((s: { id: string }) => s.id !== "s3"));
    expect(v2.validationReport.wordCount).toBeLessThan(v1.validationReport.wordCount);
    expect((await project())!.currentStoryboardVersion).toBe(2);
    expect(await testMongo.db.collection("usage_counters").findOne({ userId: ME.id, revisions: { $gt: 0 } })).toBeNull();
  });

  it("changes the type by hand with the new type's props; refuses props that break the new type (400 with the field)", async () => {
    const bad = await patchScene("s2", { type: "RecapOutro" });
    expect(bad.status).toBe(400);
    expect(bad.json.error.details.map((d: { field: string }) => d.field)).toContain("props.cta");
    const ok = await patchScene("s2", { type: "StatCounter", props: { value: 70, suffix: "%", label: "of Earth is water" } });
    expect(ok.status).toBe(201);
    expect(ok.json.version.storyboard.scenes[1]).toMatchObject({ type: "StatCounter", props: { value: 70, suffix: "%", label: "of Earth is water" } });
    expect(ok.json.version.changeSummary).toBe("Changed scene 2 to StatCounter");
  });

  it("a no-op is 200; If-Match missing 400 / stale 412; 404 unknown scene; 409 while generating; body checks", async () => {
    const v1 = (await versionsOf())[0];
    expect((await patchScene("s3", { narration: v1.data.scenes[2].narration })).status).toBe(200);
    expect((await patchScene("s3", { narration: "x" }, null)).status).toBe(400);
    expect((await patchScene("s3", { narration: "x y z" }, '"5"')).status).toBe(412);
    expect((await patchScene("s99", { narration: "x y z" })).status).toBe(404);
    expect((await patchScene("s3", {})).status).toBe(400);
    expect((await patchScene("s3", { type: "Hologram" })).status).toBe(400);
    await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { status: "storyboard_generating" } });
    expect((await patchScene("s3", { narration: "x y z" })).status).toBe(409);
  });
});

describe("DELETE and move", () => {
  it("deletes any scene (the hook too) down to 1; the last one is 409", async () => {
    const res = await deleteScene("s1");
    expect(res.status).toBe(201);
    expect(res.json.version).toMatchObject({ changeSummary: "Deleted scene 1", changedSceneIds: [] });
    expect(res.json.version.storyboard.scenes.map((s: { id: string }) => s.id)).toEqual(["s2", "s3", "s4", "s5", "s6", "s7", "s8"]);
    let v = 2;
    for (const id of ["s2", "s3", "s4", "s5", "s6", "s7"]) expect((await deleteScene(id, `"${v++}"`)).status).toBe(201);
    const last = await deleteScene("s8", `"${v}"`);
    expect(last.status).toBe(409);
    expect(last.json.error.message).toBe("The last scene can't be deleted.");
  });

  it("moves a scene (ids stay; it joins the chapter above; chapters renumbered) as one version", async () => {
    const [v1] = await versionsOf();
    const lastBody = v1.data.scenes[6];
    const res = await moveScene("s7", "s2");
    expect(res.status).toBe(201);
    const ids = res.json.version.storyboard.scenes.map((s: { id: string }) => s.id);
    expect(ids).toEqual(["s1", "s2", "s7", "s3", "s4", "s5", "s6", "s8"]);
    const moved = res.json.version.storyboard.scenes[2];
    expect(moved.beat.chapter.index).toBe(1);
    expect(moved.narration).toBe(lastBody.narration);
    expect(res.json.version.changeSummary).toBe("Moved scene 7 to position 3");
    expect((await moveScene("s7", "s2", '"2"')).status).toBe(200); // already there
    expect((await moveScene("s3", "nope", '"2"')).status).toBe(400);
  });
});
