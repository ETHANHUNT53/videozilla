import "server-only";
import { truncateChars } from "@videozilla/db";
import { ObjectId, type Filter } from "mongodb";
import { collections, ensureMigrated } from "../db/mongo";
import { afterCursorDesc, decodeCursor, DEFAULT_LIMIT, toPage, type Page } from "../api/pagination";
import { STATUS_GROUPS, type ProfileDoc, type ProjectDoc, type ProjectFilter, type ProjectSummary } from "../db/types";

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

/** New project starts as an idea draft with the user's defaults (PRD F1, F4). */
export async function createProject(userId: string, profile: Pick<ProfileDoc, "defaultLanguage" | "defaultLengthPreset" | "defaultVoiceGender" | "defaultStyleId">, title?: string): Promise<string> {
  await ensureMigrated();
  const now = new Date();
  const doc: ProjectDoc = {
    _id: new ObjectId(),
    userId,
    title: truncateChars(title?.trim() || "Untitled video", 80),
    language: profile.defaultLanguage,
    lengthPreset: profile.defaultLengthPreset,
    audience: "students",
    styleId: profile.defaultStyleId,
    voiceGender: profile.defaultVoiceGender,
    status: "idea_draft",
    currentStoryboardVersion: null,
    failedStep: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    purgeAt: null,
    rev: 0,
  };
  await collections.projects().insertOne(doc);
  return doc._id.toHexString();
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

/** Copies settings (and later the idea + latest storyboard) into a fresh draft; renders and publishing are not copied. */
export async function duplicateProject(userId: string, id: string): Promise<string | null> {
  const src = await getProject(userId, id);
  if (!src) return null;
  const now = new Date();
  const copy: ProjectDoc = {
    ...src,
    _id: new ObjectId(),
    title: truncateChars(`${src.title} (copy)`, 80),
    status: src.currentStoryboardVersion ? "storyboard_ready" : "idea_draft",
    failedStep: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    purgeAt: null,
    rev: 0,
  };
  await collections.projects().insertOne(copy);
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
