import { ApiError } from "@/server/api/errors";
import { apiRoute, methodNotAllowed } from "@/server/api/handler";
import { projectParams as params } from "@/server/api/request";
import { toRun } from "@/server/api/resources";
import { getStatus } from "@/server/repos/storyboards";

/** How often the page polls while something runs (API Design §10.1). */
const POLL_AFTER_MS = 2000;

/**
 * `GET /api/v1/projects/{id}/status` (API Design §13.7): the video's status plus its active runs and its last 5
 * finished ones. `pollAfterMs` is null when nothing is running, so the page stops polling. A storyboard run that
 * stopped moving for 5 minutes is failed here (its unit given back, the video moved back).
 */
export const GET = apiRoute({ params }, async ({ user, params }) => {
  const status = await getStatus(user.id, params.id);
  if (!status) throw new ApiError("NOT_FOUND");
  const { project, active, last } = status;
  return {
    project: {
      id: project._id.toHexString(),
      status: project.status,
      rev: project.rev,
      exportOutdated: project.exportOutdated ?? false,
      attention: project.attention ? { ...project.attention, at: project.attention.at.toISOString() } : null,
      currentStoryboardVersion: project.currentStoryboardVersion,
    },
    activeRuns: active.map(toRun),
    lastRuns: last.map(toRun),
    renderQueue: null, // renders arrive in M4
    pollAfterMs: active.length ? POLL_AFTER_MS : null,
  };
});

const notAllowed = methodNotAllowed(["GET"]);
export { notAllowed as DELETE, notAllowed as PATCH, notAllowed as POST, notAllowed as PUT };
