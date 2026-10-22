import { describe, expect, it, vi } from "vitest";
import { capitalize, followPointer, moveInOrder, pointerIndex } from "./scene-reorder";

/** F3.6 drag-and-drop (QA: a mouse drag downwards stayed "picked up" because the handle lost pointer capture). */

/** A pointer or key event as the browser sends it, on a plain EventTarget (no DOM in these tests). */
const event = (type: string, extra: Record<string, unknown> = {}) => Object.assign(new Event(type, { cancelable: true }), extra);

describe("followPointer (the drag is followed on the window, not the handle)", () => {
  it("passes every move's y, ends the drag on the release wherever it lands, and stops listening after", () => {
    const win = new EventTarget();
    const on = { move: vi.fn(), up: vi.fn(), cancel: vi.fn() };
    const stop = followPointer(win, on);
    win.dispatchEvent(event("pointermove", { clientY: 120 }));
    win.dispatchEvent(event("pointermove", { clientY: 480 })); // below the next card: the card moved in the page
    win.dispatchEvent(event("pointerup")); // lands on another element, not the handle
    expect(on.move.mock.calls).toEqual([[120], [480]]);
    expect(on.up).toHaveBeenCalledTimes(1);
    stop();
    win.dispatchEvent(event("pointerup"));
    win.dispatchEvent(event("pointermove", { clientY: 10 }));
    expect(on.up).toHaveBeenCalledTimes(1);
    expect(on.move).toHaveBeenCalledTimes(2);
  });

  it("a cancelled pointer (a touch taken over by the browser) or Escape cancels; other keys don't", () => {
    const win = new EventTarget();
    const on = { move: vi.fn(), up: vi.fn(), cancel: vi.fn() };
    followPointer(win, on);
    win.dispatchEvent(event("keydown", { key: "ArrowDown" }));
    expect(on.cancel).not.toHaveBeenCalled();
    const esc = event("keydown", { key: "Escape" });
    win.dispatchEvent(esc);
    expect(on.cancel).toHaveBeenCalledTimes(1);
    expect(esc.defaultPrevented).toBe(true);
    win.dispatchEvent(event("pointercancel"));
    expect(on.cancel).toHaveBeenCalledTimes(2);
    expect(on.up).not.toHaveBeenCalled();
  });
});

describe("announcements", () => {
  it("a label starting a sentence is capitalised (\"Move cancelled. Scene 3 stays …\", QA)", () => {
    expect(capitalize("scene 3")).toBe("Scene 3");
    expect(capitalize("")).toBe("");
  });
});

describe("where a dragged card lands", () => {
  it("after every other card whose middle is above the pointer", () => {
    expect(pointerIndex([100, 300, 500], 50)).toBe(0);
    expect(pointerIndex([100, 300, 500], 350)).toBe(2);
    expect(pointerIndex([100, 300, 500], 900)).toBe(3);
    expect(pointerIndex([100, Number.POSITIVE_INFINITY], 900)).toBe(1); // a card not measured yet doesn't count
  });

  it("moves an id within the order, clamped at both ends", () => {
    expect(moveInOrder(["a", "b", "c", "d"], "b", 2)).toEqual(["a", "c", "b", "d"]);
    expect(moveInOrder(["a", "b", "c"], "c", -5)).toEqual(["c", "a", "b"]);
    expect(moveInOrder(["a", "b", "c"], "a", 99)).toEqual(["b", "c", "a"]);
  });
});
