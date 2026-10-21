import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/mongo", async () => (await import("../../../test/mongo")).mongoModule);
const sessionUser = vi.hoisted(() => vi.fn());
vi.mock("../api/session", () => ({ sessionUser }));
const generateContent = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

import * as briefRoute from "@/app/api/v1/projects/[id]/idea/brief/route";
import * as chatRoute from "@/app/api/v1/projects/[id]/idea/chat/route";
import { resetModelCooldowns } from "@videozilla/ai";
import { clearCollections, startTestMongo, stopTestMongo, testMongo } from "../../../test/mongo";
import { getIdea } from "./ideas";
import { getOrCreateProfile } from "./profiles";
import { createProject, updateProject } from "./projects";
import { resetLimitsCache } from "./usage";

/** F2.8: `PATCH /api/v1/projects/{id}/idea/brief` (direct edits, no AI) against a throwaway MongoDB. */

const APP = "http://localhost:3000";
const ME = { id: new ObjectId().toHexString(), name: "Me", email: "me@example.com", emailVerified: true, image: null, createdAt: new Date() };
const BRIEF = { title: "Why leaves turn red", hook: "Leaves hide their colours all summer.", angle: "Pigments revealed", audience: "students", keyPoints: ["Chlorophyll", "Carotenoids", "Anthocyanins"], outOfScope: ["Tree species"] };
const ALTS = [{ ...BRIEF, title: "Alt 1" }, { ...BRIEF, title: "Alt 2" }];
const SINCE = new Date(Math.floor(Date.now() / 1000) * 1000 - 60 * 60_000); // an hour ago, whole seconds

let projectId: string;
const oid = () => new ObjectId(projectId);
const setIdea = (fields: Record<string, unknown>) => testMongo.db.collection("idea_sessions").updateOne({ projectId: oid() }, { $set: fields });

beforeAll(startTestMongo, 120_000);
afterAll(stopTestMongo);
beforeEach(async () => {
  await clearCollections(["projects", "idea_sessions", "profiles", "usage_counters", "ai_calls", "config", "chat_messages"]);
  resetLimitsCache();
  const profile = await getOrCreateProfile(ME.id, ME.name);
  projectId = (await createProject(ME.id, profile))._id.toHexString();
  await setIdea({ brief: BRIEF, briefAlternatives: ALTS, briefUpdatedAt: SINCE, briefLanguage: "en", briefLengthSec: 60 });
  await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { title: BRIEF.title } }); // the title followed the brief
  vi.stubEnv("BETTER_AUTH_URL", APP);
  vi.stubEnv("AI_PROVIDER", "gemini");
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("GEMINI_FAST_MODEL", "");
  vi.stubEnv("GEMINI_FALLBACK_MODEL", "");
  sessionUser.mockResolvedValue(ME);
  generateContent.mockReset();
  resetModelCooldowns();
});

async function patch(body: Record<string, unknown>, id = projectId) {
  const res = await briefRoute.PATCH(
    new Request(`${APP}/api/v1/projects/${id}/idea/brief`, { method: "PATCH", headers: { origin: APP, "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, json: await res.json().catch(() => null) };
}
const edit = (fields: Record<string, unknown>) => patch({ briefUpdatedAt: SINCE.toISOString(), ...fields });

describe("PATCH …/idea/brief — edits", () => {
  it("saves every text field (trimmed), keeps the rest, the angles and the settings it was written for; no AI call, nothing counted", async () => {
    const res = await edit({ title: "  Why leaves blush  ", hook: "Ever seen a leaf blush?", angle: "A story of pigments", keyPoints: ["Green hides red", "Cold reveals it"], outOfScope: [] });
    expect(res.status).toBe(200);
    expect(res.json.brief).toEqual({ ...BRIEF, title: "Why leaves blush", hook: "Ever seen a leaf blush?", angle: "A story of pigments", keyPoints: ["Green hides red", "Cold reveals it"], outOfScope: [] });
    expect(res.json.briefAlternatives).toEqual(ALTS);
    expect(res.json).toMatchObject({ briefLanguage: "en", briefLengthSec: 60, rev: 0 });
    expect(Date.parse(res.json.briefUpdatedAt)).toBeGreaterThan(SINCE.getTime());
    expect(res.json.project.title).toBe("Why leaves blush"); // still following the brief, so it follows the edit
    expect(generateContent).not.toHaveBeenCalled();
    expect(await testMongo.db.collection("usage_counters").countDocuments()).toBe(0);
    expect(await testMongo.db.collection("ai_calls").countDocuments()).toBe(0);
  });

  it("a partial edit changes only that field; key points keep their order; 1 to 5 points", async () => {
    const res = await edit({ keyPoints: ["Third first", "Then one", "Then two", "And four", "And five"] });
    expect(res.json.brief).toEqual({ ...BRIEF, keyPoints: ["Third first", "Then one", "Then two", "And four", "And five"] });
    const one = await patch({ briefUpdatedAt: res.json.briefUpdatedAt, keyPoints: ["Just one"] });
    expect(one.json.brief.keyPoints).toEqual(["Just one"]);
  });

  it("a title the user typed is never replaced", async () => {
    await updateProject(ME.id, projectId, { title: "My own title" });
    expect((await edit({ title: "New brief title" })).json.project.title).toBe("My own title");
  });

  it("once the video has a storyboard, a brief edit no longer renames it (it only feeds the next regenerate, F3.1)", async () => {
    await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { status: "storyboard_ready", currentStoryboardVersion: 1 } });
    const res = await edit({ title: "New brief title" });
    expect(res.status).toBe(200);
    expect(res.json.brief.title).toBe("New brief title");
    expect(res.json.project.title).toBe(BRIEF.title);
  });

  it("the audience stays the video's setting; a notes summary stays", async () => {
    await setIdea({ brief: { ...BRIEF, sourceNotesSummary: "Notes on leaves." } });
    await updateProject(ME.id, projectId, { audience: "kids" });
    const res = await edit({ hook: "A new hook here" });
    expect(res.json.brief).toMatchObject({ audience: "kids", sourceNotesSummary: "Notes on leaves.", hook: "A new hook here" });
  });

  it("an edit that changes nothing rewrites nothing (briefUpdatedAt stays)", async () => {
    const res = await edit({ title: BRIEF.title, keyPoints: BRIEF.keyPoints });
    expect(res.status).toBe(200);
    expect(res.json.briefUpdatedAt).toBe(SINCE.toISOString());
  });

  it("limits in characters (Hindi and emoji count as one); audience, notes summary and unknown fields are refused", async () => {
    const hindiTitle = "पत्तियाँ लाल क्यों होती हैं".padEnd(80, "।");
    expect(Array.from(hindiTitle).length).toBe(80);
    expect((await edit({ title: hindiTitle })).status).toBe(200);
    for (const body of [
      { title: "ab" },
      { title: "x".repeat(81) },
      { hook: "h".repeat(201) },
      { angle: "a".repeat(301) },
      { keyPoints: [] },
      { keyPoints: ["1", "two"] },
      { keyPoints: ["a1", "a2", "a3", "a4", "a5", "a6"] },
      { keyPoints: ["k".repeat(161)] },
      { outOfScope: ["o1", "o2", "o3", "o4", "o5", "o6"] },
      { audience: "kids" },
      { sourceNotesSummary: "x" },
      { userId: "x" },
    ]) {
      expect((await patch({ briefUpdatedAt: (await getIdea(ME.id, projectId))!.briefUpdatedAt!.toISOString(), ...body })).status, JSON.stringify(body).slice(0, 50)).toBe(400);
    }
    expect((await patch({ title: "No guard" })).status).toBe(400); // briefUpdatedAt is required
    expect((await edit({ title: "x".repeat(81) })).json.error.message).toMatch(/at most 80 characters/);
  });
});

describe("PATCH …/idea/brief — guards", () => {
  it("every field is one line (breaks and runs of spaces become one space) and needs a letter or digit, not just invisible characters", async () => {
    const res = await edit({ title: "Why leaves\n\n  blush", keyPoints: ["Green\nhides red", "Cold   reveals it"] });
    expect(res.status).toBe(200);
    expect(res.json.brief).toMatchObject({ title: "Why leaves blush", keyPoints: ["Green hides red", "Cold reveals it"] });
    expect(res.json.project.title).toBe("Why leaves blush"); // the video title that followed is one line too
    for (const bad of ["\u200B\u200B\u200B", "...", "— — —"]) {
      const r = await edit({ title: bad });
      expect(r.status).toBe(400);
      expect(r.json.error.details[0]).toMatchObject({ field: "title", issue: "Must contain a letter or digit" });
    }
  });

  it("the brief changed since (chat, angle, another tab): 412 with the current idea, nothing saved", async () => {
    const newer = new Date(SINCE.getTime() + 60_000);
    await setIdea({ brief: { ...BRIEF, title: "Another tab's brief" }, briefUpdatedAt: newer });
    const res = await edit({ title: "My edit" });
    expect(res.status).toBe(412);
    expect(res.json.error.details[0]).toMatchObject({ field: "briefUpdatedAt", current: { brief: { title: "Another tab's brief" }, briefUpdatedAt: newer.toISOString() } });
    expect((await getIdea(ME.id, projectId))!.brief!.title).toBe("Another tab's brief");
    // "Keep mine": saved again on the brief that's there now.
    expect((await patch({ briefUpdatedAt: newer.toISOString(), title: "My edit" })).json.brief.title).toBe("My edit");
  });

  it("a chat answer based on the brief before the edit can't undo the edit (412 for the chat)", async () => {
    let releaseChat!: () => void;
    generateContent.mockImplementationOnce(async () => {
      await new Promise<void>((r) => (releaseChat = r));
      return { text: JSON.stringify({ status: "applied", reply: "Done.", brief: { ...BRIEF, hook: "The AI's hook" } }) };
    });
    const chat = chatRoute.POST(
      new Request(`${APP}/api/v1/projects/${projectId}/idea/chat`, { method: "POST", headers: { origin: APP, "content-type": "application/json" }, body: JSON.stringify({ clientMessageId: crypto.randomUUID(), content: "new hook" }) }),
      { params: Promise.resolve({ id: projectId }) },
    );
    // Generous: on a busy CI machine the chat request takes longer to reach the AI call than the 1 s default.
    await vi.waitFor(() => expect(generateContent).toHaveBeenCalled(), { timeout: 10_000, interval: 20 });
    expect((await edit({ hook: "My hook, typed" })).status).toBe(200);
    releaseChat();
    expect((await chat).status).toBe(412);
    expect((await getIdea(ME.id, projectId))!.brief!.hook).toBe("My hook, typed");
  });

  it("no brief: 400; outside the Idea stage: 409; unknown or malformed project: 404", async () => {
    await setIdea({ brief: null, briefUpdatedAt: null });
    expect((await edit({ title: "Something" })).json.error).toMatchObject({ code: "VALIDATION_FAILED", details: [{ field: "brief" }] });
    await setIdea({ brief: BRIEF, briefUpdatedAt: SINCE });
    await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { status: "storyboard_generating" } });
    expect((await edit({ title: "Something" })).status).toBe(409);
    expect((await patch({ briefUpdatedAt: SINCE.toISOString(), title: "Something" }, new ObjectId().toHexString())).status).toBe(404);
    expect((await patch({ briefUpdatedAt: SINCE.toISOString(), title: "Something" }, "nope")).status).toBe(404);
  });
});
