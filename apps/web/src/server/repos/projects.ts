import "server-only";
import { truncateChars } from "@videozilla/db";
import { ObjectId, type Filter } from "mongodb";
import { collections, ensureMigrated, withTransaction } from "../db/mongo";
import { afterCursorDesc, decodeCursor, DEFAULT_LIMIT, toPage, type Page } from "../api/pagination";
import { isAllowed, statusesAllowing } from "../rules/project-actions";
import {
  STATUS_GROUPS,
  type Audience,
  type BoardOrExam,
  type IdeaSessionDoc,
  type Language,
  type ProfileDoc,
  type ProjectDoc,
  type ProjectFilter,
  type ProjectStatus,
  type ProjectSummary,
  type VoiceGender,
} from "../db/types";

/**
 * Project repository. Every function takes the signed-in user's id and adds it to the query filter, so one user can
 * never read or change another user's projects (PRD §12.5 — MongoDB has no row-level security). Unknown or foreign
 * ids simply return null / false, never a "forbidden" hint.
 */

const PURGE_AFTER_DAYS = 30;

const toObjectId = (id: string): ObjectId | null => (ObjectId.isValid(id) && id.length === 24 ? new ObjectId(id) : null);

export function toSummary(p: ProjectDoc): ProjectSummary {
  return {
    id: p._id.toHexString(),
    title: p.title,
    language: p.language,
    lengthPreset: p.lengthPreset,
    status: p.status,
    coverUrl: null,
    exportOutdated: p.exportOutdated ?? false,
    postedAt: p.postedAt ? p.postedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    rev: p.rev,
  };
}

/** Longest title search, in characters (code points, like the titles themselves). */
export const SEARCH_MAX_CHARS = 80;

// Control characters other than tab / new line; the API rejects them, so a search must never contain them.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * The one way a title search is cleaned: control characters dropped, NFC, trimmed, at most 80 characters. The
 * Library page and the API both go through it, and the cursor is bound to its result, so a cursor from the
 * page's first render always works for "Load older videos". Empty → no search.
 */
export function normalizeSearch(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const clean = truncateChars(raw.replace(CONTROL, "").replace(/\r\n?/g, "\n").normalize("NFC").trim(), SEARCH_MAX_CHARS).trim();
  return clean || undefined;
}

export interface ListQuery {
  filter?: ProjectFilter;
  /** Case-insensitive "title contains", up to 80 characters (cleaned with normalizeSearch). */
  q?: string;
  /** With filter "all": leave out the needs-attention projects (the Library shows them in their own section). */
  excludeAttention?: boolean;
  limit?: number;
  /** `nextCursor` from the previous page, made with the same filter and q. */
  cursor?: string;
}

/**
 * The library list (API Design §13.2, §6.1): the user's non-deleted projects, newest change first (ties broken by id,
 * so paging never skips or repeats a project), filtered by status group and title. Used by `GET /api/v1/projects`
 * and by the Library page's first render, so both always agree. Served by the `library` / `library_status` indexes.
 */
export async function listProjects(userId: string, query: ListQuery = {}): Promise<Page<ProjectSummary>> {
  await ensureMigrated();
  const filterName = query.filter ?? "all";
  const q = normalizeSearch(query.q);
  const excludeAttention = filterName === "all" && Boolean(query.excludeAttention);
  const limit = query.limit ?? DEFAULT_LIMIT;
  const scope = { filter: filterName, q: q ?? null, excludeAttention };

  const filter: Filter<ProjectDoc> = { userId, deletedAt: null };
  if (filterName !== "all") filter.status = { $in: [...STATUS_GROUPS[filterName]] };
  if (excludeAttention) filter.status = { $nin: [...STATUS_GROUPS.attention] };
  // Unanchored, case-insensitive: can't use an index, so it scans this user's projects (fine at library sizes; the
  // toolbar waits 300 ms after typing). A text / Atlas Search index replaces it if libraries grow large.
  if (q) filter.title = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  if (query.cursor) Object.assign(filter, afterCursorDesc("updatedAt", decodeCursor(query.cursor, scope)));

  const rows = await collections.projects().find(filter).sort({ updatedAt: -1, _id: -1 }).limit(limit + 1).toArray();
  return toPage(rows, limit, toSummary, (p) => ({ u: p.updatedAt.toISOString(), i: p._id.toHexString() }), scope);
}

export async function getProject(userId: string, id: string): Promise<ProjectDoc | null> {
  const _id = toObjectId(id);
  if (!_id) return null;
  return collections.projects().findOne({ _id, userId, deletedAt: null });
}

export interface CreateProjectInput {
  title?: string;
  language?: Language;
  lengthPreset?: 60 | 90;
  voiceGender?: VoiceGender;
}

type ProfileDefaults = Pick<ProfileDoc, "defaultLanguage" | "defaultLengthPreset" | "defaultVoiceGender" | "defaultStyleId" | "defaultAudience" | "defaultBoardOrExam">;

/** The settings a new project takes from the profile, the request, or the project it duplicates. */
type ProjectSettings = Pick<ProjectDoc, "title" | "language" | "lengthPreset" | "audience" | "boardOrExam" | "styleId" | "voiceGender" | "captionsEnabled">;

/**
 * A brand-new idea-draft project document with every DB Design §4.3 field. Only `settings` carry over; status,
 * progress, render and publishing fields always start fresh, so nothing else can leak in from a source project.
 */
function freshProject(userId: string, settings: ProjectSettings, now: Date, duplicatedFrom: ObjectId | null = null): ProjectDoc {
  return {
    _id: new ObjectId(),
    userId,
    title: truncateChars(settings.title.trim() || "Untitled video", 80),
    language: settings.language,
    lengthPreset: settings.lengthPreset,
    audience: settings.audience,
    boardOrExam: settings.boardOrExam ?? null,
    styleId: settings.styleId,
    voiceGender: settings.voiceGender,
    captionsEnabled: settings.captionsEnabled ?? false,
    status: "idea_draft",
    statusChangedAt: now,
    attention: null,
    currentStoryboardVersion: null,
    currentTimelineId: null,
    latestRenderId: null,
    exportOutdated: false,
    postedAt: null,
    permalink: null,
    duplicatedFrom,
    revisionCount: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    purgeAt: null,
    rev: 0,
  };
}

/**
 * Creates a project as an idea draft, with the user's profile defaults for anything not given, together with its
 * empty idea session — both in one transaction, so a project never exists without one (DB Design §4.3, §4.4, §6.1).
 */
export async function createProject(userId: string, profile: ProfileDefaults, input: CreateProjectInput = {}): Promise<ProjectDoc> {
  await ensureMigrated();
  const now = new Date();
  const project = freshProject(
    userId,
    {
      title: input.title ?? "",
      language: input.language ?? profile.defaultLanguage,
      lengthPreset: input.lengthPreset ?? profile.defaultLengthPreset,
      audience: profile.defaultAudience,
      boardOrExam: profile.defaultBoardOrExam ?? null,
      styleId: profile.defaultStyleId,
      voiceGender: input.voiceGender ?? profile.defaultVoiceGender,
      captionsEnabled: false,
    },
    now,
  );
  await withTransaction(async (session) => {
    await collections.projects().insertOne(project, { session });
    await collections.ideaSessions().insertOne(emptyIdea(project._id, userId, now), { session });
  });
  return project;
}

/** A new, empty idea session for a project (DB Design §4.4). */
function emptyIdea(projectId: ObjectId, userId: string, now: Date): IdeaSessionDoc {
  return {
    _id: new ObjectId(),
    projectId,
    userId,
    schemaVersion: 1,
    mode: "topic",
    topicInput: "",
    ideaInput: "",
    notesText: "",
    suggestions: [],
    brief: null,
    briefUpdatedAt: null,
    rev: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** Settings a user can change on a project (API Design §13.2 `PATCH /projects/{id}`). */
export interface ProjectUpdate {
  title?: string;
  language?: Language;
  lengthPreset?: 60 | 90;
  audience?: Audience;
  boardOrExam?: BoardOrExam | null;
  voiceGender?: VoiceGender;
  captionsEnabled?: boolean;
}

/**
 * Which statuses each setting can change in (API Design §13.2). `title` works in every status that allows "rename".
 * Script settings only before the video is built; voice / captions once there is a storyboard.
 */
const SCRIPT_FIELDS = ["language", "lengthPreset", "audience", "boardOrExam"] as const;
const MEDIA_FIELDS = ["voiceGender", "captionsEnabled"] as const;

export type UpdateResult =
  | { ok: true; project: ProjectDoc; requiresRegeneration: boolean }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "precondition_failed" | "invalid_state"; current: ProjectDoc; fields?: string[] };

/**
 * Updates project settings (API Design §13.2, §8). With `ifMatchRev` the update only applies to that revision
 * (`412` otherwise, with the current project); without it, last write wins. Only fields that actually change are
 * checked against the status rules, so re-sending an unchanged value never fails. The status and revision are part
 * of the write's filter, so a concurrent change can't slip between the check and the write.
 */
export async function updateProject(userId: string, id: string, update: ProjectUpdate, ifMatchRev?: number): Promise<UpdateResult> {
  const _id = toObjectId(id);
  if (!_id) return { ok: false, reason: "not_found" };
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await collections.projects().findOne({ _id, userId, deletedAt: null });
    if (!current) return { ok: false, reason: "not_found" };
    if (ifMatchRev !== undefined && current.rev !== ifMatchRev) return { ok: false, reason: "precondition_failed", current };

    const changes: Partial<ProjectDoc> = {};
    if (update.title !== undefined) {
      const title = truncateChars(update.title.trim(), 80);
      if (title && title !== current.title) changes.title = title;
    }
    for (const field of [...SCRIPT_FIELDS, ...MEDIA_FIELDS]) {
      const value = update[field];
      const before = field === "boardOrExam" ? (current.boardOrExam ?? null) : field === "captionsEnabled" ? (current.captionsEnabled ?? false) : current[field];
      if (value !== undefined && value !== before) Object.assign(changes, { [field]: value });
    }
    if (!Object.keys(changes).length) return { ok: true, project: current, requiresRegeneration: false };

    const blocked = [
      ...(changes.title !== undefined && !statusesAllowing("rename").includes(current.status) ? ["title"] : []),
      ...SCRIPT_FIELDS.filter((f) => f in changes && !isAllowed(current.status, "edit_script_settings")),
      ...MEDIA_FIELDS.filter((f) => f in changes && !isAllowed(current.status, "edit_media_settings")),
    ];
    if (blocked.length) return { ok: false, reason: "invalid_state", current, fields: blocked };

    const mediaChanged = MEDIA_FIELDS.some((f) => f in changes);
    if (mediaChanged && (current.status === "preview_ready" || current.status === "exported")) changes.exportOutdated = true;

    const res = await collections.projects().findOneAndUpdate(
      { _id, userId, deletedAt: null, rev: current.rev, status: current.status },
      { $set: { ...changes, updatedAt: new Date() }, $inc: { rev: 1 } },
      { returnDocument: "after" },
    );
    if (res) {
      const requiresRegeneration = current.status === "storyboard_ready" && SCRIPT_FIELDS.some((f) => f in changes);
      return { ok: true, project: res, requiresRegeneration };
    }
    // Changed meanwhile: with If-Match that's a conflict; without, read again and re-check (last write wins).
    if (ifMatchRev !== undefined) {
      const latest = await collections.projects().findOne({ _id, userId, deletedAt: null });
      return latest ? { ok: false, reason: "precondition_failed", current: latest } : { ok: false, reason: "not_found" };
    }
  }
  throw new Error("Project kept changing while being updated");
}

export type DeleteResult =
  | { ok: true; restoreUntil: Date; cancelled: { runs: number; scheduledPosts: number } }
  | { ok: false; reason: "not_found" | "publish_in_progress" };

/**
 * Soft delete (DB Design §6.6, API §13.2): the project is hidden at once and purged with its files after 30 days.
 * In the same transaction, its active pipeline runs, scheduled Instagram posts and queued render jobs are cancelled.
 * Not allowed while a post is going out (§5.2). Deleting an already-deleted project returns the same success.
 */
export async function deleteProject(userId: string, id: string): Promise<DeleteResult> {
  const _id = toObjectId(id);
  if (!_id) return { ok: false, reason: "not_found" };
  return withTransaction(async (session): Promise<DeleteResult> => {
    const project = await collections.projects().findOne({ _id, userId }, { session });
    if (!project || (project.purgeAt && project.purgeAt <= new Date())) return { ok: false, reason: "not_found" };
    if (project.deletedAt) return { ok: true, restoreUntil: project.purgeAt!, cancelled: { runs: 0, scheduledPosts: 0 } };

    const now = new Date();
    const purgeAt = new Date(now.getTime() + PURGE_AFTER_DAYS * 24 * 3600 * 1000);
    const res = await collections.projects().updateOne(
      { _id, userId, deletedAt: null, status: { $in: statusesAllowing("delete") } },
      { $set: { deletedAt: now, purgeAt }, $inc: { rev: 1 } },
      { session },
    );
    if (!res.matchedCount) return { ok: false, reason: "publish_in_progress" };

    const runs = await collections.pipelineRuns().updateMany(
      { projectId: _id, userId, active: true },
      { $set: { status: "cancelled", active: false, finishedAt: now, updatedAt: now } },
      { session },
    );
    const posts = await collections.publishJobs().updateMany(
      { projectId: _id, userId, status: "scheduled" },
      { $set: { status: "cancelled", active: false, cancelledAt: now, updatedAt: now }, $inc: { rev: 1 } },
      { session },
    );
    await collections.renderJobs().updateMany({ projectId: _id, userId, status: "queued" }, { $set: { status: "cancelled", finishedAt: now, updatedAt: now } }, { session });
    return { ok: true, restoreUntil: purgeAt, cancelled: { runs: runs.modifiedCount, scheduledPosts: posts.modifiedCount } };
  });
}

/**
 * The status a restored project returns to (DB Design §6.7). Work that was cancelled by the delete is not revived, so
 * a project caught mid-way goes back to its last stable status.
 */
function restoredStatus(p: ProjectDoc): ProjectStatus {
  switch (p.status) {
    case "storyboard_generating":
      return p.currentStoryboardVersion ? "storyboard_ready" : "idea_draft";
    case "building":
      return "storyboard_ready";
    case "rendering":
      return "preview_ready";
    case "scheduled":
      return "exported"; // its scheduled post was cancelled
    default:
      return p.status;
  }
}

/**
 * Undo delete (DB Design §6.7, API §13.2): works until `purgeAt`, then the project is gone (null → 404). Restoring a
 * project that isn't deleted just returns it, so a repeated "Undo" is harmless.
 */
export async function restoreProject(userId: string, id: string): Promise<ProjectDoc | null> {
  const _id = toObjectId(id);
  if (!_id) return null;
  const now = new Date();
  const project = await collections.projects().findOne({ _id, userId });
  if (!project) return null;
  if (!project.deletedAt) return project;
  if (!project.purgeAt || project.purgeAt <= now) return null;

  const status = restoredStatus(project);
  const res = await collections.projects().findOneAndUpdate(
    { _id, userId, rev: project.rev, deletedAt: { $ne: null }, purgeAt: { $gt: now } },
    { $set: { deletedAt: null, purgeAt: null, status, ...(status !== project.status && { statusChangedAt: now }), updatedAt: now }, $inc: { rev: 1 } },
    { returnDocument: "after" },
  );
  // Restored by another request meanwhile: return the project as it is now.
  return res ?? collections.projects().findOne({ _id, userId, deletedAt: null });
}

/**
 * Copies a project's settings and its idea session into a fresh draft, in one transaction (DB Design §6.13). The
 * source is read inside it too, so the copy matches one moment of the source. Only the settings fields carry over
 * (freshProject); renders, timelines and publishing are not copied. Storyboards don't exist before M2; when they do
 * (F3), the current version will be copied as version 1 and the copy will start as `storyboard_ready`.
 */
export async function duplicateProject(userId: string, id: string): Promise<ProjectDoc | null> {
  const _id = toObjectId(id);
  if (!_id) return null;
  return withTransaction(async (session) => {
    const src = await collections.projects().findOne({ _id, userId, deletedAt: null, status: { $in: statusesAllowing("duplicate") } }, { session });
    if (!src) return null;
    const now = new Date();
    const copy = freshProject(userId, { ...src, title: `${src.title} (copy)` }, now, src._id);
    const idea = await collections.ideaSessions().findOne({ projectId: src._id, userId }, { session });
    await collections.projects().insertOne(copy, { session });
    await collections.ideaSessions().insertOne(
      {
        ...(idea ?? emptyIdea(copy._id, userId, now)),
        _id: new ObjectId(),
        projectId: copy._id,
        rev: 0,
        createdAt: now,
        updatedAt: now,
      },
      { session },
    );
    return copy;
  });
}

/**
 * Daily job: permanently remove projects whose 30-day undo window has passed, together with their idea sessions (one
 * transaction). Pass `ids` (from the job's "find" step) to remove exactly the projects whose files were deleted.
 */
export async function purgeExpiredProjects(now = new Date(), ids?: string[]): Promise<number> {
  const filter: Filter<ProjectDoc> = { purgeAt: { $lte: now } };
  if (ids) filter._id = { $in: ids.map((i) => new ObjectId(i)) };
  const expired = (await collections.projects().find(filter, { projection: { _id: 1 } }).toArray()).map((p) => p._id);
  if (!expired.length) return 0;
  return withTransaction(async (session) => {
    const res = await collections.projects().deleteMany({ _id: { $in: expired }, purgeAt: { $lte: now } }, { session });
    await collections.ideaSessions().deleteMany({ projectId: { $in: expired } }, { session });
    return res.deletedCount;
  });
}

/** Account deletion: remove everything the user owns (projects, idea sessions, profile), in one transaction. */
export async function deleteAllForUser(userId: string): Promise<void> {
  await withTransaction(async (session) => {
    await collections.projects().deleteMany({ userId }, { session });
    await collections.ideaSessions().deleteMany({ userId }, { session });
    await collections.profiles().deleteMany({ userId }, { session });
  });
}
