import { normalizeHashtags, socialProblems, type Social } from "@videozilla/schema";
import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import { apiRoute, json, methodNotAllowed } from "@/server/api/handler";
import { ifMatchRev, projectParams as params, textUpTo } from "@/server/api/request";
import { toProject, toStoryboardVersion } from "@/server/api/resources";
import { saveSocialEdit } from "@/server/repos/storyboards";

/**
 * `PATCH /api/v1/projects/{id}/storyboard/social` (F3.4): the Instagram caption, hashtags and cover text, edited.
 * Saved as the next storyboard version (only `social` changes; `source: manual_edit`), on the version given in
 * `If-Match: "<currentStoryboardVersion>"` (required): `412` with the current version when it moved on. Instagram's
 * limits (2,200 characters for caption + hashtags, 30 hashtags, 20 mentions) → `422 CAPTION_INVALID`. Only in
 * `storyboard_ready` (`409` otherwise). See docs/features/F3.4-caption-hashtags.md.
 */
const body = z
  .strictObject({
    caption: textUpTo(4000).optional(),
    hashtags: z.array(textUpTo(200)).max(60).optional(),
    coverText: textUpTo(200).optional(),
  })
  .refine((b) => b.caption !== undefined || b.hashtags !== undefined || b.coverText !== undefined, "Send the caption, the hashtags or the cover text");

/** What the new version says it changed. */
function summaryOf(changed: (keyof Social)[]): string {
  const names = { caption: "caption", hashtags: "hashtags", coverText: "cover text" } as const;
  if (changed.length === 0 || changed.length === 3) return "Edited the caption, hashtags and cover text";
  return `Edited the ${changed.map((c) => names[c]).join(" and ")}`;
}

export const PATCH = apiRoute({ params, body, maxBodyBytes: 32 * 1024 }, async ({ req, user, params, body }) => {
  const basedOn = ifMatchRev(req.headers.get("if-match"));
  if (basedOn === undefined) throw new ApiError("VALIDATION_FAILED", { details: [{ field: "If-Match", issue: 'is required: the storyboard version you edited, e.g. "3"' }] });

  // The page sends the whole edit; fields left out keep their saved value (read inside the save's transaction).
  const result = await saveSocialEdit(user.id, params.id, basedOn, (current) => {
    const social: Social = {
      caption: (body.caption ?? current.caption).trim(),
      hashtags: body.hashtags ? normalizeHashtags(body.hashtags) : current.hashtags,
      coverText: (body.coverText ?? current.coverText).replace(/\s+/g, " ").trim(),
    };
    const problems = socialProblems(social);
    if (problems.length) throw new ApiError("CAPTION_INVALID", { message: "This is over Instagram's limits.", details: problems.map((p) => ({ ...p })) });
    const changed = (["caption", "hashtags", "coverText"] as const).filter((k) => JSON.stringify(social[k]) !== JSON.stringify(current[k]));
    return { social, summary: summaryOf(changed) };
  });

  if (result === "not_found") throw new ApiError("NOT_FOUND");
  if (result === "invalid_state") throw new ApiError("INVALID_STATE", { message: "The caption can be edited once the storyboard is ready." });
  if ("conflict" in result) {
    throw new ApiError("PRECONDITION_FAILED", {
      message: "The storyboard changed since you opened it, so your edit wasn't saved.",
      details: [{ field: "If-Match", issue: "the storyboard has a newer version", ...(result.conflict ? { current: toStoryboardVersion(result.conflict, result.conflict.version) } : {}) }],
    });
  }
  return json(
    { version: toStoryboardVersion(result.version, result.project.currentStoryboardVersion), project: toProject(result.project) },
    { status: result.created ? 201 : 200 },
  );
});

const notAllowed = methodNotAllowed(["PATCH"]);
export { notAllowed as DELETE, notAllowed as GET, notAllowed as POST, notAllowed as PUT };
