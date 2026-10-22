/**
 * Browser-side logic for generating the storyboard (F3.1): which run to show, what a failure says, what the button
 * says. Kept free of React so it can be unit-tested; components/storyboard-run.tsx uses it. Safe to import from client
 * components.
 */
import { ApiClientError } from "./api-client";
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

/**
 * A 409 INVALID_STATE: the video moved on in another tab (a storyboard started or finished), so this tab's buttons are
 * out of date and the page should load the video as it is now (QA, F3.1).
 */
export function isStaleState(err: unknown): boolean {
  return err instanceof ApiClientError && err.code === "INVALID_STATE";
}

/** What the user was doing when the page found out it was behind. */
export type StaleAction = "brief_edit" | "caption_edit" | "scene_edit" | "accuracy" | "flag_dismiss" | "flag_restore" | "generate" | "request" | "restore";

/** The line shown after the page re-synced, so nothing is dropped silently (QA, F3.1). */
export function staleMessage(action: StaleAction, status?: string): string {
  const what =
    action === "brief_edit"
      ? "your brief edit wasn't saved"
      : action === "caption_edit"
        ? "your caption edit wasn't saved"
        : action === "scene_edit"
          ? "your scene change wasn't saved"
        : action === "accuracy"
          ? "the facts weren't checked"
        : action === "flag_dismiss"
          ? "your dismiss wasn't saved"
        : action === "flag_restore"
          ? "the flag wasn't brought back"
        : action === "generate"
          ? "nothing was started"
          : action === "restore"
            ? "nothing was restored"
          : "your request wasn't sent";
  // While a storyboard is being written the cause may be this very tab (QA, F3.5): say what's happening, not "another tab".
  if (status === "storyboard_generating") return `Your storyboard is being written, so ${what}. Its progress shows here.`;
  return `This video moved on in another tab, so ${what}. You're seeing it as it is now.`;
}

/**
 * What the "add hashtag" box holds, as separate tags (F3.4): split at commas; a pasted list of #tags ("#a #b") also
 * splits at spaces; otherwise spaces stay inside the tag, for normalising to remove ("study with me" → one tag).
 */
export function splitTags(raw: string): string[] {
  return raw
    .split(",")
    .flatMap((part) => ((part.trim().match(/#/g) ?? []).length > 1 ? part.split(/\s+/) : [part]))
    .map((p) => p.trim())
    .filter(Boolean);
}
