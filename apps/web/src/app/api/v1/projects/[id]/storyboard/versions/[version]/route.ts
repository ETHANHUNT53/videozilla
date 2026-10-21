import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import { apiRoute, methodNotAllowed } from "@/server/api/handler";
import { toStoryboardVersion } from "@/server/api/resources";
import { getVersion } from "@/server/repos/storyboards";

/** Path params of the `/storyboard/versions/{version}` routes: a malformed version is simply "not found". */
const versionParams = z.strictObject({ id: z.string(), version: z.string() });
const versionNumber = (v: string) => (/^[1-9]\d{0,8}$/.test(v) ? Number(v) : null);

/** `GET /api/v1/projects/{id}/storyboard/versions/{version}` (API Design §13.4, F3.5): one version, to view it. */
export const GET = apiRoute({ params: versionParams }, async ({ user, params }) => {
  const n = versionNumber(params.version);
  const found = n === null ? null : await getVersion(user.id, params.id, n);
  if (!found) throw new ApiError("NOT_FOUND", { message: "That version isn't kept any more." });
  return toStoryboardVersion(found.version, found.project.currentStoryboardVersion);
});

const notAllowed = methodNotAllowed(["GET"]);
export { notAllowed as DELETE, notAllowed as PATCH, notAllowed as POST, notAllowed as PUT };
