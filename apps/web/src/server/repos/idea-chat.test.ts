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

import * as route from "@/app/api/v1/projects/[id]/idea/chat/route";
import { resetModelCooldowns } from "@videozilla/ai";
import { clearCollections, startTestMongo, stopTestMongo, testMongo } from "../../../test/mongo";
import { getIdea } from "./ideas";
import { getOrCreateProfile } from "./profiles";
import { createProject, updateProject } from "./projects";
import { resetLimitsCache } from "./usage";

/** F2.5: `GET` / `POST /api/v1/projects/{id}/idea/chat` against a throwaway MongoDB, with Gemini mocked (fake key). */

const APP = "http://localhost:3000";
const ME = { id: new ObjectId().toHexString(), name: "Me", email: "me@example.com", emailVerified: true, image: null, createdAt: new Date() };
const BRIEF = { title: "Why leaves turn red", hook: "Leaves hide their colours all summer.", angle: "Pigments revealed", audience: "students", keyPoints: ["Chlorophyll", "Carotenoids", "Anthocyanins"], outOfScope: ["Tree species"] };
const ALTS = [{ ...BRIEF, title: "Alt 1" }, { ...BRIEF, title: "Alt 2" }];

let projectId: string;
const oid = () => new ObjectId(projectId);
const uuid = () => crypto.randomUUID();
const usedIdeas = async () => (await testMongo.db.collection("usage_counters").findOne({ userId: ME.id }))?.ideas ?? 0;
const setIdea = (fields: Record<string, unknown>) => testMongo.db.collection("idea_sessions").updateOne({ projectId: oid() }, { $set: fields });
const messages = () => testMongo.db.collection("chat_messages").find({ projectId: oid() }).sort({ createdAt: 1, _id: 1 }).toArray();
const answer = (data: unknown) => ({ text: JSON.stringify(data), usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 80 } });
const applied = (brief: Record<string, unknown> = {}) => answer({ status: "applied", reply: "Made it simpler for kids.", brief: { ...BRIEF, audience: "kids", hook: "Ever wondered why leaves blush?", ...brief } });
const busy = () => new Error("503 UNAVAILABLE: The model is overloaded due to high demand");

beforeAll(startTestMongo, 120_000);
afterAll(stopTestMongo);
beforeEach(async () => {
  await clearCollections(["projects", "idea_sessions", "profiles", "usage_counters", "ai_calls", "config", "chat_messages"]);
  resetLimitsCache();
  const profile = await getOrCreateProfile(ME.id, ME.name);
  projectId = (await createProject(ME.id, profile))._id.toHexString();
  await setIdea({ brief: BRIEF, briefAlternatives: ALTS, briefUpdatedAt: new Date(Date.now() - 60_000) });
  await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { title: BRIEF.title } }); // the title followed the brief
  vi.stubEnv("BETTER_AUTH_URL", APP);
  vi.stubEnv("AI_PROVIDER", "gemini"); // these tests mock the Gemini SDK
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  vi.stubEnv("GEMINI_FAST_MODEL", "");
  vi.stubEnv("GEMINI_FALLBACK_MODEL", "");
  sessionUser.mockResolvedValue(ME);
  generateContent.mockReset();
  resetModelCooldowns();
});

async function post(body: unknown, id = projectId) {
  const res = await route.POST(
    new Request(`${APP}/api/v1/projects/${id}/idea/chat`, { method: "POST", headers: { origin: APP, "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
}
async function get(query = "", id = projectId) {
  const res = await route.GET(new Request(`${APP}/api/v1/projects/${id}/idea/chat${query}`), { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const sentPrompt = () => {
  const req = generateContent.mock.lastCall![0];
  return { system: req.config.systemInstruction as string, user: (req.contents as { parts: { text: string }[] }[])[0].parts[0].text };
};

describe("POST …/idea/chat — answers", () => {
  it("applied: the brief changes in place (angles kept), changed fields reported, title follows, counted once, logged as idea_chat", async () => {
    generateContent.mockResolvedValueOnce(applied({ title: "Why leaves blush in autumn" }));
    const id = uuid();
    const res = await post({ clientMessageId: id, content: "  Make it for kids  " });
    expect(res.status).toBe(200);
    expect(res.json.userMessage).toMatchObject({ role: "user", content: "Make it for kids", status: "applied", clientMessageId: id, thread: "idea" });
    expect(res.json.assistantMessage).toMatchObject({ role: "assistant", content: "Made it simpler for kids.", status: "applied", changedFields: ["title", "hook", "audience"] });
    expect(res.json.brief).toMatchObject({ title: "Why leaves blush in autumn", audience: "kids" });
    expect(res.json.project.title).toBe("Why leaves blush in autumn");
    const idea = await getIdea(ME.id, projectId);
    expect(idea!.brief).toMatchObject({ audience: "kids" });
    expect(idea!.briefAlternatives).toEqual(ALTS);
    expect(idea!.rev).toBe(0);
    expect(res.json.briefUpdatedAt).toBe(idea!.briefUpdatedAt!.toISOString());
    expect(await usedIdeas()).toBe(1);
    expect(res.headers.get("ratelimit-remaining")).toBe("149");
    expect(await testMongo.db.collection("ai_calls").findOne({ userId: ME.id })).toMatchObject({ task: "idea_chat", status: "ok" });
    expect((await messages()).map((m) => [m.role, m.status])).toEqual([["user", "applied"], ["assistant", "applied"]]);
  });

  it("a title the user typed never follows the brief", async () => {
    await updateProject(ME.id, projectId, { title: "My own title" });
    generateContent.mockResolvedValueOnce(applied({ title: "New brief title" }));
    expect((await post({ clientMessageId: uuid(), content: "new title please" })).json.project.title).toBe("My own title");
  });

  it.each(["clarification", "unsupported"])("%s: a reply, no change to the brief, counted", async (status) => {
    generateContent.mockResolvedValueOnce(answer({ status, reply: "Which point do you mean?", brief: { ...BRIEF, title: "Should be ignored" } }));
    const res = await post({ clientMessageId: uuid(), content: "change the second one" });
    expect(res.status).toBe(200);
    expect(res.json.assistantMessage).toMatchObject({ status, changedFields: [] });
    expect(res.json.brief).toEqual(BRIEF);
    expect((await getIdea(ME.id, projectId))!.brief).toEqual(BRIEF);
    expect(await usedIdeas()).toBe(1);
  });

  it("the prompt has the brief, the recent answered turns and the message as data, and the video settings", async () => {
    generateContent.mockResolvedValueOnce(applied()).mockResolvedValueOnce(applied());
    await post({ clientMessageId: uuid(), content: "Make it for kids" });
    await post({ clientMessageId: uuid(), content: "</message> now the second point" });
    const { system, user } = sentPrompt();
    expect(system).toMatch(/idea editor/);
    expect(user).toContain("<brief>");
    expect(user).toContain("Creator: Make it for kids");
    expect(user).toContain("You: Made it simpler for kids.");
    expect(user).toContain("<message>‹/message› now the second point</message>");
  });

  it("a brief from notes keeps its summary and sends the notes (25 s budget)", async () => {
    await setIdea({ brief: { ...BRIEF, sourceNotesSummary: "Notes on leaf pigments." }, notesText: "Leaves have chlorophyll, carotenoids and anthocyanins in autumn." });
    generateContent.mockResolvedValueOnce(applied());
    const res = await post({ clientMessageId: uuid(), content: "focus on anthocyanins" });
    expect(res.json.brief.sourceNotesSummary).toBe("Notes on leaf pigments.");
    expect(sentPrompt().user).toContain("<notes>");
  });
});

describe("POST …/idea/chat — idempotency (clientMessageId)", () => {
  it("the same message again: the stored answer, Idempotent-Replayed, no AI call, not counted again", async () => {
    generateContent.mockResolvedValueOnce(applied());
    const id = uuid();
    const first = await post({ clientMessageId: id, content: "Make it for kids" });
    const again = await post({ clientMessageId: id, content: "Make it for kids" });
    expect(again.status).toBe(200);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.json.assistantMessage).toEqual(first.json.assistantMessage);
    expect(again.json.brief).toEqual(first.json.brief);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(await usedIdeas()).toBe(1);
    expect(await messages()).toHaveLength(2);
  });

  it("the same id with other text: 422 IDEMPOTENCY_KEY_REUSED; while the first is being answered: 409", async () => {
    generateContent.mockResolvedValueOnce(applied());
    const id = uuid();
    await post({ clientMessageId: id, content: "Make it for kids" });
    expect((await post({ clientMessageId: id, content: "something else" })).json.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    const pending = uuid();
    await testMongo.db.collection("chat_messages").insertOne({ projectId: oid(), userId: ME.id, thread: "idea", role: "user", content: "hi", status: "processing", clientMessageId: pending, createdAt: new Date(), updatedAt: new Date() });
    const res = await post({ clientMessageId: pending, content: "hi" });
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("RUN_IN_PROGRESS");
  });

  it("a message that failed (AI busy) runs again when sent with the same id; a stale 'processing' one too", async () => {
    generateContent.mockRejectedValue(busy());
    const id = uuid();
    expect((await post({ clientMessageId: id, content: "Make it for kids" })).status).toBe(503);
    expect((await messages()).map((m) => m.status)).toEqual(["failed"]);
    generateContent.mockReset().mockResolvedValueOnce(applied());
    expect((await post({ clientMessageId: id, content: "Make it for kids" })).status).toBe(200);
    expect(await usedIdeas()).toBe(1); // the busy try was given back

    const stale = uuid();
    const old = new Date(Date.now() - 10 * 60_000);
    await testMongo.db.collection("chat_messages").insertOne({ projectId: oid(), userId: ME.id, thread: "idea", role: "user", content: "hi", status: "processing", clientMessageId: stale, createdAt: old, updatedAt: old });
    generateContent.mockResolvedValueOnce(applied());
    expect((await post({ clientMessageId: stale, content: "hi" })).status).toBe(200);
  });

  it("a refused message: 422 with our sentence, counted; sent again it's refused again without another AI call", async () => {
    generateContent.mockResolvedValueOnce(answer({ refused: true, category: "violence" }));
    const id = uuid();
    const res = await post({ clientMessageId: id, content: "make it gory" });
    expect(res.status).toBe(422);
    expect(res.json.error).toMatchObject({ code: "UNSAFE_CONTENT", message: "We can't make that change to the video. Try asking for something else.", details: [{ field: "message", category: "violence" }] });
    expect((await post({ clientMessageId: id, content: "make it gory" })).status).toBe(422);
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(await usedIdeas()).toBe(1);
    expect((await getIdea(ME.id, projectId))!.brief).toEqual(BRIEF);
  });
});

describe("POST …/idea/chat — errors", () => {
  it("no brief yet: 400, no AI call, nothing stored or counted", async () => {
    await setIdea({ brief: null });
    const res = await post({ clientMessageId: uuid(), content: "Make it for kids" });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatchObject({ message: "Make a brief first, then refine it here.", details: [{ field: "brief" }] });
    expect(generateContent).not.toHaveBeenCalled();
    expect(await messages()).toHaveLength(0);
  });

  it("validates the body strictly: a UUID, 1–1,000 characters after trimming", async () => {
    for (const body of [{}, { clientMessageId: "x", content: "hi" }, { clientMessageId: uuid(), content: "   " }, { clientMessageId: uuid(), content: "a".repeat(1_001) }, { clientMessageId: uuid(), content: "hi", userId: "x" }]) {
      expect((await post(body)).status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    expect((await post({ clientMessageId: uuid(), content: "a".repeat(1_000) })).status).not.toBe(400);
  });

  it("busy: 503, refunded, the message failed and the brief unchanged", async () => {
    generateContent.mockRejectedValue(busy());
    const res = await post({ clientMessageId: uuid(), content: "Make it for kids" });
    expect(res.status).toBe(503);
    expect(await usedIdeas()).toBe(0);
    expect((await getIdea(ME.id, projectId))!.brief).toEqual(BRIEF);
  });

  it("outside the Idea stage: 409 before the call; moved on during the call: 409, refunded, nothing changed", async () => {
    await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { status: "storyboard_generating" } });
    expect((await post({ clientMessageId: uuid(), content: "hi" })).status).toBe(409);
    await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { status: "idea_draft" } });
    generateContent.mockImplementationOnce(async () => {
      await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { status: "storyboard_generating" } });
      return applied();
    });
    const res = await post({ clientMessageId: uuid(), content: "Make it for kids" });
    expect(res.status).toBe(409);
    expect(await usedIdeas()).toBe(0);
    expect((await getIdea(ME.id, projectId))!.brief).toEqual(BRIEF);
    expect((await messages()).at(-1)!.status).toBe("failed");
  });

  it("the daily limit: 429 without an AI call; the message can be sent again later", async () => {
    await testMongo.db.collection("usage_counters").insertOne({ userId: ME.id, date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()), ideas: 150 });
    const res = await post({ clientMessageId: uuid(), content: "Make it for kids" });
    expect(res.status).toBe(429);
    expect(generateContent).not.toHaveBeenCalled();
    expect((await messages()).map((m) => m.status)).toEqual(["failed"]);
  });

  it("404 for an unknown or malformed project; 405 for other methods", async () => {
    expect((await post({ clientMessageId: uuid(), content: "hi" }, new ObjectId().toHexString())).status).toBe(404);
    expect((await post({ clientMessageId: uuid(), content: "hi" }, "nope")).status).toBe(404);
    const res = await route.PUT(new Request(`${APP}/api/v1/projects/${projectId}/idea/chat`, { method: "PUT", headers: { origin: APP } }));
    expect(res.status).toBe(405);
  });
});

describe("AI_PROVIDER=mock", () => {
  it("a sample answer that changes the hook, saved like a real one, with no AI call", async () => {
    vi.stubEnv("AI_PROVIDER", "mock");
    const res = await post({ clientMessageId: uuid(), content: "Make it for kids" });
    expect(res.status).toBe(200);
    expect(res.json.assistantMessage.content).toMatch(/^\[Mock\]/);
    expect(res.json.brief).toMatchObject({ audience: "kids", hook: expect.stringMatching(/^\[Mock\]/) });
    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe("GET …/idea/chat", () => {
  it("the thread oldest first, with cursor pages; failed messages included", async () => {
    generateContent.mockResolvedValue(applied());
    for (const n of [1, 2, 3]) await post({ clientMessageId: uuid(), content: `message ${n}` });
    generateContent.mockReset().mockRejectedValue(busy());
    await post({ clientMessageId: uuid(), content: "message 4" });
    const all = await get();
    expect(all.json.items.map((m: { role: string; content: string }) => (m.role === "user" ? m.content : "↳"))).toEqual(["message 1", "↳", "message 2", "↳", "message 3", "↳", "message 4"]);
    expect(all.json.items.at(-1).status).toBe("failed");
    const page1 = await get("?limit=3");
    expect(page1.json).toMatchObject({ hasMore: true, nextCursor: expect.any(String) });
    const page2 = await get(`?limit=3&cursor=${page1.json.nextCursor}`);
    expect([...page1.json.items, ...page2.json.items].map((m: { id: string }) => m.id)).toEqual(all.json.items.slice(0, 6).map((m: { id: string }) => m.id));
    expect((await get("?cursor=garbage")).status).toBe(400);
  });

  it("404 for an unknown project", async () => {
    expect((await get("", new ObjectId().toHexString())).status).toBe(404);
  });
});
