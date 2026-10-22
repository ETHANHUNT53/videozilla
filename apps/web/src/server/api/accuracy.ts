import "server-only";
import { z } from "zod";
import { setFlagDismissed } from "../repos/accuracy";
import { ApiError } from "./errors";
import { json } from "./handler";
import { ifMatchRev } from "./request";
import { toProject, toStoryboardVersion } from "./resources";

/** Path params of `/storyboard/accuracy-flags/{flagId}/…` (an unknown flag is simply 404). */
export const flagParams = z.strictObject({ id: z.string(), flagId: z.string().max(20) });

/** The version the page saw (`If-Match`, required), like the other storyboard changes. */
export function requiredVersion(req: Request): number {
  const basedOn = ifMatchRev(req.headers.get("if-match"));
  if (basedOn === undefined) throw new ApiError("VALIDATION_FAILED", { details: [{ field: "If-Match", issue: 'is required: the storyboard version you see, e.g. "3"' }] });
  return basedOn;
}

/** The storyboard moved on since the page loaded it. */
export const staleVersion = (current: number | null) =>
  new ApiError("PRECONDITION_FAILED", { message: "The storyboard changed since you opened it.", details: [{ field: "If-Match", issue: "the storyboard has a newer version", ...(current ? { currentVersion: current } : {}) }] });

/**
 * Dismisses an accuracy flag or brings it back (F3.7): `200 { version, project }`; `404` unknown video or flag, `409`
 * outside `storyboard_ready`, `412` when the storyboard moved on. No new version: the report is the one field a saved
 * version may change (DB §4.6). Not counted.
 */
export async function dismissResponse(req: Request, userId: string, projectId: string, flagId: string, dismissed: boolean): Promise<Response> {
  const result = await setFlagDismissed(userId, projectId, requiredVersion(req), flagId, dismissed);
  if (result === "not_found") throw new ApiError("NOT_FOUND");
  if (result === "flag_missing") throw new ApiError("NOT_FOUND", { message: "That flag isn't on the current storyboard." });
  if (result === "invalid_state") throw new ApiError("INVALID_STATE", { message: "Flags can be changed once the storyboard is ready." });
  if ("conflict" in result) throw staleVersion(result.conflict);
  return json({ version: toStoryboardVersion(result.version, result.project.currentStoryboardVersion), project: toProject(result.project) });
}
