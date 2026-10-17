import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import { apiRoute, json, methodNotAllowed } from "@/server/api/handler";
import { etag } from "@/server/api/request";
import { toProject } from "@/server/api/resources";
import { restoreProject } from "@/server/repos/projects";

/**
 * `POST /api/v1/projects/{id}/restore` (API Design §13.2, DB §6.7): undo a delete. `200 Project` until the project's
 * `purgeAt`, `404` after. A project caught mid-way (building, rendering…) returns to its last stable status, since the
 * delete cancelled that work. Restoring a project that isn't deleted just returns it.
 */
export const POST = apiRoute({ params: z.strictObject({ id: z.string() }) }, async ({ user, params }) => {
  const project = await restoreProject(user.id, params.id);
  if (!project) throw new ApiError("NOT_FOUND");
  return json(toProject(project), { headers: { ETag: etag(project.rev) } });
});

const notAllowed = methodNotAllowed(["POST"]);
export { notAllowed as DELETE, notAllowed as GET, notAllowed as PATCH, notAllowed as PUT };
