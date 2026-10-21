import { ApiError } from "@/server/api/errors";
import { apiRoute, methodNotAllowed } from "@/server/api/handler";
import { projectParams as params } from "@/server/api/request";
import { toStoryboardVersion } from "@/server/api/resources";
import { getCurrentStoryboard } from "@/server/repos/storyboards";

/** `GET /api/v1/projects/{id}/storyboard` (API Design §13.4): the current version, or `404` before the first one. */
export const GET = apiRoute({ params }, async ({ user, params }) => {
  const current = await getCurrentStoryboard(user.id, params.id);
  if (!current) throw new ApiError("NOT_FOUND", { message: "This video has no storyboard yet." });
  return toStoryboardVersion(current.version, current.project.currentStoryboardVersion);
});

const notAllowed = methodNotAllowed(["GET"]);
export { notAllowed as DELETE, notAllowed as PATCH, notAllowed as POST, notAllowed as PUT };
