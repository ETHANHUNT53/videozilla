import "server-only";
import { checkAccuracy, type AiCallLog } from "@videozilla/ai";
import { carryAccuracy, newAccuracyFlags, sceneOnScreen, type AccuracyReport } from "@videozilla/pipeline";
import { ObjectId, type Collection } from "mongodb";
import { collections, ensureMigrated } from "../db/mongo";
import type { ProjectDoc } from "../db/types";
import type { StoryboardVersionDoc } from "./storyboards";

/**
 * The accuracy check on a saved storyboard version (F3.7, PRD F3-FR10, §13.1 T5): run after every generate (free) and
 * on "Check now" (1 revision, given back on a failure; the route charges it). The report is the one field of a version
 * that changes after the save (DB §4.6), so checking and dismissing don't make new versions. It never blocks the video.
 * See docs/features/F3.7-accuracy-check.md.
 */

const versions = () => collections.storyboardVersions() as unknown as Collection<StoryboardVersionDoc>;
const toObjectId = (id: string): ObjectId | null => (ObjectId.isValid(id) && id.length === 24 ? new ObjectId(id) : null);

export type CheckResult = { ok: true; version: StoryboardVersionDoc } | { ok: false; error: unknown; version: StoryboardVersionDoc | null };

/**
 * Checks version `versionNumber` of the video and saves the report on it. While it runs the report is `pending` (any
 * earlier flags stay visible). On a failure the earlier report comes back when it was done (`keepOnFailure`, Check
 * now), otherwise it's `failed`. A manual edit saved while the check ran (the next version, made from this one, with
 * no report) gets the result too, as flags on its unchanged scenes.
 */
export async function runAccuracyCheck(
  userId: string,
  projectId: ObjectId,
  versionNumber: number,
  opts: { onCall?: (log: AiCallLog) => void | Promise<void>; keepOnFailure?: boolean } = {},
): Promise<CheckResult> {
  await ensureMigrated();
  const filter = { projectId, userId, version: versionNumber };
  const doc = await versions().findOne(filter);
  if (!doc) return { ok: false, error: new Error("version not found"), version: null };
  const prev = doc.accuracyReport ?? null;
  const startedAt = new Date();
  const pending: AccuracyReport = { status: "pending", flags: prev?.flags ?? [], uncheckedSceneIds: prev?.uncheckedSceneIds ?? [], startedAt, checkedAt: prev?.checkedAt ?? null, model: prev?.model ?? null, provider: prev?.provider ?? null };
  await versions().updateOne({ _id: doc._id }, { $set: { accuracyReport: pending } });

  const sb = doc.data;
  let report: AccuracyReport;
  try {
    const { findings, model, provider } = await checkAccuracy(
      { title: sb.title, language: sb.language, scenes: sb.scenes.map((s) => ({ id: s.id, narration: s.narration, onScreen: sceneOnScreen(s) })) },
      opts.onCall,
    );
    report = { status: "done", flags: newAccuracyFlags(findings, prev), uncheckedSceneIds: [], startedAt, checkedAt: new Date(), model, provider };
  } catch (error) {
    const back: AccuracyReport = opts.keepOnFailure && prev?.status === "done" ? prev : { status: "failed", flags: [], uncheckedSceneIds: [], startedAt, checkedAt: null };
    const failed = await versions().findOneAndUpdate({ _id: doc._id }, { $set: { accuracyReport: back } }, { returnDocument: "after" });
    return { ok: false, error, version: failed };
  }
  const saved = await versions().findOneAndUpdate({ _id: doc._id }, { $set: { accuracyReport: report } }, { returnDocument: "after" });
  if (!saved) return { ok: false, error: new Error("version gone"), version: null };

  // Edited while the check ran: the newer version was made from this one before it had a report.
  const next = await versions().findOne({ projectId, userId, basedOnVersion: versionNumber, source: "manual_edit", accuracyReport: null });
  if (next) {
    const carried = carryAccuracy(report, sb, next.data);
    if (carried) await versions().updateOne({ _id: next._id, accuracyReport: null }, { $set: { accuracyReport: carried } });
  }
  return { ok: true, version: saved };
}

export type DismissResult = { version: StoryboardVersionDoc; project: ProjectDoc } | "not_found" | "invalid_state" | "flag_missing" | { conflict: number | null };

/** Dismisses a flag ("I checked it") or brings it back, on the current version the page saw (`basedOn`, If-Match). */
export async function setFlagDismissed(userId: string, projectId: string, basedOn: number, flagId: string, dismissed: boolean): Promise<DismissResult> {
  await ensureMigrated();
  const _id = toObjectId(projectId);
  if (!_id) return "not_found";
  const project = await collections.projects().findOne({ _id, userId, deletedAt: null });
  if (!project) return "not_found";
  if (project.status !== "storyboard_ready" || !project.currentStoryboardVersion) return "invalid_state";
  if (project.currentStoryboardVersion !== basedOn) return { conflict: project.currentStoryboardVersion };
  const version = await versions().findOneAndUpdate(
    { projectId: _id, userId, version: basedOn, "accuracyReport.flags.id": flagId },
    { $set: { "accuracyReport.flags.$.dismissed": dismissed } },
    { returnDocument: "after" },
  );
  return version ? { version, project } : "flag_missing";
}
