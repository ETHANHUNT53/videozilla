import { AiBlockedError, AiBusyError, AiOutputError, CHAT_HISTORY_TURNS, CHAT_MESSAGE_MAX, changedBriefFields, notesProblem, refineBrief, type IdeaBrief } from "@videozilla/ai";
import { AUDIENCES } from "@videozilla/db";
import { z } from "zod";
import { aiBusy, unsafeContent } from "@/server/api/ai-errors";
import { ApiError } from "@/server/api/errors";
import { apiRoute, json, methodNotAllowed } from "@/server/api/handler";
import { pageQuery } from "@/server/api/pagination";
import { projectParams as params, textField } from "@/server/api/request";
import { toBrief, toChatMessage, toProject } from "@/server/api/resources";
import { collections } from "@/server/db/mongo";
import { logAiCall } from "@/server/repos/ai-calls";
import { claimUserMessage, failUserMessage, listIdeaChat, recentIdeaChat } from "@/server/repos/chat-messages";
import { getIdea, saveChatAnswer, trimBrief } from "@/server/repos/ideas";
import { getProject } from "@/server/repos/projects";
import { consumeUsage, rateLimitHeaders, refundUsage } from "@/server/repos/usage";
import { isAllowed } from "@/server/rules/project-actions";

/**
 * The idea chat (API Design §13.3, PRD F2-FR5, F2.5): the creator asks for a change to the brief and the AI answers;
 * an `applied` answer updates the brief in place (the other 2 angles stay; the title follows it as in F2.3).
 * - `GET`: the thread, oldest first, with cursor pagination.
 * - `POST { clientMessageId, content }`: one message, a synchronous AI call (≤ 15 s; ≤ 25 s for a brief from notes)
 *   that counts one unit of the shared `ideas` limit (given back when nothing is delivered). Idempotent on
 *   `clientMessageId` (API Design §9): a resend gets the stored answer with `Idempotent-Replayed: true`.
 * Errors: `400` without a brief, `409` outside the Idea stage or while the same message is being answered, `422`
 * (refusal, or a reused `clientMessageId`), `429`, `503`. See docs/features/F2.5-idea-chat.md.
 */

/** Our answer when the model changed only the audience, which is a video setting (the prompt asks it to say this itself). */
const AUDIENCE_IN_SETTINGS = {
  en: "The audience is a video setting: change it in the settings panel next to the brief, then ask me to adapt the brief.",
  hi: "दर्शक वीडियो की सेटिंग है: उसे ब्रीफ़ के बगल वाले सेटिंग पैनल में बदलें, फिर मुझसे ब्रीफ़ बदलने को कहें।",
} as const;

const listQuery = z.strictObject({ ...pageQuery, limit: pageQuery.limit.default(50) });

export const GET = apiRoute({ params, query: listQuery }, async ({ user, params, query }) => {
  const project = await getProject(user.id, params.id);
  if (!project) throw new ApiError("NOT_FOUND");
  return listIdeaChat(user.id, project._id, query.limit, query.cursor);
});

const body = z.strictObject({
  clientMessageId: z.string().uuid(),
  // Trimmed first, so a message of only spaces is empty.
  content: z.preprocess((v) => (typeof v === "string" ? v.trim() : v), textField(CHAT_MESSAGE_MAX)),
});

/** As for briefs: a chat answer on notes may use the whole 25 s AI budget, plus the database work around it. */
export const maxDuration = 40;

export const POST = apiRoute({ params, body }, async ({ user, params, body }) => {
  const project = await getProject(user.id, params.id);
  const idea = project && (await getIdea(user.id, params.id));
  if (!project || !idea) throw new ApiError("NOT_FOUND");
  const notInIdeaStage = () =>
    new ApiError("INVALID_STATE", {
      message: "The brief can't be changed at this stage of the video.",
      details: [{ field: "status", issue: `can't change the idea while the video is '${project.status}'`, current: project.status }],
    });
  if (!isAllowed(project.status, "edit_idea")) throw notInIdeaStage();
  if (!idea.brief) throw new ApiError("VALIDATION_FAILED", { message: "Make a brief first, then refine it here.", details: [{ field: "brief", issue: "there's no brief yet" }] });

  const claim = await claimUserMessage(user.id, project._id, body.clientMessageId, body.content);
  if (claim.kind === "conflict") throw new ApiError("IDEMPOTENCY_KEY_REUSED", { details: [{ field: "clientMessageId", issue: "was already used for another message" }] });
  if (claim.kind === "in_progress") throw new ApiError("RUN_IN_PROGRESS", { message: "This message is still being answered." });
  if (claim.kind === "refused") throw unsafeContent(claim.category as Parameters<typeof unsafeContent>[0], "message");
  if (claim.kind === "replay") {
    const current = await getProject(user.id, params.id);
    if (!current) throw new ApiError("NOT_FOUND");
    // The stored messages, with the brief as it is now (it may have changed since; the page must never go back to an
    // older brief, and `briefUpdatedAt` must describe the brief it's sent with).
    const res = answerBody(claim.message, claim.answer, idea.brief, idea.briefUpdatedAt, current);
    return json(res, { headers: { "Idempotent-Replayed": "true" } });
  }
  const message = claim.message;

  // A brief made from notes keeps its notes in view ("use the part about …"), when they're still there.
  const fromNotes = Boolean(idea.brief.sourceNotesSummary);
  const notes = fromNotes && idea.notesText && !notesProblem(idea.notesText) ? idea.notesText : null;
  const [profile, history] = await Promise.all([
    collections.profiles().findOne({ userId: user.id }, { projection: { about: 1 } }),
    recentIdeaChat(user.id, project._id, CHAT_HISTORY_TURNS),
  ]);

  let usage;
  try {
    usage = await consumeUsage(user.id, "ideas");
  } catch (err) {
    await failUserMessage(user.id, message._id); // can be sent again once the limit resets
    throw err;
  }

  let reply;
  try {
    reply = await refineBrief(
      {
        brief: idea.brief as IdeaBrief,
        history,
        message: body.content,
        notes,
        language: project.language,
        lengthSec: project.lengthPreset,
        audience: project.audience as (typeof AUDIENCES)[number],
        boardOrExam: project.boardOrExam ?? null,
        creatorAbout: profile?.about ?? null,
      },
      (call) => logAiCall({ userId: user.id, projectId: project._id, task: "idea_chat", ...call }),
    );
  } catch (err) {
    // A safety block is a refusal (and counts); anything else delivered nothing: the request goes back to the limit.
    if (err instanceof AiBlockedError) {
      await failUserMessage(user.id, message._id, "blocked");
      throw unsafeContent("blocked", "message");
    }
    await failUserMessage(user.id, message._id);
    await refundUsage(user.id, usage);
    if (err instanceof AiBusyError || err instanceof AiOutputError) {
      if (err instanceof AiOutputError) console.warn(`[idea-chat] ${err.message}`);
      throw aiBusy(err);
    }
    throw err;
  }

  if ("refused" in reply) {
    await failUserMessage(user.id, message._id, reply.category);
    throw unsafeContent(reply.category, "message");
  }

  let brief = null;
  let changedFields: string[] = [];
  let status = reply.status;
  let replyText = reply.reply;
  if (reply.status === "applied" && "brief" in reply && reply.brief) {
    brief = trimBrief(reply.brief, fromNotes ? "notes" : "idea");
    // A notes brief keeps its summary as it was: it describes the notes, which a chat message doesn't change (and the
    // highlight doesn't cover it, so a rewrite would go unnoticed).
    if (fromNotes) brief.sourceNotesSummary = idea.brief.sourceNotesSummary;
    // The audience belongs to the video's settings (the panel beside the brief): every answer sets the brief's audience
    // to the setting, so the brief and the settings can't disagree on screen (QA, F2.5). After the setting changed,
    // "adapt the brief for the new audience" brings the brief in line, and that counts as a real change. A model that
    // picked some other audience is overruled.
    const setting = project.audience as IdeaBrief["audience"];
    const askedAudience = brief.audience !== setting;
    brief.audience = setting;
    changedFields = changedBriefFields(idea.brief as IdeaBrief, brief as IdeaBrief);
    if (!changedFields.length) {
      // Nothing left to change: the brief isn't rewritten (its briefUpdatedAt would move, failing another tab's answer
      // or angle switch for nothing). When the model only changed the audience, its reply ("I made it for kids") would
      // be untrue, so the answer says where the audience is changed instead.
      brief = null;
      if (askedAudience) {
        status = "unsupported";
        replyText = AUDIENCE_IN_SETTINGS[project.language];
      }
    }
  }
  let saved;
  try {
    saved = await saveChatAnswer(user.id, params.id, { userMessageId: message._id, status, reply: replyText, brief, changedFields, basedOn: idea.briefUpdatedAt });
  } catch (err) {
    // Nothing was saved (the transaction rolled back): give the request back and let the message be sent again now,
    // not only once it counts as stale.
    await refundUsage(user.id, usage);
    await failUserMessage(user.id, message._id);
    throw err;
  }
  if (!saved || typeof saved === "string") {
    await refundUsage(user.id, usage);
    await failUserMessage(user.id, message._id);
    if (!saved) throw new ApiError("NOT_FOUND"); // deleted meanwhile
    if (saved === "invalid_state") throw new ApiError("INVALID_STATE", { message: "The video moved on to its storyboard while the AI was answering, so nothing was changed." });
    if (saved === "brief_changed") {
      throw new ApiError("PRECONDITION_FAILED", {
        message: "The brief changed while the AI was answering (in another tab?), so nothing was changed. Send the message again.",
        details: [{ field: "brief", issue: "changed while the message was being answered" }],
      });
    }
    throw new ApiError("RUN_IN_PROGRESS", { message: "This message was answered by another request." });
  }
  return json(answerBody(saved.userMessage, saved.assistantMessage, saved.idea.brief, saved.idea.briefUpdatedAt, saved.project), { headers: rateLimitHeaders(usage) });
});

function answerBody(
  userMessage: Parameters<typeof toChatMessage>[0],
  assistantMessage: Parameters<typeof toChatMessage>[0],
  brief: Parameters<typeof toBrief>[0] | null,
  briefUpdatedAt: Date | null,
  project: Parameters<typeof toProject>[0],
) {
  return {
    userMessage: toChatMessage(userMessage),
    assistantMessage: toChatMessage(assistantMessage),
    brief: brief ? toBrief(brief) : null,
    briefUpdatedAt: briefUpdatedAt ? briefUpdatedAt.toISOString() : null,
    project: toProject(project),
  };
}

const notAllowed = methodNotAllowed(["GET", "POST"]);
export { notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
