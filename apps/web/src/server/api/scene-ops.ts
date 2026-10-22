import "server-only";
import type { SceneOp } from "@videozilla/pipeline";
import { z } from "zod";
import { saveSceneOp } from "../repos/storyboards";
import { ApiError } from "./errors";
import { json } from "./handler";
import { ifMatchRev } from "./request";
import { toProject, toStoryboardVersion } from "./resources";

/** Path params of `/storyboard/scenes/{sceneId}` (an unknown scene id is simply 404). */
export const sceneParams = z.strictObject({ id: z.string(), sceneId: z.string().max(40) });

/**
 * Saves a manual scene edit, delete or move (F3.6) and answers like API Design §13.4: `201 { version, project }` (a
 * new version), `200` when nothing changed; `400` with field paths, `404` unknown scene / video, `409` outside
 * `storyboard_ready` or for the last scene, `412` with the current version when it moved on (If-Match is required).
 */
export async function sceneOpResponse(req: Request, userId: string, projectId: string, op: SceneOp): Promise<Response> {
  const basedOn = ifMatchRev(req.headers.get("if-match"));
  if (basedOn === undefined) throw new ApiError("VALIDATION_FAILED", { details: [{ field: "If-Match", issue: 'is required: the storyboard version you edited, e.g. "3"' }] });
  const result = await saveSceneOp(userId, projectId, basedOn, op);
  if (result === "not_found") throw new ApiError("NOT_FOUND");
  if (result === "invalid_state") throw new ApiError("INVALID_STATE", { message: "Scenes can be edited once the storyboard is ready." });
  if ("conflict" in result) {
    throw new ApiError("PRECONDITION_FAILED", {
      message: "The storyboard changed since you opened it, so your change wasn't saved.",
      details: [{ field: "If-Match", issue: "the storyboard has a newer version", ...(result.conflict ? { current: toStoryboardVersion(result.conflict, result.conflict.version) } : {}) }],
    });
  }
  if ("problems" in result) {
    if (result.sceneMissing) throw new ApiError("NOT_FOUND", { message: "That scene isn't in the current storyboard." });
    if (op.kind === "delete") throw new ApiError("INVALID_STATE", { message: "The last scene can't be deleted.", details: result.problems });
    throw new ApiError("VALIDATION_FAILED", { message: "Some of the scene's text can't be saved.", details: result.problems });
  }
  return json({ version: toStoryboardVersion(result.version, result.project.currentStoryboardVersion), project: toProject(result.project) }, { status: result.created ? 201 : 200 });
}
