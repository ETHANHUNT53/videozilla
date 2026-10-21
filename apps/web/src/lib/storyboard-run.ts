/**
 * Browser-side logic for generating the storyboard (F3.1): which run to show, what a failure says, what the button
 * says. Kept free of React so it can be unit-tested; components/storyboard-run.tsx uses it. Safe to import from client
 * components.
 */
import type { RunResource } from "@/server/api/resources";

/** `GET /api/v1/projects/{id}/status` (API Design §13.7). */
export interface StatusResponse {
  project: { id: string; status: string; rev: number; currentStoryboardVersion: number | null };
  activeRuns: RunResource[];
  lastRuns: RunResource[];
  pollAfterMs: number | null;
}

/** The storyboard run to show: the active one, else the newest finished one (or the one being followed, by id). */
export function pickStoryboardRun(status: Pick<StatusResponse, "activeRuns" | "lastRuns">, followingId?: string | null): RunResource | null {
  const all = [...status.activeRuns, ...status.lastRuns].filter((r) => r.kind === "storyboard");
  return (followingId ? all.find((r) => r.id === followingId) : undefined) ?? all.find((r) => r.active) ?? all[0] ?? null;
}

/** How long to wait before the next poll: the server's hint while a run is active, otherwise stop (null). */
export function nextPollMs(status: Pick<StatusResponse, "pollAfterMs">): number | null {
  return status.pollAfterMs === null ? null : Math.max(1000, status.pollAfterMs);
}

/** What a failed run says, and whether it counted against today's limit (a refusal does, like the idea AI). */
export function runFailure(run: RunResource | null): { message: string; counted: boolean } | null {
  if (!run || run.status !== "failed" || !run.error) return null;
  return { message: run.error.message, counted: run.error.code === "UNSAFE_CONTENT" };
}

/** The step running now, for the one-line progress text. */
export function currentStep(run: RunResource | null): RunResource["steps"][number] | null {
  if (!run?.active) return null;
  return run.steps.find((s) => s.status === "running") ?? run.steps.find((s) => s.status === "pending") ?? null;
}

/** Why "Generate storyboard" can't be pressed now, or null when it can. */
export function generateBlocked(o: { hasBrief: boolean; editable: boolean; aiIdle: boolean; starting: boolean; status: string }): string | null {
  if (o.status === "storyboard_generating") return "Your storyboard is being written.";
  if (!o.hasBrief) return "Make a brief first.";
  if (!o.editable) return "The storyboard can't be made at this stage of the video.";
  if (o.starting) return "Starting…";
  if (!o.aiIdle) return "Wait for the AI to finish, or save your brief edit first.";
  return null;
}
