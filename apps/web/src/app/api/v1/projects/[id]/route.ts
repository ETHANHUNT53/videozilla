import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import { apiRoute, json, methodNotAllowed } from "@/server/api/handler";
import { etag, ifMatchRev, textField } from "@/server/api/request";
import { toProject } from "@/server/api/resources";
import { AUDIENCES, BOARDS_OR_EXAMS } from "@videozilla/db";
import { deleteProject, getProject, updateProject } from "@/server/repos/projects";

/** Any string: an id that isn't a valid project id is simply "not found" (404), like another user's project. */
const params = z.strictObject({ id: z.string() });

/** `GET /api/v1/projects/{id}` (API Design §13.2): `200 Project` with `ETag: "<rev>"`. */
export const GET = apiRoute({ params }, async ({ user, params }) => {
  const project = await getProject(user.id, params.id);
  if (!project) throw new ApiError("NOT_FOUND");
  return json(toProject(project), { headers: { ETag: etag(project.rev) } });
});

/**
 * `PATCH /api/v1/projects/{id}` (API Design §13.2): change settings. Title in any status (except while posting);
 * language / length / audience / board only in `idea_draft` or `storyboard_ready` (there the response says
 * `requiresRegeneration: true`); voice / captions in `storyboard_ready`, `preview_ready` or `exported` (on the last two
 * the video needs a rebuild or re-export, so `exportOutdated` becomes true).
 * Send `If-Match: "<rev>"` to avoid overwriting a change made in another tab (`412` with the current project).
 */
const patchBody = z
  .strictObject({
    title: textField(80).optional(),
    language: z.enum(["en", "hi"]).optional(),
    lengthPreset: z.union([z.literal(60), z.literal(90)]).optional(),
    audience: z.enum(AUDIENCES).optional(),
    boardOrExam: z.enum(BOARDS_OR_EXAMS).nullable().optional(),
    voiceGender: z.enum(["female", "male"]).optional(),
    captionsEnabled: z.boolean().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), "Send at least one field to change");

export const PATCH = apiRoute({ params, body: patchBody }, async ({ req, user, params, body }) => {
  const result = await updateProject(user.id, params.id, body, ifMatchRev(req.headers.get("if-match")));
  if (!result.ok) {
    if (result.reason === "not_found") throw new ApiError("NOT_FOUND");
    if (result.reason === "precondition_failed") {
      throw new ApiError("PRECONDITION_FAILED", { details: [{ field: "If-Match", issue: `the video is now at rev ${result.current.rev}`, current: toProject(result.current) }] });
    }
    throw new ApiError("INVALID_STATE", {
      message: "Those settings can't be changed at this stage of the video.",
      details: (result.fields ?? []).map((field) => ({ field, issue: `can't be changed while the video is '${result.current.status}'`, current: result.current.status })),
    });
  }
  return json({ ...toProject(result.project), requiresRegeneration: result.requiresRegeneration }, { headers: { ETag: etag(result.project.rev) } });
});

/**
 * `DELETE /api/v1/projects/{id}` (API Design §13.2, DB §6.6): soft delete, undoable until `restoreUntil` (30 days).
 * Cancels the project's active runs and scheduled posts. `409 PUBLISH_IN_PROGRESS` while a post is going out.
 * Deleting an already-deleted project returns the same `200`.
 */
export const DELETE = apiRoute({ params }, async ({ user, params }) => {
  const result = await deleteProject(user.id, params.id);
  if (!result.ok) throw new ApiError(result.reason === "not_found" ? "NOT_FOUND" : "PUBLISH_IN_PROGRESS");
  return { ok: true, restoreUntil: result.restoreUntil.toISOString(), cancelled: result.cancelled };
});

const notAllowed = methodNotAllowed(["GET", "PATCH", "DELETE"]);
export { notAllowed as POST, notAllowed as PUT };
