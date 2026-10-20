import { describe, expect, it } from "vitest";
import { addPoint, briefEdits, focusAfter, movePoint, removePoint } from "./key-points";

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

describe("focusAfter (keyboard focus follows the item)", () => {
  it("a move keeps the same button on the moved item, or its input at the end of the list", () => {
    expect(focusAfter({ kind: "move", from: 2, by: -1, length: 4 })).toEqual({ index: 1, control: "up" });
    expect(focusAfter({ kind: "move", from: 1, by: -1, length: 4 })).toEqual({ index: 0, control: "input" }); // "up" is now disabled
    expect(focusAfter({ kind: "move", from: 0, by: 1, length: 4 })).toEqual({ index: 1, control: "down" });
    expect(focusAfter({ kind: "move", from: 2, by: 1, length: 4 })).toEqual({ index: 3, control: "input" });
  });

  it("an add focuses the new input (also the 5th, which hides the add button); a remove the item now in its place", () => {
    expect(focusAfter({ kind: "add", length: 5 })).toEqual({ index: 4, control: "input" });
    expect(focusAfter({ kind: "remove", index: 1, length: 2 })).toEqual({ index: 1, control: "input" });
    expect(focusAfter({ kind: "remove", index: 2, length: 2 })).toEqual({ index: 1, control: "input" }); // the last one was removed
    expect(focusAfter({ kind: "remove", index: 0, length: 0 })).toEqual({ index: 0, control: "input" });
  });
});
