import { ApiError } from "@/server/api/errors";
import { apiRoute, created, methodNotAllowed } from "@/server/api/handler";
import { projectParams } from "@/server/api/request";
import { toProject } from "@/server/api/resources";
import { duplicateProject } from "@/server/repos/projects";

/**
 * `POST /api/v1/projects/{id}/duplicate` (API Design §13.2, DB §6.13): a new idea draft with the same settings and
 * idea; renders and posts are not copied. Works in any status, including `posted` (to post the video again).
 * `201 Project` with `Location`.
 */
export const POST = apiRoute({ params: projectParams }, async ({ user, params }) => {
  const copy = await duplicateProject(user.id, params.id);
  if (!copy) throw new ApiError("NOT_FOUND");
  const id = copy._id.toHexString();
  return created(toProject(copy), `/api/v1/projects/${id}`);
});

const notAllowed = methodNotAllowed(["POST"]);
export { notAllowed as DELETE, notAllowed as GET, notAllowed as PATCH, notAllowed as PUT };
