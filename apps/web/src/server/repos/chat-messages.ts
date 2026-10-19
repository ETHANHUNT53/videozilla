import "server-only";
import { ObjectId, MongoServerError } from "mongodb";
import { afterCursorAsc, decodeCursor, toPage, type Page } from "../api/pagination";
import { CHAT_STALE_PROCESSING_MS as STALE_PROCESSING_MS, toChatMessage, type ChatMessageResource } from "../api/resources";
import { collections } from "../db/mongo";
import type { ChatMessageDoc } from "../db/types";

/**
 * Idea chat messages (F2.5, DB Design §4.5): sending is idempotent on the page's `clientMessageId` (unique per
 * project, API Design §9), and the thread is read oldest first. Like every repository, the user's id is in every
 * filter. Saving an answer happens with the brief, in `saveChatAnswer` (ideas.ts). See docs/features/F2.5-idea-chat.md.
 */

export type ClaimResult =
  /** A new message (or a failed one sent again): answer it now. */
  | { kind: "new"; message: ChatMessageDoc }
  /** Already answered: return that answer. */
  | { kind: "replay"; message: ChatMessageDoc; answer: ChatMessageDoc }
  /** Already refused: answer 422 again, without another AI call. */
  | { kind: "refused"; category: string }
  /** The same id with another text: 422 IDEMPOTENCY_KEY_REUSED. */
  | { kind: "conflict" }
  /** The first request with this id is still being answered: 409. */
  | { kind: "in_progress" };

/** Takes a user message for answering (see ClaimResult). The project must already be known to belong to the user. */
export async function claimUserMessage(userId: string, projectId: ObjectId, clientMessageId: string, content: string): Promise<ClaimResult> {
  const now = new Date();
  const fresh: ChatMessageDoc = { _id: new ObjectId(), projectId, userId, thread: "idea", role: "user", content, status: "processing", clientMessageId, createdAt: now, updatedAt: now };
  try {
    await collections.chatMessages().insertOne(fresh);
    return { kind: "new", message: fresh };
  } catch (err) {
    if (!(err instanceof MongoServerError && err.code === 11000)) throw err;
  }
  // The id was used before (unique {projectId, clientMessageId}).
  const existing = await collections.chatMessages().findOne({ projectId, clientMessageId });
  if (!existing || existing.userId !== userId || existing.thread !== "idea" || existing.role !== "user" || existing.content !== content) return { kind: "conflict" };
  if (existing.status === "failed") {
    if (existing.refusedCategory) return { kind: "refused", category: existing.refusedCategory };
    return retake(existing, { status: "failed" }, now);
  }
  if (existing.status === "processing") {
    // A request that died mid-answer leaves its message processing; after a while a resend may take it over.
    if (existing.updatedAt.getTime() < now.getTime() - STALE_PROCESSING_MS) return retake(existing, { status: "processing", updatedAt: existing.updatedAt }, now);
    return { kind: "in_progress" };
  }
  const answer = await collections.chatMessages().findOne({ projectId, userId, replyTo: existing._id });
  return answer ? { kind: "replay", message: existing, answer } : { kind: "in_progress" };
}

/** Compare-and-set back to processing, so two resends at once can't both run. */
async function retake(existing: ChatMessageDoc, expected: Partial<ChatMessageDoc>, now: Date): Promise<ClaimResult> {
  const taken = await collections.chatMessages().findOneAndUpdate({ _id: existing._id, ...expected }, { $set: { status: "processing", updatedAt: now } }, { returnDocument: "after" });
  return taken ? { kind: "new", message: taken } : { kind: "in_progress" };
}

/** Marks a message that got no answer (AI busy, unusable reply, refused) as failed; a refusal keeps its category. */
export async function failUserMessage(userId: string, messageId: ObjectId, refusedCategory?: string): Promise<void> {
  await collections.chatMessages().updateOne(
    { _id: messageId, userId, status: "processing" },
    { $set: { status: "failed", updatedAt: new Date(), ...(refusedCategory ? { refusedCategory } : {}) } },
  );
}

/** The idea thread, oldest first (API Design §13.3); the last `limit` turns for the prompt come from `recentIdeaChat`. */
export async function listIdeaChat(userId: string, projectId: ObjectId, limit: number, cursor?: string): Promise<Page<ChatMessageResource>> {
  const scope = { projectId: projectId.toHexString(), thread: "idea" };
  const after = cursor ? afterCursorAsc("createdAt", decodeCursor(cursor, scope)) : {};
  const rows = await collections
    .chatMessages()
    .find({ projectId, userId, thread: "idea", ...after })
    .sort({ createdAt: 1, _id: 1 })
    .limit(limit + 1)
    .toArray();
  return toPage(rows, limit, (m) => toChatMessage(m), (m) => ({ u: m.createdAt.toISOString(), i: m._id.toHexString() }), scope);
}

/** The newest answered turns of the idea thread, oldest first, for the prompt's context (failed and pending ones left out). */
export async function recentIdeaChat(userId: string, projectId: ObjectId, turns: number): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const rows = await collections
    .chatMessages()
    .find({ projectId, userId, thread: "idea", status: { $in: ["applied", "clarification", "unsupported"] } }, { projection: { role: 1, content: 1 } })
    .sort({ createdAt: -1, _id: -1 })
    .limit(turns)
    .toArray();
  return rows.reverse().map((m) => ({ role: m.role, content: m.content }));
}

/**
 * The newest page of the thread for the project page's first render, oldest first: the last `limit` messages, with a
 * cursor-less "there's more" flag (older ones load through the API).
 */
export async function latestIdeaChat(userId: string, projectId: ObjectId, limit: number): Promise<{ items: ChatMessageResource[]; hasOlder: boolean }> {
  const rows = await collections
    .chatMessages()
    .find({ projectId, userId, thread: "idea" })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .toArray();
  return { items: rows.slice(0, limit).reverse().map((m) => toChatMessage(m)), hasOlder: rows.length > limit };
}
