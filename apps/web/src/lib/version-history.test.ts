import { describe, expect, it } from "vitest";
import { versionSourceLabel, versionWhen } from "./version-history";

describe("version history labels (F3.5)", () => {
  it("says what made each version", () => {
    expect(versionSourceLabel({ source: "generate", changeSummary: "First storyboard" })).toBe("Generated");
    expect(versionSourceLabel({ source: "generate", changeSummary: "Regenerated from the brief" })).toBe("Regenerated");
    expect(versionSourceLabel({ source: "manual_edit", changeSummary: "Rewrote the caption with AI" })).toBe("Rewrote the caption with AI");
    expect(versionSourceLabel({ source: "duplicate", changeSummary: "Copied from another video" })).toBe("Copied from another video");
  });

  it("says when, relative to now", () => {
    const now = Date.parse("2026-10-21T10:00:00Z");
    expect(versionWhen("2026-10-21T09:48:00Z", now)).toMatch(/12/);
  });
});
