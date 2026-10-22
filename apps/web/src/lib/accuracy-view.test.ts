import { describe, expect, it } from "vitest";
import { accuracyAnnouncement, accuracyChip, type AccuracyState } from "./accuracy-view";

/** F3.7: what the chip says about the facts check, and the button it offers. */

const state = (over: Partial<AccuracyState> = {}): AccuracyState => ({ status: "done", checkedAt: "2026-10-22T10:00:00.000Z", openCount: 0, dismissedCount: 0, uncheckedSceneIds: [], ...over });
const position = (id: string) => Number(id.slice(1));

describe("accuracyChip", () => {
  it("while checking, not checked, failed", () => {
    expect(accuracyChip(state({ status: "pending" }), position)).toMatchObject({ text: "Checking facts…", action: null, tone: "muted" });
    expect(accuracyChip(state({ status: "none" }), position)).toMatchObject({ text: "Facts not checked", action: "Check now", tone: "warn" });
    expect(accuracyChip(state({ status: "failed" }), position)).toMatchObject({ text: "Facts not checked", action: "Check now" });
  });

  it("done: open claims, or all clear; scenes changed since the check ask for Check now", () => {
    expect(accuracyChip(state({ openCount: 2 }), position)).toMatchObject({ text: "2 claims to check", spoken: "2 claims to check.", tone: "warn", action: "Check again" });
    expect(accuracyChip(state({ openCount: 1 }), position).text).toBe("1 claim to check");
    expect(accuracyChip(state(), position)).toMatchObject({ text: "Facts checked ✓", tone: "ok", action: "Check again" });
    expect(accuracyChip(state({ uncheckedSceneIds: ["s3"] }), position)).toMatchObject({ text: "Facts checked ✓ · scene 3 changed", spoken: "Facts checked, nothing flagged. Scene 3 changed since the check.", tone: "warn", action: "Check now" });
    expect(accuracyChip(state({ openCount: 1, uncheckedSceneIds: ["s5", "s2"] }), position).text).toBe("1 claim to check · 2 scenes changed");
  });

  it("all open claims dismissed: says so, instead of \"nothing flagged\" (QA, F3.7)", () => {
    expect(accuracyChip(state({ dismissedCount: 1 }), position).spoken).toBe("No open claims (1 dismissed).");
    expect(accuracyChip(state({ dismissedCount: 2, uncheckedSceneIds: ["s4"] }), position).spoken).toBe("No open claims (2 dismissed). Scene 4 changed since the check.");
  });

  it("announces the result", () => {
    expect(accuracyAnnouncement(state({ openCount: 3 }))).toBe("Facts checked: 3 claims to check.");
    expect(accuracyAnnouncement(state())).toBe("Facts checked: nothing flagged.");
    expect(accuracyAnnouncement(state({ status: "failed" }))).toMatch(/couldn't be checked/);
  });
});
