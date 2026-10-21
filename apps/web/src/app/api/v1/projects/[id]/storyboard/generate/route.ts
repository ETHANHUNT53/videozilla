import { z } from "zod";
import { apiRoute, json, methodNotAllowed } from "@/server/api/handler";
import { projectParams as params } from "@/server/api/request";
import { toProject, toRun } from "@/server/api/resources";
import { dispatchStoryboardRun } from "@/server/jobs/storyboard";
import { getProject } from "@/server/repos/projects";
import { startStoryboardRun } from "@/server/repos/storyboards";

/**
 * `POST /api/v1/projects/{id}/storyboard/generate` → `202 { run, project }` (API Design §13.4, PRD F3-FR1): counts one
 * `storyboards` unit, moves the video to `storyboard_generating` and starts the `storyboard.generate` job, which writes
 * the storyboard from the brief and saves it as the next version. Progress: `GET …/status`.
 * - `{}` from `idea_draft` (with a brief); `{ "regenerate": true }` from `storyboard_ready`.
 * - While a generation is running, the same run comes back (`Idempotent-Replayed: true`), nothing counted again.
 * Errors: `404`, `409 INVALID_STATE`, `422 VALIDATION_FAILED` (no brief), `429 LIMIT_REACHED`.
 * See docs/features/F3.1-generate-storyboard.md.
 */
const body = z.strictObject({ regenerate: z.literal(true).optional() });

/** The local fallback runs the whole job after the response (up to two AI calls), so give it the time it needs. */
export const maxDuration = 120;

export const POST = apiRoute({ params, body }, async ({ user, params, body }) => {
  const { run, project, replayed } = await startStoryboardRun(user.id, params.id, { regenerate: body.regenerate === true });
  const headers: Record<string, string> = { Location: `/api/v1/projects/${params.id}/status` };
  if (replayed) {
    headers["Idempotent-Replayed"] = "true";
    return json({ run: toRun(run), project: toProject(project) }, { status: 202, headers });
  }
  // A run that couldn't be handed to a job runner in production fails at once; answer with what the video is now.
  const dispatched = await dispatchStoryboardRun(run);
  const now = dispatched === "failed" ? await getProject(user.id, params.id) : null;
  return json({ run: toRun(run), project: toProject(now ?? project) }, { status: 202, headers });
});

const notAllowed = methodNotAllowed(["POST"]);
export { notAllowed as DELETE, notAllowed as GET, notAllowed as PATCH, notAllowed as PUT };
