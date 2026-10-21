import { AiBlockedError, AiBusyError, AiOutputError, CAPTION_INSTRUCTION_MAX, rewriteCaption } from "@videozilla/ai";
import { onScreenText } from "@videozilla/pipeline";
import { z } from "zod";
import { aiBusy, unsafeContent } from "@/server/api/ai-errors";
import { ApiError } from "@/server/api/errors";
import { apiRoute, json, methodNotAllowed } from "@/server/api/handler";
import { projectParams as params, textUpTo } from "@/server/api/request";
import { logAiCall } from "@/server/repos/ai-calls";
import { getProject } from "@/server/repos/projects";
import { getCurrentStoryboard } from "@/server/repos/storyboards";
import { consumeUsage, rateLimitHeaders, refundUsage } from "@/server/repos/usage";

/**
 * `POST /api/v1/projects/{id}/storyboard/social/rewrite` (F3.4, task T8): a new caption, hashtags and cover text for
 * the current storyboard, in the video's language, checked against Instagram's limits. Not saved: the page puts it in
 * the edit form, and Save stores it (`PATCH …/social`). One `revisions` unit (your answer), given back when nothing
 * usable came back; a refusal counts. Errors: `404`, `409` outside `storyboard_ready`, `422 UNSAFE_CONTENT`,
 * `429 LIMIT_REACHED`, `503 AI_BUSY`. See docs/features/F3.4-caption-hashtags.md.
 */
const body = z.strictObject({ instruction: textUpTo(CAPTION_INSTRUCTION_MAX).optional() });

/** The platform's limit for this function (seconds): the 15 s AI budget plus the database work around it. */
export const maxDuration = 30;

export const POST = apiRoute({ params, body }, async ({ user, params, body }) => {
  const current = await getCurrentStoryboard(user.id, params.id);
  // A video that has no storyboard yet: 409, as for an edit (only an unknown video is 404).
  if (!current) throw (await getProject(user.id, params.id)) ? new ApiError("INVALID_STATE", { message: "The caption can be rewritten once the storyboard is ready." }) : new ApiError("NOT_FOUND");
  const { project, version } = current;
  if (project.status !== "storyboard_ready") throw new ApiError("INVALID_STATE", { message: "The caption can be rewritten once the storyboard is ready." });

  const usage = await consumeUsage(user.id, "revisions");
  const sb = version.data;
  let reply;
  try {
    reply = await rewriteCaption(
      {
        title: sb.title,
        hook: sb.hook,
        scenes: sb.scenes.map((s) => onScreenText(s) || s.narration.split(/\s+/).slice(0, 12).join(" ")),
        current: sb.social,
        language: sb.language,
        audience: project.audience as "kids" | "students" | "college" | "general",
        boardOrExam: project.boardOrExam ?? null,
        instruction: body.instruction ?? null,
      },
      (call) => logAiCall({ userId: user.id, projectId: project._id, task: "caption", ...call }),
    );
  } catch (err) {
    // Blocked by the provider's safety systems: a refusal, and it counts.
    if (err instanceof AiBlockedError) throw unsafeContent("blocked", "caption");
    // Nothing usable came back: give the unit back.
    await refundUsage(user.id, usage);
    if (err instanceof AiBusyError || err instanceof AiOutputError) {
      if (err instanceof AiOutputError) console.warn(`[caption] ${err.message}`);
      throw aiBusy(err);
    }
    throw err;
  }
  if ("refused" in reply) throw unsafeContent(reply.category, "caption");
  return json({ social: reply, basedOnVersion: version.version }, { headers: rateLimitHeaders(usage) });
});

const notAllowed = methodNotAllowed(["POST"]);
export { notAllowed as DELETE, notAllowed as GET, notAllowed as PATCH, notAllowed as PUT };
