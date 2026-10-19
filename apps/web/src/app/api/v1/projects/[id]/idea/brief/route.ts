import { AiBlockedError, AiBusyError, AiOutputError, briefIdea, type IdeaBrief, type IdeaBriefInput } from "@videozilla/ai";
import { AUDIENCES, truncateChars } from "@videozilla/db";
import { z } from "zod";
import { aiBusy, unsafeContent } from "@/server/api/ai-errors";
import { ApiError } from "@/server/api/errors";
import { apiRoute, json, methodNotAllowed } from "@/server/api/handler";
import { projectParams as params } from "@/server/api/request";
import { toBrief, toProject } from "@/server/api/resources";
import { collections } from "@/server/db/mongo";
import type { IdeaBriefDoc } from "@/server/db/types";
import { logAiCall } from "@/server/repos/ai-calls";
import { getIdea, saveBrief, switchToAlternative, type SaveBriefResult } from "@/server/repos/ideas";
import { getProject } from "@/server/repos/projects";
import { consumeUsage, rateLimitHeaders, refundUsage, type UsageResult } from "@/server/repos/usage";
import { isAllowed } from "@/server/rules/project-actions";

/**
 * `POST /api/v1/projects/{id}/idea/brief` (API Design §13.3, PRD F2-FR3): the brief for the video plus 2 other angles,
 * saved with the idea session; the video's title follows the brief title while the user hasn't named it (F2-FR11).
 * - `from: "idea"`: from the saved "I have an idea" text. `from: "suggestion"`: from one of the saved idea cards. Both
 *   are a synchronous AI call (≤ 15 s) that counts against the shared daily `ideas` limit.
 * - `from: "alternative"`: one of the 2 other angles becomes the brief (no AI call, not counted).
 * - `from: "notes"` is F2.4: `400 VALIDATION_FAILED` until then.
 * Errors: `409` outside `idea_draft` / `storyboard_ready`, `422 UNSAFE_CONTENT`, `429 LIMIT_REACHED`, `503 AI_BUSY`.
 * See docs/features/F2.3-idea-brief.md.
 */
const body = z.discriminatedUnion("from", [
  z.strictObject({ from: z.literal("idea") }),
  z.strictObject({ from: z.literal("suggestion"), suggestionId: z.string().regex(/^sg_[0-9a-f]{12}$/) }),
  // `briefUpdatedAt`: the brief the user was looking at; if it has changed meanwhile, nothing is swapped (see switchToAlternative).
  z.strictObject({ from: z.literal("alternative"), index: z.union([z.literal(0), z.literal(1)]), briefUpdatedAt: z.string().datetime().optional() }),
  z.strictObject({ from: z.literal("notes") }),
]);

export const POST = apiRoute({ params, body }, async ({ user, params, body }) => {
  if (body.from === "notes") {
    throw new ApiError("VALIDATION_FAILED", {
      message: "Briefs from notes arrive in a later update.",
      details: [{ field: "from", issue: "'notes' isn't available yet (F2.4)" }],
    });
  }
  const project = await getProject(user.id, params.id);
  const idea = project && (await getIdea(user.id, params.id));
  if (!project || !idea) throw new ApiError("NOT_FOUND");
  if (!isAllowed(project.status, "edit_idea")) {
    throw new ApiError("INVALID_STATE", {
      message: "The brief can't be changed at this stage of the video.",
      details: [{ field: "status", issue: `can't change the idea while the video is '${project.status}'`, current: project.status }],
    });
  }

  if (body.from === "alternative") {
    const result = await switchToAlternative(user.id, params.id, body.index, body.briefUpdatedAt);
    if (result === "no_alternative") throw new ApiError("VALIDATION_FAILED", { details: [{ field: "index", issue: "there's no other angle at this index" }] });
    return respond(user.id, result);
  }

  let source: IdeaBriefInput["source"];
  if (body.from === "idea") {
    if (!idea.ideaInput?.trim()) throw new ApiError("VALIDATION_FAILED", { message: "Describe your idea first.", details: [{ field: "ideaInput", issue: "is empty" }] });
    source = { kind: "idea", text: idea.ideaInput };
  } else {
    const card = idea.suggestions.find((s) => s.id === body.suggestionId);
    if (!card) throw new ApiError("VALIDATION_FAILED", { message: "That idea card isn't saved with this video any more.", details: [{ field: "suggestionId", issue: "no such idea card" }] });
    source = { kind: "card", title: card.title, hook: card.hook, angle: card.angle, keyPoints: card.keyPoints };
  }

  const profile = await collections.profiles().findOne({ userId: user.id }, { projection: { about: 1 } });
  const usage = await consumeUsage(user.id, "ideas");

  let reply;
  try {
    reply = await briefIdea(
      {
        source,
        language: project.language,
        lengthSec: project.lengthPreset,
        audience: project.audience as (typeof AUDIENCES)[number],
        boardOrExam: project.boardOrExam ?? null,
        creatorAbout: profile?.about ?? null,
      },
      (call) => logAiCall({ userId: user.id, projectId: project._id, task: "brief", ...call }),
    );
  } catch (err) {
    // Blocked by the provider's safety systems (Gemini's filters, OpenRouter's moderation): a refusal like the model's own, and it counts (it was real use).
    if (err instanceof AiBlockedError) throw unsafeContent("blocked", "idea");
    // Nothing was delivered: give the request back to the daily limit.
    await refundUsage(user.id, usage);
    if (err instanceof AiBusyError || err instanceof AiOutputError) {
      if (err instanceof AiOutputError) console.warn(`[brief] ${err.message}`);
      throw aiBusy(err);
    }
    throw err;
  }

  if ("refused" in reply) throw unsafeContent(reply.category, "idea");

  const saved = await saveBrief(user.id, params.id, trimBrief(reply.brief), reply.alternatives.map(trimBrief));
  return respond(user.id, saved, usage);
});

/** The answer for a saved brief; when nothing was saved, the request goes back to the daily limit. */
async function respond(userId: string, result: SaveBriefResult, usage?: UsageResult) {
  if ((!result || result === "invalid_state") && usage) await refundUsage(userId, usage);
  if (!result) throw new ApiError("NOT_FOUND"); // deleted meanwhile
  if (result === "invalid_state") {
    throw new ApiError("INVALID_STATE", { message: "The video moved on to its storyboard while the brief was being made, so it wasn't saved." });
  }
  const { idea, project } = result;
  return json(
    {
      brief: toBrief(idea.brief!),
      alternatives: (idea.briefAlternatives ?? []).map(toBrief),
      briefUpdatedAt: idea.briefUpdatedAt ? idea.briefUpdatedAt.toISOString() : null,
      project: toProject(project),
    },
    { headers: usage ? rateLimitHeaders(usage) : {} },
  );
}

/** Display lengths (DB Design §4.4); Gemini's limits are looser so a slightly long field doesn't cost a repair round. */
function trimBrief(b: IdeaBrief): IdeaBriefDoc {
  return {
    title: truncateChars(b.title, 80),
    hook: truncateChars(b.hook, 200),
    angle: truncateChars(b.angle, 300),
    audience: b.audience,
    keyPoints: b.keyPoints.map((k) => truncateChars(k, 160)),
    outOfScope: b.outOfScope.slice(0, 3).map((k) => truncateChars(k, 160)),
  };
}

const notAllowed = methodNotAllowed(["POST"]);
export { notAllowed as GET, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
