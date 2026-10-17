import "server-only";
import { truncateChars } from "@videozilla/db";
import { ObjectId, type Filter } from "mongodb";
import { collections, ensureMigrated, withTransaction } from "../db/mongo";
import { afterCursorDesc, decodeCursor, DEFAULT_LIMIT, toPage, type Page } from "../api/pagination";
import { STATUS_GROUPS, type IdeaSessionDoc, type Language, type ProfileDoc, type ProjectDoc, type ProjectFilter, type ProjectSummary, type VoiceGender } from "../db/types";

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

export interface ListQuery {
  filter?: ProjectFilter;
  /** Case-insensitive "title contains", 1–80 characters. */
  q?: string;
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
  const q = query.q?.trim() || undefined;
  const limit = query.limit ?? DEFAULT_LIMIT;
  const scope = { filter: filterName, q: q ?? null };

  const filter: Filter<ProjectDoc> = { userId, deletedAt: null };
  if (filterName !== "all") filter.status = { $in: [...STATUS_GROUPS[filterName]] };
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

/**
 * Creates a project as an idea draft, with the user's profile defaults for anything not given, together with its
 * empty idea session — both in one transaction, so a project never exists without one (DB Design §4.3, §4.4, §6.1).
 */
export async function createProject(userId: string, profile: ProfileDefaults, input: CreateProjectInput = {}): Promise<ProjectDoc> {
  await ensureMigrated();
  const now = new Date();
  const project: ProjectDoc = {
    _id: new ObjectId(),
    userId,
    title: truncateChars(input.title?.trim() || "Untitled video", 80),
    language: input.language ?? profile.defaultLanguage,
    lengthPreset: input.lengthPreset ?? profile.defaultLengthPreset,
    audience: profile.defaultAudience,
    boardOrExam: profile.defaultBoardOrExam ?? null,
    styleId: profile.defaultStyleId,
    voiceGender: input.voiceGender ?? profile.defaultVoiceGender,
    captionsEnabled: false,
    status: "idea_draft",
    statusChangedAt: now,
    attention: null,
    currentStoryboardVersion: null,
    currentTimelineId: null,
    latestRenderId: null,
    exportOutdated: false,
    postedAt: null,
    permalink: null,
    duplicatedFrom: null,
    revisionCount: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    purgeAt: null,
    rev: 0,
  };
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

export async function renameProject(userId: string, id: string, title: string): Promise<boolean> {
  const _id = toObjectId(id);
  const clean = truncateChars(title.trim(), 80);
  if (!_id || !clean) return false;
  const res = await collections.projects().updateOne({ _id, userId, deletedAt: null }, { $set: { title: clean, updatedAt: new Date() }, $inc: { rev: 1 } });
  return res.matchedCount === 1;
}

/** Soft delete: hidden at once, purged with its files after 30 days (PRD F1-FR10). */
export async function softDeleteProject(userId: string, id: string): Promise<boolean> {
  const _id = toObjectId(id);
  if (!_id) return false;
  const now = new Date();
  const purgeAt = new Date(now.getTime() + PURGE_AFTER_DAYS * 24 * 3600 * 1000);
  const res = await collections.projects().updateOne({ _id, userId, deletedAt: null }, { $set: { deletedAt: now, purgeAt }, $inc: { rev: 1 } });
  return res.matchedCount === 1;
}

export async function restoreProject(userId: string, id: string): Promise<boolean> {
  const _id = toObjectId(id);
  if (!_id) return false;
  const res = await collections.projects().updateOne(
    { _id, userId, deletedAt: { $ne: null } },
    { $set: { deletedAt: null, purgeAt: null, updatedAt: new Date() }, $inc: { rev: 1 } },
  );
  return res.matchedCount === 1;
}

/**
 * Copies a project's settings and its idea session into a fresh draft, in one transaction (DB Design §6.13).
 * Renders, timelines and publishing are not copied. Storyboards don't exist before M2; when they do (F3), the current
 * version will be copied as version 1 and the copy will start as `storyboard_ready`.
 */
export async function duplicateProject(userId: string, id: string): Promise<string | null> {
  const src = await getProject(userId, id);
  if (!src) return null;
  const now = new Date();
  const settings = { ...src };
  delete settings.failedStep; // M1 draft field, superseded by `attention`
  const copy: ProjectDoc = {
    ...settings,
    _id: new ObjectId(),
    title: truncateChars(`${src.title} (copy)`, 80),
    status: "idea_draft",
    statusChangedAt: now,
    attention: null,
    currentStoryboardVersion: null,
    currentTimelineId: null,
    latestRenderId: null,
    exportOutdated: false,
    postedAt: null,
    permalink: null,
    duplicatedFrom: src._id,
    revisionCount: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    purgeAt: null,
    rev: 0,
  };
  await withTransaction(async (session) => {
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
  });
  return copy._id.toHexString();
}

/** Daily job: permanently remove projects whose 30-day undo window has passed. */
export async function purgeExpiredProjects(now = new Date()): Promise<number> {
  const res = await collections.projects().deleteMany({ purgeAt: { $lte: now } });
  return res.deletedCount;
}

/** Account deletion: remove everything the user owns. */
export async function deleteAllForUser(userId: string): Promise<void> {
  await collections.projects().deleteMany({ userId });
  await collections.profiles().deleteMany({ userId });
}
