import "server-only";
import type { Social, Storyboard } from "@videozilla/schema";
import { applySceneOp, measureStoryboard, type SceneOp } from "@videozilla/pipeline";
import type { ValidationReport } from "@videozilla/pipeline";
import { MongoServerError, ObjectId, type ClientSession, type Collection } from "mongodb";
import { ApiError } from "../api/errors";
import { collections, ensureMigrated, withTransaction } from "../db/mongo";
import type { IdeaSessionDoc, ProjectDoc, ProjectStatus } from "../db/types";
import { isAllowed } from "../rules/project-actions";
import { consumeUsage, refundUsage, type UsageResult } from "./usage";

/**
 * Storyboard generation runs and versions (F3.1 + F3.2; DB Design §4.6, §4.14, §5.1, §6.2, §6.3, §7.2, §7.6). Every
 * function that takes a user id adds it to its filters, like the other repositories. The job's functions (by run id)
 * run on the server only, after a user started the run. See docs/features/F3.1-generate-storyboard.md.
 */

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type StepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

/** The job's steps, with their user-facing labels (PRD §16.5). */
export const STORYBOARD_STEPS = [
  { name: "load_context", label: "Reading your brief…" },
  { name: "write_script", label: "Writing your script and planning scenes…" },
  { name: "check", label: "Checking scenes, sync and length…" },
  { name: "save_version", label: "Saving your storyboard…" },
] as const;
export type StoryboardStep = (typeof STORYBOARD_STEPS)[number]["name"];
/** Shown on the check step while the one length fix runs. */
export const LENGTH_FIX_LABEL = "Adjusting the length…";

/** Rough share of the run's time each step takes (for `progress`). */
const STEP_WEIGHT: Record<StoryboardStep, number> = { load_context: 5, write_script: 70, check: 20, save_version: 5 };

/** Why a run failed; what the page shows. */
export const RUN_ERROR_TEXT = {
  AI_BUSY: "The AI is busy right now. Try again in a minute.",
  AI_UNAVAILABLE: "AI features are unavailable right now. Please try again later.",
  AI_OUTPUT_INVALID: "The AI couldn't write a usable storyboard this time. Try again.",
  UNSAFE_CONTENT: "We can't make a storyboard about this brief. Try changing the brief.",
  JOB_NOT_STARTED: "The storyboard couldn't be started. Try again.",
  JOB_STOPPED: "The storyboard stopped before it finished. Try again.",
  INTERNAL: "Something went wrong on our side. Try again.",
} as const;
export type RunErrorCode = keyof typeof RUN_ERROR_TEXT;

/** A run stuck this long without any progress is failed when someone looks at it (no watchdog until F10). */
export const STALE_RUN_MS = 5 * 60_000;
/** Versions kept per project (DB Design §4.6); older ones are pruned, never the current one. */
export const KEEP_VERSIONS = 30;

export interface RunStepDoc {
  name: StoryboardStep;
  label: string;
  status: StepStatus;
  attempt: number;
  startedAt?: Date;
  finishedAt?: Date;
  detail?: string;
}

/** A pipeline run (DB Design §4.14), as the storyboard job writes it. */
export interface PipelineRunDoc {
  _id: ObjectId;
  projectId: ObjectId;
  userId: string;
  kind: "storyboard";
  status: RunStatus;
  active: boolean;
  trigger: { by: "user"; storyboardVersion: number | null; regenerate: boolean };
  idempotencyKey: string;
  steps: RunStepDoc[];
  progress: number;
  /** The `storyboards` unit this run counted, so a failure can give it back. */
  usage: { date: string; amount: number } | null;
  outbox: { name: string; data: { runId: string }; sentAt: Date | null };
  error?: { code: RunErrorCode; message: string; retryable: boolean; step: StoryboardStep | null } | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoryboardVersionDoc {
  _id: ObjectId;
  projectId: ObjectId;
  userId: string;
  version: number;
  schemaVersion: 1;
  data: Storyboard;
  source: "generate" | "revision" | "manual_edit" | "restore" | "duplicate";
  basedOnVersion: number | null;
  changeSummary: string;
  changedSceneIds: string[];
  validationReport: ValidationReport & { lengthFixed?: boolean };
  model?: string | null;
  provider?: string | null;
  createdAt: Date;
}

const runs = () => collections.pipelineRuns() as unknown as Collection<PipelineRunDoc>;
const versions = () => collections.storyboardVersions() as unknown as Collection<StoryboardVersionDoc>;
const toObjectId = (id: string): ObjectId | null => (ObjectId.isValid(id) && id.length === 24 ? new ObjectId(id) : null);

/** The status a project goes back to when its generation doesn't finish (DB Design §5.1). */
const fallbackStatus = (p: Pick<ProjectDoc, "currentStoryboardVersion">): ProjectStatus => (p.currentStoryboardVersion ? "storyboard_ready" : "idea_draft");

export type StartResult = { run: PipelineRunDoc; project: ProjectDoc; replayed: boolean };

/**
 * Starts a generation (DB Design §6.2) in one transaction: counts one `storyboards` unit (429 at the limit, nothing
 * else written), moves the project to `storyboard_generating` (compare-and-set on the status it was read with) and
 * inserts the run with its event in the outbox. While a run is already active the same run comes back
 * (`replayed`), with nothing counted. Throws ApiError for 404 / 409 / 422 / 429.
 */
export async function startStoryboardRun(userId: string, projectId: string, opts: { regenerate: boolean }): Promise<StartResult> {
  await ensureMigrated();
  const _id = toObjectId(projectId);
  if (!_id) throw new ApiError("NOT_FOUND");
  return withTransaction(async (session) => {
    const project = await collections.projects().findOne({ _id, userId, deletedAt: null }, { session });
    if (!project) throw new ApiError("NOT_FOUND");
    if (project.status === "storyboard_generating") {
      const active = await runs().findOne({ projectId: _id, userId, kind: "storyboard", active: true }, { session });
      if (active) return { run: active, project, replayed: true };
    }
    if (!isAllowed(project.status, "generate")) {
      throw new ApiError("INVALID_STATE", {
        message: "A storyboard can't be made at this stage of the video.",
        details: [{ field: "status", issue: `can't generate while the video is '${project.status}'`, current: project.status }],
      });
    }
    if (project.status === "storyboard_ready" && !opts.regenerate) {
      throw new ApiError("INVALID_STATE", {
        message: "This video already has a storyboard. Choose Regenerate to make a new version.",
        details: [{ field: "regenerate", issue: "must be true to replace the current storyboard", current: project.status }],
      });
    }
    const idea = await collections.ideaSessions().findOne({ projectId: _id, userId }, { session, projection: { brief: 1 } });
    if (!idea?.brief) throw new ApiError("VALIDATION_FAILED", { message: "Make a brief first.", details: [{ field: "brief", issue: "there's no brief yet" }] });

    const usage = await consumeUsage(userId, "storyboards", { session });
    const now = new Date();
    const moved = await collections.projects().findOneAndUpdate(
      { _id, userId, deletedAt: null, status: project.status, rev: project.rev },
      { $set: { status: "storyboard_generating", statusChangedAt: now, updatedAt: now, attention: null }, $inc: { rev: 1 } },
      { session, returnDocument: "after" },
    );
    // Changed by another request since it was read: the transaction retries as a whole, so this is a real conflict.
    if (!moved) throw new ApiError("INVALID_STATE", { message: "The video changed meanwhile. Reload and try again." });

    const runId = new ObjectId();
    const key = `${projectId}:storyboard:${runId.toHexString()}`;
    const run: PipelineRunDoc = {
      _id: runId,
      projectId: _id,
      userId,
      kind: "storyboard",
      status: "queued",
      active: true,
      trigger: { by: "user", storyboardVersion: project.currentStoryboardVersion ?? null, regenerate: opts.regenerate },
      idempotencyKey: key,
      steps: STORYBOARD_STEPS.map((s) => ({ name: s.name, label: s.label, status: "pending", attempt: 0 })),
      progress: 0,
      usage: usage.date && usage.amount ? { date: usage.date, amount: usage.amount } : null,
      outbox: { name: "storyboard/requested", data: { runId: runId.toHexString() }, sentAt: null },
      error: null,
      startedAt: null,
      finishedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await runs().insertOne(run, { session });
    } catch (err) {
      // The partial unique index (one active run per project and kind) — only reachable if data was edited by hand.
      if (err instanceof MongoServerError && err.code === 11000) throw new ApiError("RUN_IN_PROGRESS");
      throw err;
    }
    return { run, project: moved, replayed: false };
  });
}

/** The event was handed to the job runner (DB Design §7.6). */
export async function markOutboxSent(runId: ObjectId): Promise<void> {
  await runs().updateOne({ _id: runId }, { $set: { "outbox.sentAt": new Date() } });
}

export async function getRun(runId: string): Promise<PipelineRunDoc | null> {
  const _id = toObjectId(runId);
  return _id ? runs().findOne({ _id }) : null;
}

function progressAfter(done: StoryboardStep[]): number {
  return Math.min(99, done.reduce((n, s) => n + STEP_WEIGHT[s], 0));
}

/**
 * A step starts. Only while the run is active (a deleted video cancelled it): false means stop. The run becomes
 * `running` at its first step.
 */
export async function stepStarted(runId: ObjectId, name: StoryboardStep, label?: string): Promise<boolean> {
  const now = new Date();
  const res = await runs().updateOne(
    { _id: runId, active: true },
    {
      $set: { status: "running", updatedAt: now, "steps.$[s].status": "running", "steps.$[s].startedAt": now, ...(label ? { "steps.$[s].label": label } : {}) },
      $inc: { "steps.$[s].attempt": 1 },
      $min: { startedAt: now },
    },
    { arrayFilters: [{ "s.name": name }] },
  );
  return res.matchedCount > 0;
}

/** A step finished; the run's progress moves on. */
export async function stepFinished(runId: ObjectId, name: StoryboardStep, detail?: string): Promise<boolean> {
  const run = await runs().findOne({ _id: runId, active: true }, { projection: { steps: 1 } });
  if (!run) return false;
  const done = [...run.steps.filter((s) => s.status === "succeeded").map((s) => s.name), name];
  const now = new Date();
  const res = await runs().updateOne(
    { _id: runId, active: true },
    {
      $set: {
        updatedAt: now,
        progress: progressAfter(done),
        "steps.$[s].status": "succeeded",
        "steps.$[s].finishedAt": now,
        ...(detail ? { "steps.$[s].detail": detail.slice(0, 300) } : {}),
      },
    },
    { arrayFilters: [{ "s.name": name }] },
  );
  return res.matchedCount > 0;
}

/** Changes what a running step says (the check step while the length fix runs). */
export async function setStepLabel(runId: ObjectId, name: StoryboardStep, label: string): Promise<void> {
  await runs().updateOne({ _id: runId, active: true }, { $set: { updatedAt: new Date(), "steps.$[s].label": label } }, { arrayFilters: [{ "s.name": name }] });
}

/** Gives a cancelled run's unit back, once (the video was deleted while it ran). */
export async function refundCancelledRun(runId: ObjectId): Promise<void> {
  const run = await runs().findOneAndUpdate({ _id: runId, status: "cancelled", usage: { $ne: null } }, { $set: { usage: null } });
  const usage = run && usageOf(run);
  if (usage) await refundUsage(run.userId, usage);
}

function usageOf(run: PipelineRunDoc): UsageResult | null {
  return run.usage ? { counter: "storyboards", used: 0, limit: null, resetsAt: new Date(), date: run.usage.date, amount: run.usage.amount } : null;
}

/**
 * Fails an active run and moves its project back to where it was (`idea_draft`, or `storyboard_ready` with the earlier
 * version kept), in one transaction; then gives the unit back unless `refund` is false (a refusal counts, like the idea
 * AI). Does nothing (false) when the run already finished or was cancelled.
 */
export async function failRun(runId: ObjectId, code: RunErrorCode, opts: { refund?: boolean; step?: StoryboardStep | null; message?: string } = {}): Promise<boolean> {
  const failed = await withTransaction(async (session) => {
    const run = await runs().findOne({ _id: runId, active: true }, { session });
    if (!run) return null;
    const now = new Date();
    const step = opts.step ?? run.steps.find((s) => s.status === "running")?.name ?? null;
    await runs().updateOne(
      { _id: runId, active: true },
      {
        $set: {
          status: "failed",
          active: false,
          finishedAt: now,
          updatedAt: now,
          error: { code, message: opts.message ?? RUN_ERROR_TEXT[code], retryable: true, step },
          ...(step ? { "steps.$[s].status": "failed", "steps.$[s].finishedAt": now } : {}),
        },
      },
      { session, ...(step ? { arrayFilters: [{ "s.name": step }] } : {}) },
    );
    await moveBack(run, session, now);
    return run;
  });
  if (!failed) return false;
  if (opts.refund !== false) {
    const usage = usageOf(failed);
    if (usage) await refundUsage(failed.userId, usage);
  }
  return true;
}

/** The run's project, if it's still generating, goes back to its stable status. */
async function moveBack(run: PipelineRunDoc, session: ClientSession, now: Date): Promise<void> {
  const project = await collections.projects().findOne({ _id: run.projectId, userId: run.userId, status: "storyboard_generating" }, { session });
  if (!project) return;
  await collections.projects().updateOne(
    { _id: project._id, userId: run.userId, status: "storyboard_generating" },
    { $set: { status: fallbackStatus(project), statusChangedAt: now, updatedAt: now }, $inc: { rev: 1 } },
    { session },
  );
}

export type SaveResult = { version: StoryboardVersionDoc; project: ProjectDoc } | "cancelled";

/**
 * Saves the storyboard as the project's next version (DB Design §6.3), in one transaction: the version, the project
 * (`currentStoryboardVersion`, `storyboard_ready`, compare-and-set on `storyboard_generating`) and the run
 * (`succeeded`). A run that is no longer active, or a project that moved on (deleted), saves nothing: "cancelled".
 * Versions beyond the newest 30 are pruned.
 */
export async function saveStoryboardVersion(
  runId: ObjectId,
  storyboard: Storyboard,
  report: StoryboardVersionDoc["validationReport"],
  ai: { model: string | null; provider: string | null },
): Promise<SaveResult> {
  return withTransaction(async (session): Promise<SaveResult> => {
    const run = await runs().findOne({ _id: runId, active: true }, { session });
    if (!run) return "cancelled";
    const project = await collections.projects().findOne({ _id: run.projectId, userId: run.userId, deletedAt: null, status: "storyboard_generating" }, { session });
    if (!project) return "cancelled";
    const now = new Date();
    const latest = await versions().findOne({ projectId: project._id, userId: run.userId }, { session, sort: { version: -1 }, projection: { version: 1 } });
    const number = Math.max(project.currentStoryboardVersion ?? 0, latest?.version ?? 0) + 1;
    const version: StoryboardVersionDoc = {
      _id: new ObjectId(),
      projectId: project._id,
      userId: run.userId,
      version: number,
      schemaVersion: 1,
      data: storyboard,
      source: "generate",
      basedOnVersion: project.currentStoryboardVersion ?? null,
      changeSummary: project.currentStoryboardVersion ? "Regenerated from the brief" : "First storyboard",
      changedSceneIds: storyboard.scenes.map((s) => s.id),
      validationReport: report,
      model: ai.model,
      provider: ai.provider,
      createdAt: now,
    };
    await versions().insertOne(version, { session });
    const saved = await collections.projects().findOneAndUpdate(
      { _id: project._id, userId: run.userId, status: "storyboard_generating", deletedAt: null },
      { $set: { status: "storyboard_ready", statusChangedAt: now, updatedAt: now, currentStoryboardVersion: number }, $inc: { rev: 1 } },
      { session, returnDocument: "after" },
    );
    if (!saved) throw new Error("project changed during the save");
    await runs().updateOne(
      { _id: runId, active: true },
      {
        $set: { status: "succeeded", active: false, progress: 100, finishedAt: now, updatedAt: now, "steps.$[s].status": "succeeded", "steps.$[s].finishedAt": now },
      },
      { session, arrayFilters: [{ "s.name": "save_version" }] },
    );
    // Keep the newest versions (the current one is always among them: it was just made).
    await pruneVersions(session, project._id, run.userId, number);
    return { version, project: saved };
  });
}

/**
 * Fails the project's storyboard runs that stopped moving (the job died with the server, an event was never picked
 * up), so a video can't stay "generating" forever. Called when the status is read.
 */
export async function recoverStaleRuns(userId: string, projectId: ObjectId, now = Date.now()): Promise<number> {
  const stale = await runs()
    .find({ projectId, userId, kind: "storyboard", active: true, updatedAt: { $lt: new Date(now - STALE_RUN_MS) } }, { projection: { _id: 1 } })
    .toArray();
  let n = 0;
  for (const r of stale) if (await failRun(r._id, "JOB_STOPPED")) n++;
  return n;
}

/** Everything `GET …/status` needs: the project, its active runs and its last 5 runs (newest first). */
export async function getStatus(userId: string, projectId: string): Promise<{ project: ProjectDoc; active: PipelineRunDoc[]; last: PipelineRunDoc[] } | null> {
  await ensureMigrated();
  const _id = toObjectId(projectId);
  if (!_id) return null;
  const exists = await collections.projects().countDocuments({ _id, userId, deletedAt: null }, { limit: 1 });
  if (!exists) return null;
  await recoverStaleRuns(userId, _id);
  // One snapshot for the project and its runs (QA, F3.1): read separately, a save landing in between could show the
  // video still generating with no active run.
  return withTransaction(async (session) => {
    const project = await collections.projects().findOne({ _id, userId, deletedAt: null }, { session });
    if (!project) return null;
    const recent = await runs().find({ projectId: _id, userId }, { session }).sort({ createdAt: -1 }).limit(10).toArray();
    return { project, active: recent.filter((r) => r.active), last: recent.filter((r) => !r.active).slice(0, 5) };
  });
}

/** The project's current storyboard version, or null before the first one. */
export async function getCurrentStoryboard(userId: string, projectId: string): Promise<{ project: ProjectDoc; version: StoryboardVersionDoc } | null> {
  await ensureMigrated();
  const _id = toObjectId(projectId);
  if (!_id) return null;
  const project = await collections.projects().findOne({ _id, userId, deletedAt: null });
  if (!project?.currentStoryboardVersion) return null;
  const version = await versions().findOne({ projectId: _id, userId, version: project.currentStoryboardVersion });
  return version ? { project, version } : null;
}

/** What the job needs to write the storyboard: the project, its brief and the creator's "what I teach". */
export async function loadRunContext(run: PipelineRunDoc): Promise<{ project: ProjectDoc; idea: IdeaSessionDoc; about: string | null } | null> {
  const project = await collections.projects().findOne({ _id: run.projectId, userId: run.userId, deletedAt: null, status: "storyboard_generating" });
  if (!project) return null;
  const idea = await collections.ideaSessions().findOne({ projectId: run.projectId, userId: run.userId });
  if (!idea?.brief) return null;
  const profile = await collections.profiles().findOne({ userId: run.userId }, { projection: { about: 1 } });
  return { project, idea, about: profile?.about ?? null };
}

export type SocialEditResult =
  | { version: StoryboardVersionDoc; project: ProjectDoc; created: boolean }
  | "not_found"
  | "invalid_state"
  | { conflict: StoryboardVersionDoc | null };

/**
 * Saves an edited caption / hashtags / cover text as the next storyboard version (F3.4, DB §6.3), in one transaction:
 * the current storyboard with only `social` changed (`source: manual_edit`, no scene changed), and the project's
 * `currentStoryboardVersion`. Only on the version the edit was made on (`basedOn`, the page's If-Match): otherwise the
 * current version comes back as a conflict. Nothing changed → the current version, no new one. `build` turns the
 * saved social into the edited one (and checks the rules, schema `socialProblems`; it may throw).
 */
export async function saveSocialEdit(
  userId: string,
  projectId: string,
  basedOn: number,
  build: (current: Social) => { social: Social; summary: string },
): Promise<SocialEditResult> {
  await ensureMigrated();
  const _id = toObjectId(projectId);
  if (!_id) return "not_found";
  return withTransaction(async (session): Promise<SocialEditResult> => {
    const project = await collections.projects().findOne({ _id, userId, deletedAt: null }, { session });
    if (!project) return "not_found";
    if (project.status !== "storyboard_ready" || !project.currentStoryboardVersion) return "invalid_state";
    const current = await versions().findOne({ projectId: _id, userId, version: project.currentStoryboardVersion }, { session });
    if (project.currentStoryboardVersion !== basedOn || !current) return { conflict: current };
    const before = current.data.social;
    const { social, summary } = build(before);
    if (before.caption === social.caption && before.coverText === social.coverText && before.hashtags.join(" ") === social.hashtags.join(" ")) {
      return { version: current, project, created: false };
    }
    const now = new Date();
    const latest = await versions().findOne({ projectId: _id, userId }, { session, sort: { version: -1 }, projection: { version: 1 } });
    const number = Math.max(current.version, latest?.version ?? 0) + 1;
    const version: StoryboardVersionDoc = {
      ...current,
      _id: new ObjectId(),
      version: number,
      data: { ...current.data, social },
      source: "manual_edit",
      basedOnVersion: current.version,
      changeSummary: summary,
      changedSceneIds: [],
      createdAt: now,
    };
    delete (version as Partial<StoryboardVersionDoc> & { accuracyReport?: unknown }).accuracyReport;
    await versions().insertOne(version, { session });
    const saved = await collections.projects().findOneAndUpdate(
      { _id, userId, status: "storyboard_ready", currentStoryboardVersion: current.version },
      { $set: { currentStoryboardVersion: number, updatedAt: now }, $inc: { rev: 1 } },
      { session, returnDocument: "after" },
    );
    if (!saved) throw new Error("project changed during the save");
    await pruneVersions(session, _id, userId, number);
    return { version, project: saved, created: true };
  });
}

/**
 * Keeps the newest 30 versions (DB §4.6), never the current one: since restore moves the pointer back (F3.5), the
 * current version can be older than the 30 newest, and it must survive.
 */
async function pruneVersions(session: ClientSession, projectId: ObjectId, userId: string, current: number): Promise<void> {
  const keep = await versions().find({ projectId, userId }, { session, sort: { version: -1 }, limit: KEEP_VERSIONS, projection: { version: 1 } }).toArray();
  if (keep.length < KEEP_VERSIONS) return;
  const oldestKept = keep[keep.length - 1].version;
  await versions().deleteMany({ projectId, userId, version: { $lt: oldestKept, $ne: current } }, { session });
}

/** One row of the history (F3.5): what made it and when, without the storyboard. */
export interface VersionSummary {
  version: number;
  source: StoryboardVersionDoc["source"];
  changeSummary: string;
  createdAt: Date;
  language: Storyboard["language"];
  targetDurationSec: Storyboard["targetDurationSec"];
  sceneCount: number;
}

/** The video's versions, newest first (at most the 30 kept), and its current version number; null for 404. */
export async function listVersions(userId: string, projectId: string, limit = KEEP_VERSIONS): Promise<{ current: number | null; items: VersionSummary[] } | null> {
  await ensureMigrated();
  const _id = toObjectId(projectId);
  if (!_id) return null;
  const project = await collections.projects().findOne({ _id, userId, deletedAt: null }, { projection: { currentStoryboardVersion: 1 } });
  if (!project) return null;
  const docs = await versions()
    .aggregate<VersionSummary>([
      { $match: { projectId: _id, userId } },
      { $sort: { version: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          version: 1,
          source: 1,
          changeSummary: 1,
          createdAt: 1,
          language: "$data.language",
          targetDurationSec: "$data.targetDurationSec",
          sceneCount: { $size: { $ifNull: ["$data.scenes", []] } },
        },
      },
    ])
    .toArray();
  return { current: project.currentStoryboardVersion ?? null, items: docs };
}

/** One version of the video's storyboard (to view it before restoring), with the project; null for 404. */
export async function getVersion(userId: string, projectId: string, version: number): Promise<{ project: ProjectDoc; version: StoryboardVersionDoc } | null> {
  await ensureMigrated();
  const _id = toObjectId(projectId);
  if (!_id) return null;
  const project = await collections.projects().findOne({ _id, userId, deletedAt: null });
  if (!project) return null;
  const doc = await versions().findOne({ projectId: _id, userId, version });
  return doc ? { project, version: doc } : null;
}

export type RestoreResult =
  | { version: StoryboardVersionDoc; project: ProjectDoc }
  | "not_found"
  | "invalid_state"
  | "already_current"
  | { conflict: number | null };

/**
 * Restore (F3.5, your answer): moves the project's current-version pointer back (or forward) to `version`; nothing is
 * copied or pruned. Only on the current version the page saw (`basedOn`, If-Match). When the version was written for
 * another language or length, the project's settings follow it, so the storyboard and the settings agree.
 */
export async function restoreVersion(userId: string, projectId: string, version: number, basedOn: number): Promise<RestoreResult> {
  await ensureMigrated();
  const _id = toObjectId(projectId);
  if (!_id) return "not_found";
  return withTransaction(async (session): Promise<RestoreResult> => {
    const project = await collections.projects().findOne({ _id, userId, deletedAt: null }, { session });
    if (!project) return "not_found";
    const target = await versions().findOne({ projectId: _id, userId, version }, { session });
    if (!target) return "not_found";
    if (project.status !== "storyboard_ready" || !project.currentStoryboardVersion) return "invalid_state";
    if (project.currentStoryboardVersion !== basedOn) return { conflict: project.currentStoryboardVersion };
    if (version === project.currentStoryboardVersion) return "already_current";
    const now = new Date();
    const settings = {
      ...(target.data.language !== project.language ? { language: target.data.language } : {}),
      ...(target.data.targetDurationSec !== project.lengthPreset ? { lengthPreset: target.data.targetDurationSec } : {}),
    };
    const saved = await collections.projects().findOneAndUpdate(
      { _id, userId, status: "storyboard_ready", currentStoryboardVersion: basedOn },
      { $set: { currentStoryboardVersion: version, updatedAt: now, ...settings }, $inc: { rev: 1 } },
      { session, returnDocument: "after" },
    );
    if (!saved) throw new Error("project changed during the restore");
    return { version: target, project: saved };
  });
}

export type SceneOpSaveResult =
  | { version: StoryboardVersionDoc; project: ProjectDoc; created: boolean }
  | "not_found"
  | "invalid_state"
  | { conflict: StoryboardVersionDoc | null }
  | { problems: { field: string; issue: string }[]; sceneMissing: boolean };

/**
 * Saves one manual scene edit, delete or move (F3.6) as the next version (`manual_edit`), in one transaction, on the
 * version the page saw (`basedOn`, If-Match): the shared `applySceneOp` makes the change, the length is measured again.
 * Only in `storyboard_ready`. Nothing changed → the current version, no new one.
 */
export async function saveSceneOp(userId: string, projectId: string, basedOn: number, op: SceneOp): Promise<SceneOpSaveResult> {
  await ensureMigrated();
  const _id = toObjectId(projectId);
  if (!_id) return "not_found";
  return withTransaction(async (session): Promise<SceneOpSaveResult> => {
    const project = await collections.projects().findOne({ _id, userId, deletedAt: null }, { session });
    if (!project) return "not_found";
    if (project.status !== "storyboard_ready" || !project.currentStoryboardVersion) return "invalid_state";
    const current = await versions().findOne({ projectId: _id, userId, version: project.currentStoryboardVersion }, { session });
    if (project.currentStoryboardVersion !== basedOn || !current) return { conflict: current };
    const result = applySceneOp(current.data, op);
    if (!result.ok) return { problems: result.problems, sceneMissing: result.status === "not_found" };
    if (result.noop) return { version: current, project, created: false };
    const now = new Date();
    const latest = await versions().findOne({ projectId: _id, userId }, { session, sort: { version: -1 }, projection: { version: 1 } });
    const number = Math.max(current.version, latest?.version ?? 0) + 1;
    const version: StoryboardVersionDoc = {
      ...current,
      _id: new ObjectId(),
      version: number,
      data: result.storyboard,
      source: "manual_edit",
      basedOnVersion: current.version,
      changeSummary: result.summary,
      changedSceneIds: result.changedSceneIds,
      validationReport: measureStoryboard(result.storyboard),
      createdAt: now,
    };
    delete (version as Partial<StoryboardVersionDoc> & { accuracyReport?: unknown }).accuracyReport;
    await versions().insertOne(version, { session });
    const saved = await collections.projects().findOneAndUpdate(
      { _id, userId, status: "storyboard_ready", currentStoryboardVersion: current.version },
      { $set: { currentStoryboardVersion: number, updatedAt: now }, $inc: { rev: 1 } },
      { session, returnDocument: "after" },
    );
    if (!saved) throw new Error("project changed during the save");
    await pruneVersions(session, _id, userId, number);
    return { version, project: saved, created: true };
  });
}
