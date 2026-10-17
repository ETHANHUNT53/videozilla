import type { ProjectStatus } from "../db/types";

/**
 * What a user may do with a project in each status (DB Design §5.2). Sent to the UI as `Project.allowedActions` so it
 * knows which buttons to enable; the API checks the same table before every action (`409 INVALID_STATE` otherwise).
 */
export const ALLOWED_ACTIONS = [
  "edit_idea",
  "generate",
  "revise",
  "approve",
  "retry",
  "export",
  "publish",
  "schedule",
  "edit_schedule",
  "cancel_schedule",
  "rename",
  "delete",
  "duplicate",
] as const;
export type AllowedAction = (typeof ALLOWED_ACTIONS)[number];

// "duplicate" works in every status, including posted (API §13.2); "rename" in every status too.
const BY_STATUS: Record<ProjectStatus, AllowedAction[]> = {
  idea_draft: ["edit_idea", "generate", "rename", "delete", "duplicate"],
  storyboard_generating: ["rename", "delete", "duplicate"],
  storyboard_ready: ["edit_idea", "generate", "revise", "approve", "rename", "delete", "duplicate"],
  building: ["revise", "rename", "delete", "duplicate"], // a revision is queued until the build ends
  preview_ready: ["revise", "approve", "export", "rename", "delete", "duplicate"], // approve = rebuild after a voice change
  rendering: ["revise", "rename", "delete", "duplicate"],
  exported: ["revise", "approve", "export", "publish", "schedule", "rename", "delete", "duplicate"],
  scheduled: ["edit_schedule", "cancel_schedule", "rename", "delete", "duplicate"],
  publishing: ["rename", "duplicate"], // delete waits for the post attempt (409 PUBLISH_IN_PROGRESS)
  posted: ["rename", "delete", "duplicate"],
  needs_attention: ["retry", "rename", "delete", "duplicate"],
  publish_failed: ["retry", "schedule", "rename", "delete", "duplicate"], // schedule = reschedule
};

export function allowedActions(status: ProjectStatus): AllowedAction[] {
  return [...BY_STATUS[status]];
}

export function isAllowed(status: ProjectStatus, action: AllowedAction): boolean {
  return BY_STATUS[status].includes(action);
}
