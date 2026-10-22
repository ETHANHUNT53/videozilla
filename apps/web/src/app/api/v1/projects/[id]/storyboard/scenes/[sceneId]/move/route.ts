import { z } from "zod";
import { apiRoute, methodNotAllowed } from "@/server/api/handler";
import { sceneOpResponse, sceneParams as params } from "@/server/api/scene-ops";

/**
 * `POST /api/v1/projects/{id}/storyboard/scenes/{sceneId}/move` (F3.6, API Design §13.4): `{ afterSceneId }` puts the
 * scene after that one (`null`: first). Any scene may move; the moved scene joins the chapter above it. A new version.
 */
const body = z.strictObject({ afterSceneId: z.string().max(40).nullable() });

export const POST = apiRoute({ params, body }, async ({ req, user, params, body }) =>
  sceneOpResponse(req, user.id, params.id, { kind: "move", sceneId: params.sceneId, afterSceneId: body.afterSceneId }),
);

const notAllowed = methodNotAllowed(["POST"]);
export { notAllowed as DELETE, notAllowed as GET, notAllowed as PATCH, notAllowed as PUT };
