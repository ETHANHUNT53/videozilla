import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import { apiRoute, json, methodNotAllowed } from "@/server/api/handler";
import { ifMatchRev } from "@/server/api/request";
import { toProject, toStoryboardVersion } from "@/server/api/resources";
import { restoreVersion } from "@/server/repos/storyboards";

const params = z.strictObject({ id: z.string(), version: z.string() });
const versionNumber = (v: string) => (/^[1-9]\d{0,8}$/.test(v) ? Number(v) : null);

/**
 * `POST /api/v1/projects/{id}/storyboard/versions/{version}/restore` (F3.5, your answer): `{version}` becomes the
 * current storyboard again: the pointer moves, nothing is copied (API Design §13.4, changed 2026-10-21). `If-Match:
 * "<currentStoryboardVersion>"` is required (`412` when it moved on). The video's language and length follow the
 * restored version. `409` for the current version or outside `storyboard_ready`; `404` unknown or pruned. Not counted.
 */
export const POST = apiRoute({ params, body: z.strictObject({}) }, async ({ req, user, params }) => {
  const basedOn = ifMatchRev(req.headers.get("if-match"));
  if (basedOn === undefined) throw new ApiError("VALIDATION_FAILED", { details: [{ field: "If-Match", issue: 'is required: the current storyboard version, e.g. "3"' }] });
  const n = versionNumber(params.version);
  const result = n === null ? "not_found" : await restoreVersion(user.id, params.id, n, basedOn);
  if (result === "not_found") throw new ApiError("NOT_FOUND", { message: "That version isn't kept any more." });
  if (result === "invalid_state") throw new ApiError("INVALID_STATE", { message: "A version can be restored once the storyboard is ready." });
  if (result === "already_current") throw new ApiError("INVALID_STATE", { message: "That's already the current version." });
  if ("conflict" in result) {
    throw new ApiError("PRECONDITION_FAILED", {
      message: "The storyboard changed since you opened it, so nothing was restored.",
      details: [{ field: "If-Match", issue: `the current version is now ${result.conflict}`, current: result.conflict }],
    });
  }
  return json({ version: toStoryboardVersion(result.version, result.project.currentStoryboardVersion), project: toProject(result.project) });
});

const notAllowed = methodNotAllowed(["POST"]);
export { notAllowed as DELETE, notAllowed as GET, notAllowed as PATCH, notAllowed as PUT };
