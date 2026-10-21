import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/mongo", async () => (await import("../../../test/mongo")).mongoModule);
const sessionUser = vi.hoisted(() => vi.fn());
vi.mock("../api/session", () => ({ sessionUser }));
const send = vi.hoisted(() => vi.fn());
vi.mock("../jobs/inngest", () => ({ inngest: { send, createFunction: (config: unknown, fn: unknown) => ({ config, fn }) } }));

import * as generate from "@/app/api/v1/projects/[id]/storyboard/generate/route";
import * as social from "@/app/api/v1/projects/[id]/storyboard/social/route";
import * as list from "@/app/api/v1/projects/[id]/storyboard/versions/route";
import * as one from "@/app/api/v1/projects/[id]/storyboard/versions/[version]/route";
import * as restore from "@/app/api/v1/projects/[id]/storyboard/versions/[version]/restore/route";
import { clearCollections, startTestMongo, stopTestMongo, testMongo } from "../../../test/mongo";
import { runStoryboardJob } from "../jobs/storyboard";
import { getOrCreateProfile } from "./profiles";
import { createProject, duplicateProject } from "./projects";
import { KEEP_VERSIONS } from "./storyboards";
import { resetLimitsCache } from "./usage";

/** F3.5: version history and restore (a pointer move), against a throwaway MongoDB with the mock AI; no real AI. */

const APP = "http://localhost:3000";
const ME = { id: new ObjectId().toHexString(), name: "Me", email: "me@example.com", emailVerified: true, image: null, createdAt: new Date() };
const BRIEF = { title: "Why the sky is blue", hook: "Why blue?", angle: "Light", audience: "students", keyPoints: ["Sunlight", "Scattering", "Sunsets"], outOfScope: [] };

let projectId: string;
const oid = () => new ObjectId(projectId);
const project = () => testMongo.db.collection("projects").findOne({ _id: oid() });
const versionsOf = () => testMongo.db.collection("storyboard_versions").find({ projectId: oid() }).sort({ version: 1 }).toArray();

function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${APP}/api/v1/projects/${projectId}${path}`, {
    method,
    headers: { origin: APP, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const out = async (res: Response) => ({ status: res.status, json: await res.json().catch(() => null) });
const getList = async () => out(await list.GET(req("GET", "/storyboard/versions"), { params: Promise.resolve({ id: projectId }) }));
const getOne = async (v: string) => out(await one.GET(req("GET", `/storyboard/versions/${v}`), { params: Promise.resolve({ id: projectId, version: v }) }));
const doRestore = async (v: string, ifMatch: string | null) =>
  out(await restore.POST(req("POST", `/storyboard/versions/${v}/restore`, {}, ifMatch === null ? {} : { "if-match": ifMatch }), { params: Promise.resolve({ id: projectId, version: v }) }));
const editCaption = async (coverText: string, ifMatch: string) =>
  out(await social.PATCH(req("PATCH", "/storyboard/social", { coverText }, { "if-match": ifMatch }), { params: Promise.resolve({ id: projectId }) }));
async function regenerate(body: unknown = { regenerate: true }) {
  const res = await generate.POST(req("POST", "/storyboard/generate", body), { params: Promise.resolve({ id: projectId }) });
  await runStoryboardJob((await res.json()).run.id);
}

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
  await regenerate({}); // v1 Generated
  await editCaption("Second cover", '"1"'); // v2 Edited the cover text
  await regenerate(); // v3 Regenerated
});

describe("GET …/storyboard/versions", () => {
  it("newest first, with what made each one, its language / length / scenes, and which is current", async () => {
    const res = await getList();
    expect(res.status).toBe(200);
    expect(res.json.current).toBe(3);
    expect(res.json.nextCursor).toBeNull();
    expect(res.json.items.map((v: { version: number; source: string; changeSummary: string; isCurrent: boolean }) => [v.version, v.source, v.changeSummary, v.isCurrent])).toEqual([
      [3, "generate", "Regenerated from the brief", true],
      [2, "manual_edit", "Edited the cover text", false],
      [1, "generate", "First storyboard", false],
    ]);
    expect(res.json.items[0]).toMatchObject({ language: "en", targetDurationSec: 60, sceneCount: 8 });
    expect(res.json.items[0].storyboard).toBeUndefined();
  });

  it("GET one version: the whole storyboard, marked not current; 404 for unknown / malformed", async () => {
    const res = await getOne("2");
    expect(res.json).toMatchObject({ version: 2, isCurrent: false, storyboard: { social: { coverText: "Second cover" } } });
    expect((await getOne("9")).status).toBe(404);
    expect((await getOne("x")).status).toBe(404);
    expect((await getOne("0")).status).toBe(404);
  });
});

describe("POST …/versions/{v}/restore (a pointer move)", () => {
  it("moves the current version back; nothing is copied; newer versions stay and can be restored forward", async () => {
    const res = await doRestore("1", '"3"');
    expect(res.status).toBe(200);
    expect(res.json.version).toMatchObject({ version: 1, isCurrent: true });
    expect(res.json.project.currentStoryboardVersion).toBe(1);
    expect(await versionsOf()).toHaveLength(3);
    expect((await getList()).json.items.map((v: { isCurrent: boolean }) => v.isCurrent)).toEqual([false, false, true]);
    const forward = await doRestore("3", '"1"');
    expect(forward.json.project.currentStoryboardVersion).toBe(3);
  });

  it("the next caption edit on a restored version is highest + 1, based on the restored one; so is a regenerate", async () => {
    await doRestore("1", '"3"');
    const edit = await editCaption("From v1", '"1"');
    expect(edit.status).toBe(201);
    expect(edit.json.version).toMatchObject({ version: 4, basedOnVersion: 1, changeSummary: "Edited the cover text" });
    const [v1, , , v4] = await versionsOf();
    expect(v4.data.scenes).toEqual(v1.data.scenes); // built on the restored storyboard, not on v3
    await doRestore("2", '"4"');
    await regenerate();
    const p = await project();
    expect(p).toMatchObject({ currentStoryboardVersion: 5, status: "storyboard_ready" });
    expect((await versionsOf()).at(-1)).toMatchObject({ version: 5, basedOnVersion: 2 });
  });

  it("the video's language and length follow the restored version", async () => {
    await testMongo.db.collection("storyboard_versions").updateOne({ projectId: oid(), version: 1 }, { $set: { "data.language": "hi", "data.targetDurationSec": 90 } });
    const res = await doRestore("1", '"3"');
    expect(res.json.project).toMatchObject({ language: "hi", lengthPreset: 90 });
    const back = await doRestore("3", '"1"');
    expect(back.json.project).toMatchObject({ language: "en", lengthPreset: 60 });
  });

  it("If-Match: required (400), stale (412 with the current number); the current one (409); while generating (409); unknown (404); not counted", async () => {
    expect((await doRestore("1", null)).status).toBe(400);
    const stale = await doRestore("1", '"2"');
    expect(stale.status).toBe(412);
    expect(stale.json.error.details[0].current).toBe(3);
    expect((await doRestore("3", '"3"')).json.error).toMatchObject({ code: "INVALID_STATE", message: "That's already the current version." });
    expect((await doRestore("9", '"3"')).status).toBe(404);
    await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { status: "storyboard_generating" } });
    expect((await doRestore("1", '"3"')).status).toBe(409);
    expect((await project())!.currentStoryboardVersion).toBe(3);
    const usage = await testMongo.db.collection("usage_counters").findOne({ userId: ME.id });
    expect(usage?.revisions ?? 0).toBe(0);
  });

  it("a caption save on the old pointer after another tab restored gets 412", async () => {
    await doRestore("1", '"3"');
    expect((await editCaption("Late", '"3"')).status).toBe(412);
  });

  it("pruning keeps the newest 30 and the current one: a restored old version survives until something newer becomes current", async () => {
    const base = (await versionsOf())[0];
    await testMongo.db.collection("storyboard_versions").insertMany(
      Array.from({ length: KEEP_VERSIONS }, (_, i) => ({ ...base, _id: new ObjectId(), version: i + 4, source: "manual_edit", changeSummary: `v${i + 4}` })),
    );
    await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { currentStoryboardVersion: KEEP_VERSIONS + 3 } });
    // Restore the oldest (outside the newest 30): it's still there, and a restore prunes nothing.
    expect((await doRestore("1", `"${KEEP_VERSIONS + 3}"`)).status).toBe(200);
    expect(await versionsOf()).toHaveLength(KEEP_VERSIONS + 3);
    // A caption edit on it makes v34 current; the newest 30 stay (v5–v34); v1, now not current, goes.
    const edit = await editCaption("On v1", '"1"');
    expect(edit.json.version).toMatchObject({ version: KEEP_VERSIONS + 4, basedOnVersion: 1 });
    const left = (await versionsOf()).map((v) => v.version);
    expect(left).toHaveLength(KEEP_VERSIONS);
    expect(left[0]).toBe(5);
    expect(left.at(-1)).toBe(KEEP_VERSIONS + 4);
  });

  it("duplicating a video copies its current version, even when it's an older one", async () => {
    await doRestore("2", '"3"');
    const copy = await duplicateProject(ME.id, projectId);
    const copied = await testMongo.db.collection("storyboard_versions").findOne({ projectId: copy!._id });
    expect(copied!.data.social.coverText).toBe("Second cover");
  });
});
