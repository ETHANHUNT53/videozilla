import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/mongo", async () => (await import("../../../test/mongo")).mongoModule);
const sessionUser = vi.hoisted(() => vi.fn());
vi.mock("../api/session", () => ({ sessionUser }));
const send = vi.hoisted(() => vi.fn());
vi.mock("../jobs/inngest", () => ({ inngest: { send, createFunction: (config: unknown, fn: unknown) => ({ config, fn }) } }));

import * as generate from "@/app/api/v1/projects/[id]/storyboard/generate/route";
import * as social from "@/app/api/v1/projects/[id]/storyboard/social/route";
import * as rewrite from "@/app/api/v1/projects/[id]/storyboard/social/rewrite/route";
import { resetModelCooldowns } from "@videozilla/ai";
import { clearCollections, startTestMongo, stopTestMongo, testMongo } from "../../../test/mongo";
import { runStoryboardJob } from "../jobs/storyboard";
import { getOrCreateProfile } from "./profiles";
import { createProject } from "./projects";
import { resetLimitsCache } from "./usage";

/** F3.4: the caption panel's API against a throwaway MongoDB, with the mock AI (AI_PROVIDER=mock); no real AI. */

const APP = "http://localhost:3000";
const ME = { id: new ObjectId().toHexString(), name: "Me", email: "me@example.com", emailVerified: true, image: null, createdAt: new Date() };
const BRIEF = { title: "Why the sky is blue", hook: "Why blue?", angle: "Light", audience: "students", keyPoints: ["Sunlight", "Scattering", "Sunsets"], outOfScope: [] };

let projectId: string;
const oid = () => new ObjectId(projectId);
const versionsOf = () => testMongo.db.collection("storyboard_versions").find({ projectId: oid() }).sort({ version: 1 }).toArray();
const project = () => testMongo.db.collection("projects").findOne({ _id: oid() });
const revisions = async () => (await testMongo.db.collection("usage_counters").findOne({ userId: ME.id }))?.revisions ?? 0;

function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`${APP}/api/v1/projects/${projectId}${path}`, {
    method,
    headers: { origin: APP, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const ctx = () => ({ params: Promise.resolve({ id: projectId }) });
async function patch(body: unknown, ifMatch: string | null = '"1"') {
  const res = await social.PATCH(req("PATCH", "/storyboard/social", body, ifMatch === null ? {} : { "if-match": ifMatch }), ctx());
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function rewriteIt(body: unknown = {}) {
  const res = await rewrite.POST(req("POST", "/storyboard/social/rewrite", body), ctx());
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
}

beforeAll(startTestMongo, 120_000);
afterAll(stopTestMongo);
beforeEach(async () => {
  await clearCollections(["projects", "idea_sessions", "profiles", "usage_counters", "ai_calls", "config", "pipeline_runs", "storyboard_versions"]);
  resetLimitsCache();
  resetModelCooldowns();
  const profile = await getOrCreateProfile(ME.id, ME.name);
  projectId = (await createProject(ME.id, profile, { title: "Sky" }))._id.toHexString();
  await testMongo.db.collection("idea_sessions").updateOne({ projectId: oid() }, { $set: { brief: BRIEF } });
  vi.stubEnv("BETTER_AUTH_URL", APP);
  vi.stubEnv("AI_PROVIDER", "mock");
  sessionUser.mockResolvedValue(ME);
  send.mockResolvedValue({ ids: ["evt"] });
  const res = await generate.POST(req("POST", "/storyboard/generate", {}), ctx());
  await runStoryboardJob((await res.json()).run.id);
});

describe("PATCH …/storyboard/social", () => {
  it("201: a new version with only the social part changed; the scenes are identical; hashtags normalised", async () => {
    const res = await patch({ caption: "  Why is the sky blue? 🌅  ", hashtags: ["science", "#Science", "# sky blue", "विज्ञान"], coverText: "Why  blue?" });
    expect(res.status).toBe(201);
    expect(res.json.version).toMatchObject({ version: 2, source: "manual_edit", basedOnVersion: 1, changeSummary: "Edited the caption, hashtags and cover text", changedSceneIds: [], isCurrent: true });
    expect(res.json.version.storyboard.social).toEqual({ caption: "Why is the sky blue? 🌅", hashtags: ["#science", "#skyblue", "#विज्ञान"], coverText: "Why blue?" });
    expect(res.json.project.currentStoryboardVersion).toBe(2);
    const [v1, v2] = await versionsOf();
    expect(v2.data.scenes).toEqual(v1.data.scenes);
    expect(v2.data.title).toBe(v1.data.title);
    expect((await project())!.status).toBe("storyboard_ready");
  });

  it("names what changed, keeps fields left out, and a save that changes nothing makes no version (200)", async () => {
    const [v1] = await versionsOf();
    const res = await patch({ coverText: "Blue sky, explained" });
    expect(res.json.version.changeSummary).toBe("Edited the cover text");
    expect(res.json.version.storyboard.social).toMatchObject({ caption: v1.data.social.caption, hashtags: v1.data.social.hashtags });
    const same = await patch({ coverText: "Blue sky, explained" }, '"2"');
    expect(same.status).toBe(200);
    expect(same.json.version.version).toBe(2);
    expect(await versionsOf()).toHaveLength(2);
  });

  it("422 CAPTION_INVALID over Instagram's limits; the 30th hashtag and 2,200 characters are fine", async () => {
    const tags = Array.from({ length: 30 }, (_, i) => `#t${i}`);
    expect((await patch({ caption: "Hi", hashtags: tags })).status).toBe(201);
    const over = await patch({ caption: "Hi #extra", hashtags: tags }, '"2"');
    expect(over.status).toBe(422);
    expect(over.json.error).toMatchObject({ code: "CAPTION_INVALID", details: [{ field: "hashtags" }] });
    const long = await patch({ caption: "x".repeat(2200), hashtags: [] }, '"2"');
    expect(long.status).toBe(201);
    expect((await patch({ caption: "x".repeat(2195), hashtags: ["#toolong"] }, '"3"')).json.error.details[0].issue).toMatch(/characters/);
    expect((await patch({ coverText: "one two three four five six" }, '"3"')).json.error.details[0]).toMatchObject({ field: "coverText" });
    expect((await patch({ caption: "Hindi हिंदी ".repeat(150).trim(), hashtags: [] }, '"3"')).status).toBe(201); // 1,799 characters, more UTF-16 units
  });

  it("If-Match: required (400), and a stale version gets 412 with the current version", async () => {
    expect((await patch({ coverText: "New" }, null)).status).toBe(400);
    const stale = await patch({ coverText: "New" }, '"7"');
    expect(stale.status).toBe(412);
    expect(stale.json.error.details[0].current).toMatchObject({ version: 1 });
  });

  it("409 while a storyboard is being written; 400 for an empty or unknown body; 404 for an unknown video", async () => {
    await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { status: "storyboard_generating" } });
    expect((await patch({ coverText: "New" })).status).toBe(409);
    await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { status: "storyboard_ready" } });
    expect((await patch({})).status).toBe(400);
    expect((await patch({ coverText: "x", userId: "y" })).status).toBe(400);
    const id = projectId;
    projectId = new ObjectId().toHexString();
    expect((await patch({ coverText: "New" })).status).toBe(404);
    projectId = id;
  });
});

describe("POST …/storyboard/social/rewrite", () => {
  it("200: a new caption, hashtags and cover in the video's language; not saved; one revisions unit; logged as caption", async () => {
    const res = await rewriteIt({ instruction: "more fun" });
    expect(res.status).toBe(200);
    expect(res.json.social.caption).toMatch(/^\[Mock\]/);
    expect(res.json.social.hashtags.length).toBeGreaterThanOrEqual(5);
    expect(res.json.basedOnVersion).toBe(1);
    expect(await versionsOf()).toHaveLength(1);
    expect(await revisions()).toBe(1);
    expect(res.headers.get("ratelimit-limit")).toBe("100");
    expect(await testMongo.db.collection("ai_calls").findOne({ userId: ME.id, task: "caption" })).toMatchObject({ provider: "mock", status: "ok" });
    // Saving it is an ordinary edit.
    expect((await patch(res.json.social)).status).toBe(201);
  });

  it("Hindi videos get a Hindi caption", async () => {
    await testMongo.db.collection("storyboard_versions").updateOne({ projectId: oid() }, { $set: { "data.language": "hi" } });
    expect((await rewriteIt()).json.social.caption).toMatch(/[ऀ-ॿ]/);
  });

  it("busy: 503 and the unit is given back; refused: 422 and it counts", async () => {
    const busy = await rewriteIt({ instruction: "[mock:busy]" });
    expect(busy.status).toBe(503);
    expect(await revisions()).toBe(0);
    const refused = await rewriteIt({ instruction: "[mock:refuse]" });
    expect(refused.status).toBe(422);
    expect(refused.json.error).toMatchObject({ code: "UNSAFE_CONTENT", details: [{ field: "caption" }] });
    expect(await revisions()).toBe(1);
  });

  it("409 outside storyboard_ready; 400 for a long instruction; 429 at the revisions limit", async () => {
    await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { status: "storyboard_generating" } });
    expect((await rewriteIt()).status).toBe(409);
    await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { status: "storyboard_ready" } });
    expect((await rewriteIt({ instruction: "x".repeat(301) })).status).toBe(400);
    await testMongo.db.collection("usage_counters").updateMany({ userId: ME.id }, { $set: { revisions: 100 } });
    expect((await rewriteIt()).json.error.code).toBe("LIMIT_REACHED");
  });
});
