import { AiBlockedError, AiBusyError, AiOutputError, suggestIdeas } from "@videozilla/ai";
import { AUDIENCES, truncateChars } from "@videozilla/db";
import { z } from "zod";
import { aiBusy, unsafeContent as unsafe } from "@/server/api/ai-errors";
import { ApiError } from "@/server/api/errors";
import { apiRoute, json, methodNotAllowed } from "@/server/api/handler";
import { projectParams as params, textField } from "@/server/api/request";
import { collections } from "@/server/db/mongo";
import { logAiCall } from "@/server/repos/ai-calls";
import { addSuggestions, IDEA_LIMITS } from "@/server/repos/ideas";
import { getProject } from "@/server/repos/projects";
import { consumeUsage, rateLimitHeaders, refundUsage } from "@/server/repos/usage";
import { isAllowed } from "@/server/rules/project-actions";

/**
 * `POST /api/v1/projects/{id}/idea/suggestions` (API Design §13.3, PRD F2-FR2): 5 AI idea cards for a topic, saved
 * with the idea session. Synchronous, within 15 s. Counts against the shared daily `ideas` limit (429), before the
 * AI call. `avoidTitles` lists titles already shown ("Suggest 5 more", "More like this").
 * Errors: `409` outside `idea_draft` / `storyboard_ready`, `422 UNSAFE_CONTENT`, `503 AI_BUSY`.
 * See docs/features/F2.2-topic-suggestions.md.
 */
const body = z.strictObject({
  topic: textField(IDEA_LIMITS.topicInput),
  audience: z.enum(AUDIENCES).optional(),
  avoidTitles: z.array(textField(120)).max(30).optional(),
});

export const POST = apiRoute({ params, body }, async ({ user, params, body }) => {
  const project = await getProject(user.id, params.id);
  if (!project) throw new ApiError("NOT_FOUND");
  if (!isAllowed(project.status, "edit_idea")) {
    throw new ApiError("INVALID_STATE", {
      message: "Ideas can't be suggested at this stage of the video.",
      details: [{ field: "status", issue: `can't change the idea while the video is '${project.status}'`, current: project.status }],
    });
  }
  const profile = await collections.profiles().findOne({ userId: user.id }, { projection: { about: 1 } });
  const usage = await consumeUsage(user.id, "ideas");

  let reply;
  try {
    reply = await suggestIdeas(
      {
        topic: body.topic,
        language: project.language,
        audience: body.audience ?? (project.audience as (typeof AUDIENCES)[number]),
        boardOrExam: project.boardOrExam ?? null,
        creatorAbout: profile?.about ?? null,
        avoidTitles: body.avoidTitles,
      },
      (call) => logAiCall({ userId: user.id, projectId: project._id, task: "ideas", ...call }),
    );
  } catch (err) {
    // Blocked by the provider's safety systems (Gemini's filters, OpenRouter's moderation): a refusal like the model's own, and it counts (it was real use).
    if (err instanceof AiBlockedError) throw unsafe();
    // Nothing was delivered: give the request back to the daily limit.
    await refundUsage(user.id, usage);
    if (err instanceof AiBusyError || err instanceof AiOutputError) {
      if (err instanceof AiOutputError) console.warn(`[ideas] ${err.message}`);
      throw aiBusy(err);
    }
    throw err;
  }

  if ("refused" in reply) throw unsafe(reply.category);

  const suggestions = await addSuggestions(
    user.id,
    params.id,
    reply.ideas.map((i) => ({
      title: truncateChars(i.title, 80),
      hook: truncateChars(i.hook, 200),
      angle: truncateChars(i.angle, 300),
      keyPoints: i.keyPoints.map((k) => truncateChars(k, 160)),
    })),
  );
  // Nothing delivered from here on, so the request goes back to the daily limit.
  if (!suggestions || suggestions === "invalid_state") await refundUsage(user.id, usage);
  if (!suggestions) throw new ApiError("NOT_FOUND"); // deleted while the AI was thinking
  if (suggestions === "invalid_state") {
    throw new ApiError("INVALID_STATE", { message: "The video moved on to its storyboard while the ideas were being made, so they weren't saved." });
  }
  return json({ suggestions }, { headers: rateLimitHeaders(usage) });
});

const notAllowed = methodNotAllowed(["POST"]);
export { notAllowed as GET, notAllowed as PUT, notAllowed as PATCH, notAllowed as DELETE };
