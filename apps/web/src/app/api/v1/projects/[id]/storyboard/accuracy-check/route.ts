import { ApiError } from "@/server/api/errors";
import { aiBusy } from "@/server/api/ai-errors";
import { requiredVersion, staleVersion } from "@/server/api/accuracy";
import { apiRoute, json, methodNotAllowed } from "@/server/api/handler";
import { projectParams as params } from "@/server/api/request";
import { toProject, toStoryboardVersion } from "@/server/api/resources";
import { runAccuracyCheck } from "@/server/repos/accuracy";
import { logAiCall } from "@/server/repos/ai-calls";
import { getProject } from "@/server/repos/projects";
import { getCurrentStoryboard } from "@/server/repos/storyboards";
import { consumeUsage, rateLimitHeaders, refundUsage } from "@/server/repos/usage";

/**
 * `POST /api/v1/projects/{id}/storyboard/accuracy-check` (F3.7, "Check now"): checks the facts of the current version
 * again, every scene, and answers with it: `200 { version, project }`. One `revisions` unit (your answer), given back
 * when the check fails. Errors: `404`, `409` outside `storyboard_ready` or while a check is running, `412` when the
 * storyboard moved on (If-Match is required), `429 LIMIT_REACHED`, `503 AI_BUSY` (the earlier flags stay).
 * See docs/features/F3.7-accuracy-check.md.
 */

/** The platform's limit for this function (seconds): the 15 s AI budget plus the database work around it. */
export const maxDuration = 30;

export const POST = apiRoute({ params }, async ({ req, user, params }) => {
  const basedOn = requiredVersion(req);
  const current = await getCurrentStoryboard(user.id, params.id);
  if (!current) throw (await getProject(user.id, params.id)) ? new ApiError("INVALID_STATE", { message: "Facts can be checked once the storyboard is ready." }) : new ApiError("NOT_FOUND");
  const { project, version } = current;
  if (project.status !== "storyboard_ready") throw new ApiError("INVALID_STATE", { message: "Facts can be checked once the storyboard is ready." });
  if (version.version !== basedOn) throw staleVersion(version.version);
  const report = version.accuracyReport;
  if (report?.status === "pending" && report.startedAt && Date.now() - new Date(report.startedAt).getTime() < 60_000) {
    throw new ApiError("INVALID_STATE", { message: "The facts are being checked already." });
  }

  const usage = await consumeUsage(user.id, "revisions");
  const result = await runAccuracyCheck(user.id, project._id, version.version, {
    keepOnFailure: true,
    onCall: (call) => logAiCall({ userId: user.id, projectId: project._id, task: "accuracy", ...call }),
  });
  if (!result.ok) {
    // Nothing usable came back: give the unit back; the earlier flags are still there.
    await refundUsage(user.id, usage);
    if (result.error instanceof Error && !/busy|output|blocked/i.test(result.error.name)) console.warn(`[accuracy] ${result.error.message}`);
    throw aiBusy(result.error);
  }
  return json({ version: toStoryboardVersion(result.version, project.currentStoryboardVersion), project: toProject(project) }, { headers: rateLimitHeaders(usage) });
});

const notAllowed = methodNotAllowed(["POST"]);
export { notAllowed as DELETE, notAllowed as GET, notAllowed as PATCH, notAllowed as PUT };
