import "server-only";
import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { collections, withTransaction } from "../db/mongo";
import type { IdeaSessionDoc, ProjectStatus } from "../db/types";
import { isAllowed } from "../rules/project-actions";
import { emptyIdea } from "./projects";

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
export async function addSuggestions(userId: string, projectId: string, cards: Omit<Suggestion, "id">[]): Promise<Suggestion[] | null> {
  const _id = toObjectId(projectId);
  if (!_id) return null;
  const project = await collections.projects().findOne({ _id, userId, deletedAt: null }, { projection: { _id: 1 } });
  if (!project) return null;
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
