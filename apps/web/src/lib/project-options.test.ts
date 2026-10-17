import { AUDIENCES, BOARDS_OR_EXAMS, LANGUAGES, LENGTH_PRESETS, PROJECT_STATUSES, VOICE_GENDERS } from "@videozilla/db";
import { describe, expect, it } from "vitest";
import { AUDIENCE_OPTIONS, BOARD_OPTIONS, LANGUAGE_OPTIONS, LENGTH_OPTIONS, VOICE_OPTIONS, labelOf, stepIndex } from "./project-options";

const values = (options: readonly { value: unknown }[]) => options.map((o) => o.value);

describe("project setting options", () => {
  it("offer exactly the values the database accepts", () => {
    expect(values(LANGUAGE_OPTIONS)).toEqual([...LANGUAGES]);
    expect(values(LENGTH_OPTIONS)).toEqual([...LENGTH_PRESETS]);
    expect(values(AUDIENCE_OPTIONS)).toEqual([...AUDIENCES]);
    expect(values(BOARD_OPTIONS)).toEqual([null, ...BOARDS_OR_EXAMS]);
  });

  it("offer only the two approved voices", () => {
    expect(values(VOICE_OPTIONS)).toEqual([...VOICE_GENDERS]);
    expect(VOICE_OPTIONS.map((o) => o.label)).toEqual(["Female voice", "Male voice"]);
  });

  it("label values, falling back to the raw value", () => {
    expect(labelOf(LANGUAGE_OPTIONS, "hi")).toBe("हिंदी (Hindi)");
    expect(labelOf(BOARD_OPTIONS, null)).toBe("None");
    expect(labelOf([{ value: "x", label: "X" }], "y")).toBe("y");
  });
});

describe("stepIndex", () => {
  it("puts every status on the Idea, Storyboard or Video step", () => {
    const step = Object.fromEntries(PROJECT_STATUSES.map((s) => [s, stepIndex(s)]));
    expect(step).toEqual({
      idea_draft: 0,
      storyboard_generating: 1,
      storyboard_ready: 1,
      building: 2,
      preview_ready: 2,
      rendering: 2,
      exported: 2,
      scheduled: 2,
      publishing: 2,
      posted: 2,
      publish_failed: 2,
      needs_attention: 2,
    });
  });

  it("puts a project that needs attention on the step where it failed", () => {
    expect(stepIndex("needs_attention", "storyboard")).toBe(1);
    for (const kind of ["build", "render", "publish"] as const) expect(stepIndex("needs_attention", kind)).toBe(2);
    expect(stepIndex("publish_failed", "publish")).toBe(2);
  });
});
