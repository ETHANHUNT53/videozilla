import { describe, expect, it } from "vitest";
import type { RunResource } from "@/server/api/resources";
import { ApiClientError } from "./api-client";
import { currentStep, generateBlocked, isStaleState, nextPollMs, pickStoryboardRun, runFailure, staleMessage } from "./storyboard-run";

const run = (over: Partial<RunResource> = {}): RunResource => ({
  id: "r1",
  projectId: "p",
  kind: "storyboard",
  status: "running",
  active: true,
  progress: 10,
  steps: [
    { name: "load_context", label: "Reading your brief…", status: "succeeded", attempt: 1 },
    { name: "write_script", label: "Writing your script and planning scenes…", status: "running", attempt: 1 },
    { name: "check", label: "Checking scenes, sync and length…", status: "pending", attempt: 0 },
    { name: "save_version", label: "Saving your storyboard…", status: "pending", attempt: 0 },
  ],
  error: null,
  etaSec: null,
  startedAt: null,
  finishedAt: null,
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z",
  ...over,
});

describe("storyboard run helpers (F3.1)", () => {
  it("picks the active storyboard run, else the newest finished one, else the one being followed", () => {
    const done = run({ id: "old", status: "succeeded", active: false });
    expect(pickStoryboardRun({ activeRuns: [run()], lastRuns: [done] })!.id).toBe("r1");
    expect(pickStoryboardRun({ activeRuns: [], lastRuns: [done] })!.id).toBe("old");
    expect(pickStoryboardRun({ activeRuns: [], lastRuns: [run({ id: "x", status: "failed", active: false }), done] }, "old")!.id).toBe("old");
    expect(pickStoryboardRun({ activeRuns: [], lastRuns: [] })).toBeNull();
  });

  it("polls on the server's hint (at least 1 s) and stops when nothing runs", () => {
    expect(nextPollMs({ pollAfterMs: 2000 })).toBe(2000);
    expect(nextPollMs({ pollAfterMs: 10 })).toBe(1000);
    expect(nextPollMs({ pollAfterMs: null })).toBeNull();
  });

  it("a failure says why, and whether it counted (only a refusal does)", () => {
    expect(runFailure(run())).toBeNull();
    expect(runFailure(run({ status: "failed", active: false, error: { code: "AI_BUSY", message: "busy", retryable: true, step: "write_script" } }))).toEqual({ message: "busy", counted: false });
    expect(runFailure(run({ status: "failed", active: false, error: { code: "UNSAFE_CONTENT", message: "no", retryable: true, step: "write_script" } }))!.counted).toBe(true);
  });

  it("shows the running step", () => {
    expect(currentStep(run())!.name).toBe("write_script");
    expect(currentStep(run({ active: false }))).toBeNull();
  });

  it("the Generate button says why it's off", () => {
    const ok = { hasBrief: true, editable: true, aiIdle: true, starting: false, status: "idea_draft" };
    expect(generateBlocked(ok)).toBeNull();
    expect(generateBlocked({ ...ok, hasBrief: false })).toBe("Make a brief first.");
    expect(generateBlocked({ ...ok, aiIdle: false })).toMatch(/Wait for the AI/);
    expect(generateBlocked({ ...ok, status: "storyboard_generating" })).toMatch(/being written/);
    expect(generateBlocked({ ...ok, editable: false })).toMatch(/can't be made/);
  });

  it("a 409 INVALID_STATE means this tab is behind; other errors don't", () => {
    expect(isStaleState(new ApiClientError(409, "INVALID_STATE", "x"))).toBe(true);
    expect(isStaleState(new ApiClientError(409, "RUN_IN_PROGRESS", "x"))).toBe(false);
    expect(isStaleState(new ApiClientError(429, "LIMIT_REACHED", "x"))).toBe(false);
    expect(isStaleState(new Error("x"))).toBe(false);
  });

  it("after a re-sync, says what didn't happen (nothing is dropped silently)", () => {
    expect(staleMessage("brief_edit")).toBe("This video moved on in another tab, so your brief edit wasn't saved. You're seeing it as it is now.");
    expect(staleMessage("generate")).toMatch(/so nothing was started./);
    expect(staleMessage("request")).toMatch(/so your request wasn't sent./);
  });
});
