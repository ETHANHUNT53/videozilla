import "server-only";
import { randomBytes } from "node:crypto";
import { truncateChars } from "@videozilla/db";
import { ObjectId, type ClientSession } from "mongodb";
import { collections, withTransaction } from "../db/mongo";
import type { IdeaBriefDoc, IdeaSessionDoc, ProjectDoc, ProjectStatus } from "../db/types";
import { isAllowed } from "../rules/project-actions";
import { DEFAULT_TITLE, emptyIdea } from "./projects";

/**
 * Idea session repository (DB Design §4.4, API Design §13.3): one per project, autosaved from the Idea Studio. Like
 * every repository, the user's id is part of every filter, and a foreign or deleted project is simply "not found".
 * See docs/features/F2.1-idea-autosave.md.
 */

export type IdeaMode = IdeaSessionDoc["mode"];

/** Longest inputs, in characters (code points), as in DB Design §4.4 and its validator. */
export const IDEA_LIMITS = { topicInput: 200, ideaInput: 500, notesText: 20_000 } as const;

const INPUTS = ["topicInput", "ideaInput", "notesText"] as const;

/** What the Idea Studio autosaves (`PUT /projects/{id}/idea`). Missing inputs stay as they are. */
export interface IdeaInput {
  mode: IdeaMode;
  topicInput?: string;
  ideaInput?: string;
  notesText?: string;
}

const toObjectId = (id: string): ObjectId | null => (ObjectId.isValid(id) && id.length === 24 ? new ObjectId(id) : null);

/**
 * The project's idea session, or null when the project is unknown, someone else's or deleted. A project without one
 * (shouldn't happen since migration 003) gets an empty one, which the first save creates.
 */
export async function getIdea(userId: string, projectId: string): Promise<IdeaSessionDoc | null> {
  const _id = toObjectId(projectId);
  if (!_id) return null;
  const project = await collections.projects().findOne({ _id, userId, deletedAt: null }, { projection: { _id: 1 } });
  if (!project) return null;
  return (await collections.ideaSessions().findOne({ projectId: _id, userId })) ?? emptyIdea(_id, userId, new Date());
}

export type SaveIdeaResult =
  | { ok: true; idea: IdeaSessionDoc; changed: boolean }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "precondition_failed"; current: IdeaSessionDoc }
  | { ok: false; reason: "invalid_state"; status: ProjectStatus };

/**
 * Autosave (API Design §13.3, §8). With `ifMatchRev` the save only applies to that revision (`412` otherwise, with
 * the current idea); without it, last write wins. Saving what's already stored changes nothing (same `rev`), so
 * an echo never conflicts with another tab. Allowed only while the project allows `edit_idea`.
 *
 * One transaction: the idea's `rev` goes up and the project's "last changed" time moves (so the video comes first in
 * the Library) together, and a concurrent status change (e.g. storyboard generation starting) conflicts with this
 * write instead of slipping between the check and the save.
 */
export async function saveIdea(userId: string, projectId: string, input: IdeaInput, ifMatchRev?: number): Promise<SaveIdeaResult> {
  const _id = toObjectId(projectId);
  if (!_id) return { ok: false, reason: "not_found" };
  return withTransaction(async (session) => {
    const project = await collections.projects().findOne({ _id, userId, deletedAt: null }, { session, projection: { status: 1 } });
    if (!project) return { ok: false, reason: "not_found" } as const;
    const now = new Date();
    let current = await collections.ideaSessions().findOne({ projectId: _id, userId }, { session });
    if (!current) {
      current = emptyIdea(_id, userId, now);
      await collections.ideaSessions().insertOne(current, { session });
    }
    if (ifMatchRev !== undefined && current.rev !== ifMatchRev) return { ok: false, reason: "precondition_failed", current } as const;

    const changes: Partial<IdeaSessionDoc> = {};
    if (input.mode !== current.mode) changes.mode = input.mode;
    for (const field of INPUTS) {
      const value = input[field];
      if (value !== undefined && value !== current[field]) changes[field] = value;
    }
    if (!Object.keys(changes).length) return { ok: true, idea: current, changed: false } as const;
    if (!isAllowed(project.status, "edit_idea")) return { ok: false, reason: "invalid_state", status: project.status } as const;

    const idea = await collections.ideaSessions().findOneAndUpdate(
      { _id: current._id, rev: current.rev },
      { $set: { ...changes, updatedAt: now }, $inc: { rev: 1 } },
      { session, returnDocument: "after" },
    );
    // Inside a snapshot transaction a concurrent write is a write conflict (retried by withTransaction), never this.
    if (!idea) throw new Error("Idea session changed during its own transaction");
    await collections.projects().updateOne({ _id, userId }, { $set: { updatedAt: now } }, { session });
    return { ok: true, idea, changed: true } as const;
  });
}

/** Most suggestion cards kept per idea session (DB Design §4.4): the newest win. */
export const MAX_SUGGESTIONS = 30;

export type Suggestion = IdeaSessionDoc["suggestions"][number];

/**
 * Saves new AI idea cards (F2.2) after the ones already there, keeping the newest 30, and returns them with their ids.
 * The idea's `rev` doesn't change: it guards what the user types, and a suggestion run must never make the next
 * autosave look like a conflict. Null when the project is unknown, someone else's or deleted.
 */
export async function addSuggestions(userId: string, projectId: string, cards: Omit<Suggestion, "id">[]): Promise<Suggestion[] | null | "invalid_state"> {
  const _id = toObjectId(projectId);
  if (!_id) return null;
  const project = await collections.projects().findOne({ _id, userId, deletedAt: null }, { projection: { status: 1 } });
  if (!project) return null;
  // Checked again here: the video may have left the idea stage (e.g. a storyboard started) while Gemini was thinking.
  if (!isAllowed(project.status, "edit_idea")) return "invalid_state";
  const now = new Date();
  const saved: Suggestion[] = cards.map((c) => ({ id: `sg_${randomBytes(6).toString("hex")}`, ...c }));
  // A project from before idea sessions existed gets its (empty) session here.
  // (without the fields this update sets itself).
  const fresh: Partial<IdeaSessionDoc> = emptyIdea(_id, userId, now);
  delete fresh.suggestions;
  delete fresh.updatedAt;
  await collections.ideaSessions().updateOne(
    { projectId: _id, userId },
    { $push: { suggestions: { $each: saved, $slice: -MAX_SUGGESTIONS } }, $set: { updatedAt: now }, $setOnInsert: fresh },
    { upsert: true },
  );
  return saved;
}

export type SaveBriefResult = { idea: IdeaSessionDoc; project: ProjectDoc } | null | "invalid_state";

/**
 * Saves a new brief and its 2 other angles (F2.3), replacing the previous ones. Null when the project is unknown,
 * someone else's or deleted; `invalid_state` when it left the Idea stage (e.g. while Gemini was thinking).
 */
export async function saveBrief(userId: string, projectId: string, brief: IdeaBriefDoc, alternatives: IdeaBriefDoc[]): Promise<SaveBriefResult> {
  return inIdeaStage(userId, projectId, (ctx) => applyBrief(ctx, brief, alternatives));
}

/**
 * "Use this angle" (F2.3): alternative `index` becomes the brief and the brief takes its place, so the user can switch
 * back. No AI call. `no_alternative` when there is no brief or no angle at that index.
 */
export async function switchToAlternative(userId: string, projectId: string, index: number): Promise<SaveBriefResult | "no_alternative"> {
  return inIdeaStage(userId, projectId, async (ctx) => {
    const alternatives = ctx.idea.briefAlternatives ?? [];
    const chosen = alternatives[index];
    if (!ctx.idea.brief || !chosen) return "no_alternative" as const;
    return applyBrief(ctx, chosen, alternatives.map((a, i) => (i === index ? ctx.idea.brief! : a)));
  });
}

interface BriefContext {
  session: ClientSession;
  project: ProjectDoc;
  idea: IdeaSessionDoc;
  now: Date;
}

/**
 * One transaction on a project that allows `edit_idea`, with its idea session (created if missing), so a status change
 * made meanwhile conflicts with the write instead of slipping between the check and the save.
 */
async function inIdeaStage<T>(userId: string, projectId: string, fn: (ctx: BriefContext) => Promise<T>): Promise<T | null | "invalid_state"> {
  const _id = toObjectId(projectId);
  if (!_id) return null;
  return withTransaction(async (session) => {
    const project = await collections.projects().findOne({ _id, userId, deletedAt: null }, { session });
    if (!project) return null;
    if (!isAllowed(project.status, "edit_idea")) return "invalid_state" as const;
    const now = new Date();
    let idea = await collections.ideaSessions().findOne({ projectId: _id, userId }, { session });
    if (!idea) {
      idea = emptyIdea(_id, userId, now);
      await collections.ideaSessions().insertOne(idea, { session });
    }
    return fn({ session, project, idea, now });
  });
}

/**
 * Stores the brief and moves the project's "last changed" time (M2 D3). The idea's `rev` stays: it guards what the user
 * types, so a brief never makes the next autosave look like a conflict. The video's title follows the brief title while
 * the user hasn't named it (PRD F2-FR11): it's still the default, or still the title the previous brief gave it.
 */
async function applyBrief({ session, project, idea, now }: BriefContext, brief: IdeaBriefDoc, alternatives: IdeaBriefDoc[]) {
  const saved = await collections.ideaSessions().findOneAndUpdate(
    { _id: idea._id },
    { $set: { brief, briefAlternatives: alternatives, briefUpdatedAt: now, updatedAt: now } },
    { session, returnDocument: "after" },
  );
  if (!saved) throw new Error("Idea session vanished during its own transaction");
  const unnamed = project.title === DEFAULT_TITLE || (idea.brief !== null && project.title === briefTitle(idea.brief));
  const title = briefTitle(brief);
  const renamed = unnamed && title && title !== project.title;
  const updated = await collections.projects().findOneAndUpdate(
    { _id: project._id, userId: project.userId },
    renamed ? { $set: { title, updatedAt: now }, $inc: { rev: 1 } } : { $set: { updatedAt: now } },
    { session, returnDocument: "after" },
  );
  if (!updated) throw new Error("Project vanished during its own transaction");
  return { idea: saved, project: updated };
}

/** The title a brief gives the video (project titles are at most 80 characters). */
const briefTitle = (b: IdeaBriefDoc) => truncateChars(b.title.trim(), 80);
