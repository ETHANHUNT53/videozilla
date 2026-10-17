import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import { apiRoute, json, methodNotAllowed } from "@/server/api/handler";
import { etag, ifMatchRev, projectParams as params, textUpTo } from "@/server/api/request";
import { toIdeaSession } from "@/server/api/resources";
import { getIdea, IDEA_LIMITS, saveIdea } from "@/server/repos/ideas";

/** `GET /api/v1/projects/{id}/idea` (API Design §13.3): `200 IdeaSession` with `ETag: "<rev>"`. */
export const GET = apiRoute({ params }, async ({ user, params }) => {
  const idea = await getIdea(user.id, params.id);
  if (!idea) throw new ApiError("NOT_FOUND");
  return json(toIdeaSession(idea), { headers: { ETag: etag(idea.rev) } });
});

/**
 * `PUT /api/v1/projects/{id}/idea` (API Design §13.3): the Idea Studio's autosave. `mode` is required; inputs that are
 * left out stay as they are, so each tab keeps its own text. Allowed while the video is `idea_draft` or
 * `storyboard_ready` (`409 INVALID_STATE` otherwise). Send `If-Match: "<rev>"` (`412` with the current idea when
 * another tab saved first). Notes can be long, so this route accepts bodies up to 128 KB (API Design §4).
 */
const putBody = z.strictObject({
  mode: z.enum(["topic", "idea", "notes"]),
  topicInput: textUpTo(IDEA_LIMITS.topicInput).optional(),
  ideaInput: textUpTo(IDEA_LIMITS.ideaInput).optional(),
  notesText: textUpTo(IDEA_LIMITS.notesText).optional(),
});

export const PUT = apiRoute({ params, body: putBody, maxBodyBytes: 128 * 1024 }, async ({ req, user, params, body }) => {
  const result = await saveIdea(user.id, params.id, body, ifMatchRev(req.headers.get("if-match")));
  if (!result.ok) {
    if (result.reason === "not_found") throw new ApiError("NOT_FOUND");
    if (result.reason === "precondition_failed") {
      throw new ApiError("PRECONDITION_FAILED", {
        details: [{ field: "If-Match", issue: `the idea is now at rev ${result.current.rev}`, current: toIdeaSession(result.current) }],
      });
    }
    throw new ApiError("INVALID_STATE", {
      message: "The idea can't be changed at this stage of the video.",
      details: [{ field: "status", issue: `can't edit the idea while the video is '${result.status}'`, current: result.status }],
    });
  }
  return json(toIdeaSession(result.idea), { headers: { ETag: etag(result.idea.rev) } });
});

const notAllowed = methodNotAllowed(["GET", "PUT"]);
export { notAllowed as POST, notAllowed as PATCH, notAllowed as DELETE };
