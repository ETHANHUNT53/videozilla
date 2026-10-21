import { ObjectId } from "mongodb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/mongo", async () => (await import("../../../test/mongo")).mongoModule);
const sessionUser = vi.hoisted(() => vi.fn());
vi.mock("../api/session", () => ({ sessionUser }));
const send = vi.hoisted(() => vi.fn());
vi.mock("../jobs/inngest", () => ({ inngest: { send, createFunction: (config: unknown, fn: unknown) => ({ config, fn }) } }));

import * as generate from "@/app/api/v1/projects/[id]/storyboard/generate/route";
import * as current from "@/app/api/v1/projects/[id]/storyboard/route";
import * as statusRoute from "@/app/api/v1/projects/[id]/status/route";
import { resetModelCooldowns } from "@videozilla/ai";
import { WORD_BUDGET } from "@videozilla/schema";
import { clearCollections, startTestMongo, stopTestMongo, testMongo } from "../../../test/mongo";
import { dispatchStoryboardRun, generateStoryboard, runStoryboardJob } from "../jobs/storyboard";
import { getOrCreateProfile, updateProfile } from "./profiles";
import { createProject, deleteProject, duplicateProject, purgeExpiredProjects } from "./projects";
import { failRun, getRun, KEEP_VERSIONS, saveStoryboardVersion, STALE_RUN_MS, startStoryboardRun, type PipelineRunDoc } from "./storyboards";
import { resetLimitsCache } from "./usage";

/**
 * F3.1 + F3.2: generate the storyboard (route, job, versions) against a throwaway MongoDB. The AI is the mock provider
 * (AI_PROVIDER=mock, no network) or the mocked Gemini SDK; never a real key.
 */

const generateContent = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

const APP = "http://localhost:3000";
const ME = { id: new ObjectId().toHexString(), name: "Me", email: "me@example.com", emailVerified: true, image: null, createdAt: new Date() };
const BRIEF = { title: "Why the sky is blue", hook: "Why is the sky blue and not white?", angle: "Light scattering, simply.", audience: "students", keyPoints: ["Sunlight has every colour", "Air scatters blue the most", "Sunsets are red"], outOfScope: ["Rayleigh formula"] };

let projectId: string;
const oid = () => new ObjectId(projectId);
const projectDoc = () => testMongo.db.collection("projects").findOne({ _id: oid() });
const runsOf = () => testMongo.db.collection<PipelineRunDoc>("pipeline_runs").find({ projectId: oid() }).sort({ createdAt: 1 }).toArray();
const versionsOf = () => testMongo.db.collection("storyboard_versions").find({ projectId: oid() }).sort({ version: 1 }).toArray();
const used = async () => (await testMongo.db.collection("usage_counters").findOne({ userId: ME.id }))?.storyboards ?? 0;
const setBrief = (brief: Record<string, unknown> | null, extra: Record<string, unknown> = {}) =>
  testMongo.db.collection("idea_sessions").updateOne({ projectId: oid() }, { $set: { brief, ...extra } });

beforeAll(startTestMongo, 120_000);
afterAll(stopTestMongo);
beforeEach(async () => {
  await clearCollections(["projects", "idea_sessions", "profiles", "usage_counters", "ai_calls", "config", "pipeline_runs", "storyboard_versions"]);
  resetLimitsCache();
  resetModelCooldowns();
  const profile = await getOrCreateProfile(ME.id, ME.name);
  await updateProfile(ME.id, { about: "Physics for Class 8" });
  projectId = (await createProject(ME.id, profile, { title: "Sky" }))._id.toHexString();
  await setBrief(BRIEF);
  vi.stubEnv("BETTER_AUTH_URL", APP);
  vi.stubEnv("AI_PROVIDER", "mock");
  sessionUser.mockResolvedValue(ME);
  send.mockReset();
  send.mockResolvedValue({ ids: ["evt"] });
  generateContent.mockReset();
});

async function post(body: unknown = {}, id = projectId) {
  const res = await generate.POST(
    new Request(`${APP}/api/v1/projects/${id}/storyboard/generate`, { method: "POST", headers: { origin: APP, "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, json: await res.json().catch(() => null), headers: res.headers };
}
async function get(mod: { GET: typeof statusRoute.GET }, suffix: string, id = projectId) {
  const res = await mod.GET(new Request(`${APP}/api/v1/projects/${id}${suffix}`), { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
/** Starts a generation through the API and runs its job to the end (what Inngest or the inline fallback would do). */
async function generateAndRun(body: unknown = {}) {
  const res = await post(body);
  expect(res.status).toBe(202);
  const outcome = await runStoryboardJob(res.json.run.id);
  return { res, outcome };
}

describe("POST …/storyboard/generate", () => {
  it("202: counts one storyboard, moves the video to storyboard_generating, creates a queued run and sends the event", async () => {
    const res = await post();
    expect(res.status).toBe(202);
    expect(res.headers.get("location")).toBe(`/api/v1/projects/${projectId}/status`);
    expect(res.json.project).toMatchObject({ id: projectId, status: "storyboard_generating", allowedActions: ["rename", "delete", "duplicate"] });
    expect(res.json.run).toMatchObject({ kind: "storyboard", status: "queued", active: true, progress: 0 });
    expect(res.json.run.steps.map((s: { name: string; status: string }) => [s.name, s.status])).toEqual([
      ["load_context", "pending"],
      ["write_script", "pending"],
      ["check", "pending"],
      ["save_version", "pending"],
    ]);
    expect(await used()).toBe(1);
    const [run] = await runsOf();
    expect(run.idempotencyKey).toBe(`${projectId}:storyboard:${run._id.toHexString()}`);
    expect(run.outbox.sentAt).toBeInstanceOf(Date);
    expect(send).toHaveBeenCalledWith({ id: run.idempotencyKey, name: "storyboard/requested", data: { runId: run._id.toHexString(), projectId } });
  });

  it("a second click while it runs gets the same run back, nothing counted twice", async () => {
    const first = await post();
    const second = await post();
    expect(second.status).toBe(202);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    expect(second.json.run.id).toBe(first.json.run.id);
    expect(await used()).toBe(1);
    expect(await runsOf()).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("422 without a brief; 409 in another status, and from storyboard_ready without regenerate; nothing counted", async () => {
    await setBrief(null);
    expect((await post()).json.error).toMatchObject({ code: "VALIDATION_FAILED", details: [{ field: "brief" }] });
    await setBrief(BRIEF);
    await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { status: "building" } });
    expect((await post()).status).toBe(409);
    await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { status: "storyboard_ready", currentStoryboardVersion: 1 } });
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.json.error.details[0].field).toBe("regenerate");
    expect(await used()).toBe(0);
    expect(await runsOf()).toHaveLength(0);
  });

  it("400 for unknown body fields or regenerate: false; 404 for an unknown or deleted video", async () => {
    expect((await post({ regenerate: false })).status).toBe(400);
    expect((await post({ userId: "x" })).status).toBe(400);
    expect((await post({}, new ObjectId().toHexString())).status).toBe(404);
    await deleteProject(ME.id, projectId);
    expect((await post()).status).toBe(404);
  });

  it("429 at the daily limit of 20, with nothing changed", async () => {
    await testMongo.db.collection("usage_counters").insertOne({ userId: ME.id, date: new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10), storyboards: 20 });
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.json.error).toMatchObject({ code: "LIMIT_REACHED", details: [{ counter: "storyboards", limit: 20 }] });
    expect((await projectDoc())!.status).toBe("idea_draft");
    expect(await runsOf()).toHaveLength(0);
  });
});

describe("the storyboard.generate job (mock AI)", () => {
  it("writes, checks and saves version 1: the video is storyboard_ready, the run succeeded, the call is logged", async () => {
    const { res, outcome } = await generateAndRun();
    expect(outcome).toBe("saved");
    const project = await projectDoc();
    expect(project).toMatchObject({ status: "storyboard_ready", currentStoryboardVersion: 1 });
    const [version] = await versionsOf();
    expect(version).toMatchObject({ version: 1, schemaVersion: 1, source: "generate", basedOnVersion: null, changeSummary: "First storyboard", provider: "mock", model: "mock" });
    expect(version.changedSceneIds).toEqual(version.data.scenes.map((s: { id: string }) => s.id));
    expect(version.data.scenes).toHaveLength(8);
    expect(version.validationReport.wordCount).toBeGreaterThanOrEqual(WORD_BUDGET.en[60][0]);
    const [run] = await runsOf();
    expect(run).toMatchObject({ status: "succeeded", active: false, progress: 100 });
    expect(run.steps.every((s) => s.status === "succeeded" && s.attempt === 1)).toBe(true);
    expect(await used()).toBe(1);
    const logs = await testMongo.db.collection("ai_calls").find({ userId: ME.id }).toArray();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ task: "storyboard", provider: "mock", status: "ok", projectId: oid(), runId: new ObjectId(res.json.run.id) });
  });

  it("the saved storyboard is theme-neutral: every scene has a beat (mood, chapters on body scenes, a diagram), no theme hints", async () => {
    await generateAndRun();
    const [version] = await versionsOf();
    const scenes = version.data.scenes as { role: string; beat: { mood: string; chapter?: { index: number }; diagram?: unknown }; themeHints?: unknown }[];
    expect(scenes.every((s) => typeof s.beat.mood === "string")).toBe(true);
    expect(scenes.filter((s) => s.role === "explain" || s.role === "example").every((s) => s.beat.chapter)).toBe(true);
    expect(scenes[0].beat.chapter).toBeUndefined();
    expect(new Set(scenes.map((s) => s.beat.chapter?.index).filter(Boolean))).toEqual(new Set([1, 2, 3]));
    expect(scenes.some((s) => s.beat.diagram)).toBe(true);
    expect(scenes.some((s) => s.themeHints)).toBe(false);
  });

  it("GET …/storyboard returns the current version; GET …/status shows it finished and stops polling", async () => {
    expect((await get(current, "/storyboard")).status).toBe(404);
    const { res } = await generateAndRun();
    const sb = await get(current, "/storyboard");
    expect(sb.status).toBe(200);
    expect(sb.json).toMatchObject({ version: 1, source: "generate", isCurrent: true, accuracyFlags: [], storyboard: { language: "en", targetDurationSec: 60 } });
    expect(sb.json.wordCount).toBeGreaterThan(0);
    const st = await get(statusRoute, "/status");
    expect(st.json).toMatchObject({ project: { id: projectId, status: "storyboard_ready", currentStoryboardVersion: 1 }, activeRuns: [], pollAfterMs: null, renderQueue: null });
    expect(st.json.lastRuns[0]).toMatchObject({ id: res.json.run.id, status: "succeeded", progress: 100 });
  });

  it("GET …/status polls every 2 s while the run is active", async () => {
    await post();
    const st = await get(statusRoute, "/status");
    expect(st.json.pollAfterMs).toBe(2000);
    expect(st.json.activeRuns).toHaveLength(1);
    expect(st.json.project.status).toBe("storyboard_generating");
  });

  it("uses the video's settings: a Hindi 90 s video gets a Hindi storyboard in the 90 s budget", async () => {
    await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { language: "hi", lengthPreset: 90 } });
    await generateAndRun();
    const [version] = await versionsOf();
    expect(version.data).toMatchObject({ language: "hi", targetDurationSec: 90 });
    expect(version.data.scenes).toHaveLength(11);
  });

  it("regenerate: version 2 based on version 1; the brief is untouched", async () => {
    await generateAndRun();
    const ideaBefore = await testMongo.db.collection("idea_sessions").findOne({ projectId: oid() });
    const { outcome } = await generateAndRun({ regenerate: true });
    expect(outcome).toBe("saved");
    const versions = await versionsOf();
    expect(versions.map((v) => [v.version, v.basedOnVersion, v.changeSummary])).toEqual([
      [1, null, "First storyboard"],
      [2, 1, "Regenerated from the brief"],
    ]);
    expect((await projectDoc())!.currentStoryboardVersion).toBe(2);
    expect(await used()).toBe(2);
    expect(await testMongo.db.collection("idea_sessions").findOne({ projectId: oid() })).toEqual(ideaBefore);
  });

  it("a too-long first script gets one length fix (logged as length_fix), and the fitting one is saved", async () => {
    await setBrief({ ...BRIEF, title: "Sky [mock:long]" });
    await generateAndRun();
    const [version] = await versionsOf();
    expect(version.validationReport.lengthFixed).toBe(true);
    expect(version.validationReport.wordCount).toBeLessThanOrEqual(WORD_BUDGET.en[60][1]);
    const tasks = (await testMongo.db.collection("ai_calls").find({ userId: ME.id }).toArray()).map((l) => l.task);
    expect(tasks.sort()).toEqual(["length_fix", "storyboard"]);
    expect(await used()).toBe(1); // the length fix doesn't count extra
  });

  it("AI busy: the run fails with AI_BUSY, the unit is given back, the video goes back to idea_draft", async () => {
    await setBrief({ ...BRIEF, title: "Sky [mock:busy]" });
    const { outcome } = await generateAndRun();
    expect(outcome).toBe("failed");
    const [run] = await runsOf();
    expect(run).toMatchObject({ status: "failed", active: false, error: { code: "AI_BUSY", retryable: true, step: "write_script" } });
    expect(run.steps.find((s) => s.name === "write_script")!.status).toBe("failed");
    expect((await projectDoc())!.status).toBe("idea_draft");
    expect((await projectDoc())!.attention ?? null).toBeNull();
    expect(await used()).toBe(0);
    expect(await versionsOf()).toHaveLength(0);
    const st = await get(statusRoute, "/status");
    expect(st.json.lastRuns[0].error).toMatchObject({ code: "AI_BUSY", message: "The AI is busy right now. Try again in a minute." });
  });

  it("a refusal fails the run with UNSAFE_CONTENT and still counts (like the idea AI)", async () => {
    await setBrief({ ...BRIEF, hook: "[mock:refuse]" });
    await generateAndRun();
    expect((await runsOf())[0].error).toMatchObject({ code: "UNSAFE_CONTENT" });
    expect(await used()).toBe(1);
    expect((await projectDoc())!.status).toBe("idea_draft");
  });

  it("an unusable reply from every model: AI_OUTPUT_INVALID, refunded", async () => {
    vi.stubEnv("AI_PROVIDER", "gemini");
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GEMINI_FAST_MODEL", "");
    vi.stubEnv("GEMINI_FALLBACK_MODEL", "");
    generateContent.mockResolvedValue({ text: JSON.stringify({ title: "T", hook: "H", social: { caption: "", hashtags: [], coverText: "" }, scenes: [] }) });
    await generateAndRun();
    expect((await runsOf())[0].error).toMatchObject({ code: "AI_OUTPUT_INVALID" });
    expect(await used()).toBe(0);
  });

  it("a failed regenerate keeps version 1 current and the video storyboard_ready", async () => {
    await generateAndRun();
    await setBrief({ ...BRIEF, title: "Sky [mock:busy]" });
    await generateAndRun({ regenerate: true });
    expect(await projectDoc()).toMatchObject({ status: "storyboard_ready", currentStoryboardVersion: 1 });
    expect(await versionsOf()).toHaveLength(1);
    expect(await used()).toBe(1);
  });

  it("the video deleted while the job runs: nothing is saved, the unit is given back once", async () => {
    const res = await post();
    await deleteProject(ME.id, projectId);
    expect(await runStoryboardJob(res.json.run.id)).toBe("cancelled");
    expect(await runStoryboardJob(res.json.run.id)).toBe("cancelled");
    expect(await versionsOf()).toHaveLength(0);
    expect(await used()).toBe(0);
  });

  it("the Inngest function runs every step through step.run, and its failure handler fails the run", async () => {
    const res = await post();
    const fn = generateStoryboard as unknown as { config: { onFailure: (a: unknown) => Promise<void>; concurrency: unknown }; fn: (a: unknown) => Promise<{ outcome: string }> };
    expect(fn.config.concurrency).toEqual({ key: "event.data.projectId", limit: 1 });
    const names: string[] = [];
    const step = { run: (name: string, f: () => Promise<unknown>) => (names.push(name), f()) };
    expect(await fn.fn({ event: { data: { runId: res.json.run.id } }, step })).toMatchObject({ outcome: "saved" });
    expect(names).toEqual(["load_context", "write_script", "check", "save_version"]);

    const again = await post({ regenerate: true });
    await fn.config.onFailure({ event: { data: { event: { data: { runId: again.json.run.id } } } }, error: new Error("x") });
    expect((await getRun(again.json.run.id))!.error).toMatchObject({ code: "INTERNAL" });
    expect((await projectDoc())!.status).toBe("storyboard_ready");
  });
});

describe("dispatch without a job runner", () => {
  it("development: runs the job in this process after the response", async () => {
    send.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:8288"));
    const { run } = await startStoryboardRun(ME.id, projectId, { regenerate: false });
    let scheduled: (() => Promise<unknown>) | undefined;
    expect(await dispatchStoryboardRun(run, { schedule: (fn) => (scheduled = fn) })).toBe("inline");
    await scheduled!();
    expect((await projectDoc())!.status).toBe("storyboard_ready");
  });

  it("production: fails the run at once (JOB_NOT_STARTED), refunded, the video moved back; the route answers with that", async () => {
    send.mockRejectedValue(new Error("no event key"));
    vi.stubEnv("NODE_ENV", "production");
    const res = await post();
    expect(res.status).toBe(202);
    expect(res.json.project.status).toBe("idea_draft");
    expect((await runsOf())[0].error).toMatchObject({ code: "JOB_NOT_STARTED" });
    expect(await used()).toBe(0);
  });
});

describe("runs and versions", () => {
  it("a run stuck for 5 minutes is failed (JOB_STOPPED) when the status is read; refunded, video back", async () => {
    await post();
    await testMongo.db.collection("pipeline_runs").updateMany({}, { $set: { updatedAt: new Date(Date.now() - STALE_RUN_MS - 1000) } });
    const st = await get(statusRoute, "/status");
    expect(st.json.project.status).toBe("idea_draft");
    expect(st.json.activeRuns).toEqual([]);
    expect(st.json.lastRuns[0].error.code).toBe("JOB_STOPPED");
    expect(await used()).toBe(0);
  });

  it("failRun only acts once", async () => {
    const res = await post();
    const id = new ObjectId(res.json.run.id);
    expect(await failRun(id, "AI_BUSY")).toBe(true);
    expect(await failRun(id, "AI_BUSY")).toBe(false);
    expect(await used()).toBe(0);
  });

  it(`keeps the newest ${KEEP_VERSIONS} versions`, async () => {
    await testMongo.db.collection("storyboard_versions").insertMany(
      Array.from({ length: KEEP_VERSIONS }, (_, i) => ({
        projectId: oid(), userId: ME.id, version: i + 1, schemaVersion: 1, data: {}, source: "generate", basedOnVersion: null,
        changeSummary: "x", changedSceneIds: [], validationReport: {}, createdAt: new Date(),
      })),
    );
    await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { status: "storyboard_ready", currentStoryboardVersion: KEEP_VERSIONS } });
    await generateAndRun({ regenerate: true });
    const versions = await versionsOf();
    expect(versions).toHaveLength(KEEP_VERSIONS);
    expect(versions[0].version).toBe(2);
    expect(versions.at(-1)!.version).toBe(KEEP_VERSIONS + 1);
  });

  it("saveStoryboardVersion saves nothing for a run that isn't active", async () => {
    const res = await post();
    const id = new ObjectId(res.json.run.id);
    await failRun(id, "AI_BUSY");
    const report = { repairs: [], warnings: [], wordCount: 1, estimatedDurationSec: 1 };
    expect(await saveStoryboardVersion(id, { scenes: [] } as never, report, { model: null, provider: null })).toBe("cancelled");
    expect(await versionsOf()).toHaveLength(0);
  });

  it("duplicating a video copies its current storyboard as version 1 (storyboard_ready)", async () => {
    await generateAndRun();
    await generateAndRun({ regenerate: true });
    const copy = await duplicateProject(ME.id, projectId);
    expect(copy).toMatchObject({ status: "storyboard_ready", currentStoryboardVersion: 1 });
    const copied = await testMongo.db.collection("storyboard_versions").find({ projectId: copy!._id }).toArray();
    expect(copied).toHaveLength(1);
    expect(copied[0]).toMatchObject({ version: 1, source: "duplicate", basedOnVersion: null });
    const [, v2] = await versionsOf();
    expect(copied[0].data).toEqual(v2.data);
  });

  it("purging a deleted video removes its storyboard versions and runs", async () => {
    await generateAndRun();
    await deleteProject(ME.id, projectId);
    await testMongo.db.collection("projects").updateOne({ _id: oid() }, { $set: { purgeAt: new Date(Date.now() - 1000) } });
    expect(await purgeExpiredProjects()).toBe(1);
    expect(await versionsOf()).toHaveLength(0);
    expect(await runsOf()).toHaveLength(0);
  });
});
