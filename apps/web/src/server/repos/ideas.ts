import "server-only";
import { randomBytes } from "node:crypto";
import { truncateChars } from "@videozilla/db";
import { ObjectId, type ClientSession } from "mongodb";
import { collections, withTransaction } from "../db/mongo";
import type { IdeaBrief } from "@videozilla/ai";
import type { ChatMessageDoc, IdeaBriefDoc, IdeaSessionDoc, ProjectDoc, ProjectStatus } from "../db/types";
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
export async function saveBrief(userId: string, projectId: string, brief: IdeaBriefDoc, alternatives: IdeaBriefDoc[], writtenFor?: WrittenFor): Promise<SaveBriefResult> {
  return inIdeaStage(userId, projectId, (ctx) => applyBrief(ctx, brief, alternatives, writtenFor));
}

/**
 * "Use this angle" (F2.3): alternative `index` becomes the brief and the brief takes its place, so the user can switch
 * back. No AI call. `no_alternative` when there is no brief or no angle at that index.
 *
 * A swap is relative to the current brief, so doing it twice undoes it. With `expectedBriefUpdatedAt` (the brief the
 * user was looking at), a request whose brief has changed meanwhile (a retry, a second tab, a double send) doesn't swap
 * again: it just returns the current brief.
 */
export async function switchToAlternative(userId: string, projectId: string, index: number, expectedBriefUpdatedAt?: string): Promise<SaveBriefResult | "no_alternative"> {
  return inIdeaStage(userId, projectId, async (ctx) => {
    if (expectedBriefUpdatedAt !== undefined && (ctx.idea.briefUpdatedAt?.toISOString() ?? null) !== expectedBriefUpdatedAt) {
      return { idea: ctx.idea, project: ctx.project };
    }
    const alternatives = ctx.idea.briefAlternatives ?? [];
    const chosen = alternatives[index];
    if (!ctx.idea.brief || !chosen) return "no_alternative" as const;
    // applyBrief gives the switched-in brief (and the angles) the video's audience setting, so they agree after a switch.
    // The angles were written together with the brief, so the language and length it was written for stay.
    return applyBrief(ctx, chosen, alternatives.map((a, i) => (i === index ? ctx.idea.brief! : a)), "keep");
  });
}

/**
 * A brief as the AI returned it, cut to display lengths (DB Design §4.4); the AI's limits are looser so a slightly long
 * field doesn't cost a repair round. A notes brief keeps up to 5 left-out topics and its notes summary; an idea brief
 * leaves out at most 3 things.
 */
export function trimBrief(b: IdeaBrief, from: "idea" | "notes"): IdeaBriefDoc {
  return {
    title: truncateChars(b.title, 80),
    hook: truncateChars(b.hook, 200),
    angle: truncateChars(b.angle, 300),
    audience: b.audience,
    keyPoints: b.keyPoints.map((k) => truncateChars(k, 160)),
    outOfScope: b.outOfScope.slice(0, from === "notes" ? 5 : 3).map((k) => truncateChars(k, 160)),
    ...(from === "notes" && b.sourceNotesSummary ? { sourceNotesSummary: truncateChars(b.sourceNotesSummary, 200) } : {}),
  };
}

export type ChatAnswerResult =
  | { idea: IdeaSessionDoc; project: ProjectDoc; userMessage: ChatMessageDoc; assistantMessage: ChatMessageDoc }
  | null
  | "invalid_state"
  | "not_processing"
  | "brief_changed";

/**
 * Saves the answer to an idea-chat message (F2.5) in one transaction (DB Design §6): the new brief (when it changed;
 * the other 2 angles stay as they are, and the title rule of F2.3 applies), the user message's status, and the
 * assistant's reply. `not_processing` when the user message isn't being answered any more (another request finished
 * it first). `brief_changed` when the answer changes the brief but the brief it was based on (`basedOn`, its
 * `briefUpdatedAt`) was replaced meanwhile (another tab's chat message, a new brief, another angle): saving it would
 * silently undo that change, so nothing is written. Null / `invalid_state` as for briefs.
 */
export async function saveChatAnswer(
  userId: string,
  projectId: string,
  answer: { userMessageId: ObjectId; status: "applied" | "clarification" | "unsupported"; reply: string; brief: IdeaBriefDoc | null; changedFields: string[]; basedOn: Date | null },
): Promise<ChatAnswerResult> {
  return inIdeaStage(userId, projectId, async (ctx) => {
    const { session, now } = ctx;
    // Checked before any write: a value returned here still commits the transaction.
    if (answer.brief && (ctx.idea.briefUpdatedAt?.getTime() ?? null) !== (answer.basedOn?.getTime() ?? null)) return "brief_changed" as const;
    const userMessage = await collections.chatMessages().findOneAndUpdate(
      { _id: answer.userMessageId, userId, status: "processing" },
      { $set: { status: answer.status, updatedAt: now } },
      { session, returnDocument: "after" },
    );
    if (!userMessage) return "not_processing" as const;
    const saved = answer.brief ? await applyBrief(ctx, answer.brief, ctx.idea.briefAlternatives ?? []) : { idea: ctx.idea, project: ctx.project };
    const assistantMessage: ChatMessageDoc = {
      _id: new ObjectId(),
      projectId: ctx.project._id,
      userId,
      thread: "idea",
      role: "assistant",
      content: answer.reply,
      status: answer.status,
      replyTo: userMessage._id,
      changedFields: answer.changedFields,
      briefAfter: saved.idea.brief,
      // A moment after the user message, so the thread's order (createdAt, then id) never puts the answer first.
      createdAt: new Date(Math.max(now.getTime(), userMessage.createdAt.getTime() + 1)),
      updatedAt: now,
    };
    await collections.chatMessages().insertOne(assistantMessage, { session });
    return { ...saved, userMessage, assistantMessage };
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
/**
 * The language and length a brief was written for (F2.6 follow-up): what its AI call used (so a settings change during
 * the call still shows the bar), `keep` for an angle switch, or by default the video's settings in this transaction.
 */
export type WrittenFor = { language: ProjectDoc["language"]; lengthSec: 60 | 90 } | "keep";

async function applyBrief({ session, project, idea, now }: BriefContext, briefIn: IdeaBriefDoc, alternativesIn: IdeaBriefDoc[], writtenFor?: WrittenFor) {
  const settings = writtenFor === "keep" ? {} : { briefLanguage: writtenFor?.language ?? project.language, briefLengthSec: writtenFor?.lengthSec ?? project.lengthPreset };
  // The brief and its angles always carry the video's audience setting (your decision, 2026-10-19): however the brief
  // was made (idea, card, notes, chat, angle switch), the brief card and the settings panel agree, and a later chat
  // answer never shows an "audience changed" nobody asked for. Read in this transaction, so a settings change at the
  // same moment conflicts instead of slipping in between.
  const brief = { ...briefIn, audience: project.audience };
  const alternatives = alternativesIn.map((a) => ({ ...a, audience: project.audience }));
  const saved = await collections.ideaSessions().findOneAndUpdate(
    { _id: idea._id },
    { $set: { brief, briefAlternatives: alternatives, briefUpdatedAt: now, updatedAt: now, ...settings } },
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
