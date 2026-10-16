import "server-only";
import { ObjectId, type Filter } from "mongodb";
import { collections, ensureIndexes } from "../db/mongo";
import { STATUS_GROUPS, type ProfileDoc, type ProjectDoc, type ProjectSummary, type StatusGroup } from "../db/types";

/**
 * Project repository. Every function takes the signed-in user's id and adds it to the query filter, so one user can
 * never read or change another user's projects (PRD §12.5 — MongoDB has no row-level security). Unknown or foreign
 * ids simply return null / false, never a "forbidden" hint.
 */

const PURGE_AFTER_DAYS = 30;
const PAGE_SIZE = 24;

const toObjectId = (id: string): ObjectId | null => (ObjectId.isValid(id) && id.length === 24 ? new ObjectId(id) : null);

export function toSummary(p: ProjectDoc): ProjectSummary {
  return {
    id: p._id.toHexString(),
    title: p.title,
    language: p.language,
    lengthPreset: p.lengthPreset,
    status: p.status,
    updatedAt: p.updatedAt.toISOString(),
    createdAt: p.createdAt.toISOString(),
    deleted: p.deletedAt !== null,
  };
}

export interface ListOptions {
  group?: StatusGroup | "all";
  q?: string;
  /** Cursor: ISO updatedAt of the last item already shown. */
  before?: string;
}

export async function listProjects(userId: string, opts: ListOptions = {}): Promise<{ items: ProjectSummary[]; nextCursor: string | null }> {
  await ensureIndexes();
  const filter: Filter<ProjectDoc> = { userId, deletedAt: null };
  if (opts.group && opts.group !== "all") filter.status = { $in: [...STATUS_GROUPS[opts.group]] };
  const q = opts.q?.trim();
  if (q) filter.title = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  if (opts.before) filter.updatedAt = { $lt: new Date(opts.before) };

  const docs = await collections.projects().find(filter).sort({ updatedAt: -1 }).limit(PAGE_SIZE + 1).toArray();
  const page = docs.slice(0, PAGE_SIZE);
  return { items: page.map(toSummary), nextCursor: docs.length > PAGE_SIZE ? page[page.length - 1].updatedAt.toISOString() : null };
}

export async function getProject(userId: string, id: string): Promise<ProjectDoc | null> {
  const _id = toObjectId(id);
  if (!_id) return null;
  return collections.projects().findOne({ _id, userId, deletedAt: null });
}

/** New project starts as an idea draft with the user's defaults (PRD F1, F4). */
export async function createProject(userId: string, profile: Pick<ProfileDoc, "defaultLanguage" | "defaultLengthPreset" | "defaultVoiceGender" | "defaultStyleId">, title?: string): Promise<string> {
  await ensureIndexes();
  const now = new Date();
  const doc: ProjectDoc = {
    _id: new ObjectId(),
    userId,
    title: (title?.trim() || "Untitled video").slice(0, 80),
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
  const clean = title.trim().slice(0, 80);
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
    title: `${src.title} (copy)`.slice(0, 80),
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
