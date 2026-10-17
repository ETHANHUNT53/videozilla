import { PROJECT_STATUSES } from "@videozilla/db";
import { describe, expect, it } from "vitest";
import { ALLOWED_ACTIONS, allowedActions, isAllowed, statusesAllowing } from "./project-actions";

describe("allowedActions (DB Design §5.2)", () => {
  it("covers every status with known actions only", () => {
    for (const status of PROJECT_STATUSES) {
      for (const action of allowedActions(status)) expect(ALLOWED_ACTIONS).toContain(action);
    }
  });

  it("allows rename and duplicate in every status", () => {
    for (const status of PROJECT_STATUSES) {
      expect(isAllowed(status, "rename"), status).toBe(true);
      expect(isAllowed(status, "duplicate"), status).toBe(true);
    }
  });

  it("allows delete everywhere except while an Instagram post is going out", () => {
    for (const status of PROJECT_STATUSES) expect(isAllowed(status, "delete"), status).toBe(status !== "publishing");
  });

  it.each([
    ["edit_idea", ["idea_draft", "storyboard_ready"]],
    // API Design §13.2 PATCH: language / length / audience / board, and voice / captions.
    ["edit_script_settings", ["idea_draft", "storyboard_ready"]],
    ["edit_media_settings", ["storyboard_ready", "preview_ready", "exported"]],
    ["generate", ["idea_draft", "storyboard_ready"]],
    ["approve", ["storyboard_ready", "preview_ready", "exported"]],
    ["export", ["preview_ready", "exported"]],
    ["publish", ["exported"]],
    ["schedule", ["exported", "publish_failed"]],
    ["edit_schedule", ["scheduled"]],
    ["cancel_schedule", ["scheduled"]],
    ["retry", ["publish_failed", "needs_attention"]],
    ["revise", ["storyboard_ready", "building", "preview_ready", "rendering", "exported"]],
  ] as const)("%s only in %j", (action, statuses) => {
    expect(PROJECT_STATUSES.filter((s) => isAllowed(s, action))).toEqual(statuses);
  });

  it("statusesAllowing lists the same statuses as isAllowed, for the repositories' update filters", () => {
    for (const action of ALLOWED_ACTIONS) expect(statusesAllowing(action).sort()).toEqual(PROJECT_STATUSES.filter((s) => isAllowed(s, action)).sort());
    expect(statusesAllowing("delete")).not.toContain("publishing");
  });

  it("returns a copy the caller can't use to change the table", () => {
    allowedActions("idea_draft").push("publish");
    expect(isAllowed("idea_draft", "publish")).toBe(false);
  });
});
