import { describe, expect, it } from "vitest";
import { addPoint, briefEdits, movePoint, removePoint } from "./key-points";

/** F2.8: the brief editor's key-point list and the edits it sends. */

describe("key-point list", () => {
  it("adds up to 5, removes down to 1", () => {
    expect(addPoint(["a"])).toEqual(["a", ""]);
    expect(addPoint(["1", "2", "3", "4", "5"])).toHaveLength(5);
    expect(removePoint(["a", "b", "c"], 1)).toEqual(["a", "c"]);
    expect(removePoint(["only"], 0)).toEqual(["only"]);
  });

  it("moves a point up or down, and nothing past the ends", () => {
    expect(movePoint(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(movePoint(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(movePoint(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(movePoint(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});

describe("briefEdits", () => {
  const brief = { title: "T", hook: "H", angle: "A", keyPoints: ["k1", "k2"], outOfScope: ["o1"] };
  it("sends only what changed, trimmed; empty Left-out lines dropped", () => {
    expect(briefEdits(brief, { ...brief, title: "  New  ", outOfScope: ["o1", "  "] })).toEqual({ title: "New" });
    expect(briefEdits(brief, { ...brief, keyPoints: ["k2", "k1"] })).toEqual({ keyPoints: ["k2", "k1"] });
    expect(briefEdits(brief, { ...brief })).toEqual({});
    expect(briefEdits(brief, { ...brief, keyPoints: ["k1", "k2", "  "] })).toEqual({}); // an added point left blank
    expect(briefEdits(brief, { ...brief, keyPoints: ["k1", "", "k3"] })).toEqual({ keyPoints: ["k1", "k3"] });
  });
});
