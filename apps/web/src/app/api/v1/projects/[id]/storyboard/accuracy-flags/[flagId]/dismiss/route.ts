import { dismissResponse, flagParams as params } from "@/server/api/accuracy";
import { apiRoute, methodNotAllowed } from "@/server/api/handler";

/** `POST /api/v1/projects/{id}/storyboard/accuracy-flags/{flagId}/dismiss` (F3.7): "I checked it"; hidden until shown again. */
export const POST = apiRoute({ params }, async ({ req, user, params }) => dismissResponse(req, user.id, params.id, params.flagId, true));

const notAllowed = methodNotAllowed(["POST"]);
export { notAllowed as DELETE, notAllowed as GET, notAllowed as PATCH, notAllowed as PUT };
