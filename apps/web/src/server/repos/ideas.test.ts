import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/mongo", async () => (await import("../../../test/mongo")).mongoModule);
const sessionUser = vi.hoisted(() => vi.fn());
vi.mock("../api/session", () => ({ sessionUser }));

import * as route from "@/app/api/v1/projects/[id]/idea/route";
import { clearCollections, startTestMongo, stopTestMongo, testMongo } from "../../../test/mongo";
import { getOrCreateProfile } from "./profiles";
import { createProject, deleteProject } from "./projects";
import { getIdea, saveIdea } from "./ideas";

const APP = "http://localhost:3000";
const ME = { id: new ObjectId().toHexString(), name: "Me", email: "me@example.com", emailVerified: true, image: null, createdAt: new Date() };

let projectId: string;

beforeAll(startTestMongo, 120_000);
afterAll(stopTestMongo);
beforeEach(async () => {
  await clearCollections();
  const profile = await getOrCreateProfile(ME.id, ME.name);
  projectId = (await createProject(ME.id, profile, { title: "Photosynthesis" }))._id.toHexString();
  vi.stubEnv("BETTER_AUTH_URL", APP);
  sessionUser.mockResolvedValue(ME);
});

const setStatus = (status: string) => testMongo.db.collection("projects").updateOne({ _id: new ObjectId(projectId) }, { $set: { status } });
const project = () => testMongo.db.collection("projects").findOne({ _id: new ObjectId(projectId) });

async function put(body: unknown, headers: Record<string, string> = {}, id = projectId) {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const res = await route.PUT(
    new Request(`${APP}/api/v1/projects/${id}/idea`, { method: "PUT", headers: { origin: APP, "content-type": "application/json", ...headers }, body: raw }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, json: await res.json().catch(() => null), etag: res.headers.get("etag") };
}

async function get(id = projectId) {
  const res = await route.GET(new Request(`${APP}/api/v1/projects/${id}/idea`), { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json().catch(() => null), etag: res.headers.get("etag") };
}

describe("GET /api/v1/projects/{id}/idea", () => {
  it("returns the new project's empty idea session with its ETag (the IdeaSession resource of API Design §12)", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.etag).toBe('"0"');
    expect(res.json).toEqual({ projectId, mode: "topic", topicInput: "", ideaInput: "", notesText: "", suggestions: [], brief: null, briefAlternatives: [], briefUpdatedAt: null, rev: 0, updatedAt: expect.any(String) });
  });

  it("is 404 for an unknown, malformed or deleted project", async () => {
    expect((await get(new ObjectId().toHexString())).status).toBe(404);
    expect((await get("not-an-id")).status).toBe(404);
    await deleteProject(ME.id, projectId);
    expect((await get()).status).toBe(404);
  });
});

describe("PUT /api/v1/projects/{id}/idea", () => {
  it("saves the mode and the inputs sent, bumps rev and returns the new ETag", async () => {
    const res = await put({ mode: "idea", ideaInput: "Why is the sky blue?" });
    expect(res.status).toBe(200);
    expect(res.etag).toBe('"1"');
    expect(res.json).toMatchObject({ mode: "idea", ideaInput: "Why is the sky blue?", topicInput: "", rev: 1 });
    expect((await get()).json).toMatchObject({ mode: "idea", ideaInput: "Why is the sky blue?", rev: 1 });
  });

  it("keeps the inputs that aren't sent, so each tab keeps its own text", async () => {
    await put({ mode: "topic", topicInput: "Plants" });
    await put({ mode: "notes", notesText: "Chlorophyll absorbs light." });
    const { json } = await put({ mode: "idea", ideaInput: "Leaves are green" });
    expect(json).toMatchObject({ mode: "idea", topicInput: "Plants", ideaInput: "Leaves are green", notesText: "Chlorophyll absorbs light.", rev: 3 });
  });

  it("can clear an input", async () => {
    await put({ mode: "topic", topicInput: "Plants" });
    expect((await put({ mode: "topic", topicInput: "" })).json.topicInput).toBe("");
  });

  it("trims and NFC-normalises text and keeps new lines in notes", async () => {
    const { json } = await put({ mode: "notes", notesText: "  line one\r\nline two é  " });
    expect(json.notesText).toBe("line one\nline two é");
  });

  it("saving what's already stored changes nothing: same rev, no conflict with another tab", async () => {
    await put({ mode: "idea", ideaInput: "Same" });
    const before = await project();
    const res = await put({ mode: "idea", ideaInput: "Same" }, { "if-match": '"1"' });
    expect(res.status).toBe(200);
    expect(res.json.rev).toBe(1);
    expect((await project())!.updatedAt).toEqual(before!.updatedAt);
  });

  it("applies If-Match: the right rev saves, a stale rev is 412 with the current idea, * is last write wins", async () => {
    expect((await put({ mode: "idea", ideaInput: "First" }, { "if-match": '"0"' })).status).toBe(200);
    const stale = await put({ mode: "idea", ideaInput: "From an old tab" }, { "if-match": '"0"' });
    expect(stale.status).toBe(412);
    expect(stale.json.error.code).toBe("PRECONDITION_FAILED");
    expect(stale.json.error.details[0].current).toMatchObject({ ideaInput: "First", rev: 1 });
    expect((await get()).json.ideaInput).toBe("First");
    expect((await put({ mode: "idea", ideaInput: "Forced" }, { "if-match": "*" })).json).toMatchObject({ ideaInput: "Forced", rev: 2 });
    expect((await put({ mode: "idea", ideaInput: "x" }, { "if-match": "2" })).status).toBe(400);
  });

  it("counts limits in characters like the database: 200 / 500 / 20,000, including Hindi and emoji", async () => {
    expect((await put({ mode: "topic", topicInput: "😀".repeat(200) })).status).toBe(200);
    expect((await put({ mode: "topic", topicInput: "😀".repeat(201) })).status).toBe(400);
    expect((await put({ mode: "idea", ideaInput: "क".repeat(500) })).status).toBe(200);
    expect((await put({ mode: "idea", ideaInput: "a".repeat(501) })).status).toBe(400);
    const notes = "प्रकाश संश्लेषण 🌱 ".repeat(1_100).slice(0, 19_990);
    expect((await put({ mode: "notes", notesText: notes })).status).toBe(200);
    expect((await put({ mode: "notes", notesText: "a".repeat(20_001) })).status).toBe(400);
  });

  it("accepts the full 20,000 characters of 4-byte text (80 KB) but not bodies over 128 KB", async () => {
    expect((await put({ mode: "notes", notesText: "😀".repeat(20_000) })).status).toBe(200);
    const res = await put(JSON.stringify({ mode: "notes", notesText: "a".repeat(20_000), pad: "x".repeat(130 * 1024) }));
    expect(res.status).toBe(413);
  });

  it("rejects unknown fields, a missing or wrong mode, and other content types", async () => {
    for (const body of [{ mode: "idea", brief: { title: "x" } }, { mode: "idea", rev: 9 }, { ideaInput: "x" }, { mode: "chat" }, { mode: "idea", ideaInput: 5 }]) {
      expect((await put(body)).status, JSON.stringify(body)).toBe(400);
    }
    const res = await route.PUT(new Request(`${APP}/api/v1/projects/${projectId}/idea`, { method: "PUT", headers: { origin: APP, "content-type": "text/plain" }, body: "x" }), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(res.status).toBe(415);
  });

  it("works in idea_draft and storyboard_ready; 409 INVALID_STATE while a storyboard is generating or later", async () => {
    await setStatus("storyboard_ready");
    expect((await put({ mode: "idea", ideaInput: "Changed after the storyboard" })).status).toBe(200);
    for (const status of ["storyboard_generating", "building", "preview_ready", "exported", "needs_attention"]) {
      await setStatus(status);
      const res = await put({ mode: "idea", ideaInput: `In ${status}` });
      expect(res.status, status).toBe(409);
      expect(res.json.error.code).toBe("INVALID_STATE");
    }
    // An unchanged save (e.g. the page's last echo) still answers 200.
    expect((await put({ mode: "idea", ideaInput: "Changed after the storyboard" })).status).toBe(200);
  });

  it("moves the project to the top of the Library (updatedAt) without changing its rev", async () => {
    const before = await project();
    await new Promise((r) => setTimeout(r, 5));
    await put({ mode: "topic", topicInput: "Volcanoes" });
    const after = await project();
    expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
    expect(after!.rev).toBe(before!.rev);
  });

  it("is 404 for an unknown, malformed or deleted project", async () => {
    expect((await put({ mode: "idea" }, {}, new ObjectId().toHexString())).status).toBe(404);
    expect((await put({ mode: "idea" }, {}, "nope")).status).toBe(404);
    await deleteProject(ME.id, projectId);
    expect((await put({ mode: "idea", ideaInput: "x" })).status).toBe(404);
  });

  it("answers other methods with 405", async () => {
    const res = await route.POST(new Request(`${APP}/api/v1/projects/${projectId}/idea`, { method: "POST", headers: { origin: APP } }), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, PUT");
  });
});

describe("saveIdea / getIdea", () => {
  it("gives a project without an idea session (old data) an empty one, created by the first save", async () => {
    await testMongo.db.collection("idea_sessions").deleteMany({});
    expect(await getIdea(ME.id, projectId)).toMatchObject({ mode: "topic", rev: 0 });
    const res = await saveIdea(ME.id, projectId, { mode: "idea", ideaInput: "Hello" });
    expect(res).toMatchObject({ ok: true, changed: true, idea: { ideaInput: "Hello", rev: 1 } });
    expect(await testMongo.db.collection("idea_sessions").countDocuments({ projectId: new ObjectId(projectId) })).toBe(1);
  });

  it("concurrent saves with the same If-Match: exactly one wins, the other gets the current idea", async () => {
    const results = await Promise.all(["A", "B", "C"].map((t) => saveIdea(ME.id, projectId, { mode: "idea", ideaInput: t }, 0)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "precondition_failed")).toHaveLength(2);
    expect((await getIdea(ME.id, projectId))!.rev).toBe(1);
  });

  it("concurrent saves without If-Match all apply, one after another (last write wins)", async () => {
    const results = await Promise.all(["A", "B", "C"].map((t) => saveIdea(ME.id, projectId, { mode: "idea", ideaInput: t })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect((await getIdea(ME.id, projectId))!.rev).toBe(3);
  });
});
