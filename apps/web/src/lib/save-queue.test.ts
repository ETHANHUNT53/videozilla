import { describe, expect, it, vi } from "vitest";
import { createSaveQueue } from "./save-queue";

/** The settings panel's save queue (F2.7 QA): presses during a save aren't lost, the newest value wins, one save at a time. */

type S = { lengthPreset: 60 | 90; boardOrExam: string | null; captionsEnabled: boolean; voiceGender: "male" | "female" };

function deferredSave() {
  const calls: Partial<S>[] = [];
  const resolvers: (() => void)[] = [];
  const save = vi.fn((changes: Partial<S>) => {
    calls.push(changes);
    return new Promise<void>((r) => resolvers.push(r));
  });
  const finishNext = async () => {
    resolvers.shift()?.();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { calls, save, finishNext };
}

describe("createSaveQueue", () => {
  it("two presses during a save: the first is saved, then the newest value (not dropped, not one request per press)", async () => {
    const { calls, save, finishNext } = deferredSave();
    const idle = vi.fn();
    const q = createSaveQueue<S>(save, idle);
    void q.push({ boardOrExam: "cbse" }); // ArrowDown
    void q.push({ boardOrExam: "icse" }); // ArrowDown again while CBSE saves
    void q.push({ boardOrExam: "state" }); // and again
    expect(calls).toEqual([{ boardOrExam: "cbse" }]);
    expect(q.waiting).toEqual({ boardOrExam: "state" });
    await finishNext();
    expect(calls).toEqual([{ boardOrExam: "cbse" }, { boardOrExam: "state" }]);
    expect(idle).not.toHaveBeenCalled();
    await finishNext();
    expect(idle).toHaveBeenCalledTimes(1);
    expect(q.busy).toBe(false);
  });

  it("Space twice on captions ends on the second value; different fields waiting go out together", async () => {
    const { calls, save, finishNext } = deferredSave();
    const q = createSaveQueue<S>(save);
    void q.push({ captionsEnabled: false });
    void q.push({ captionsEnabled: true });
    void q.push({ voiceGender: "male" });
    await finishNext();
    expect(calls[1]).toEqual({ captionsEnabled: true, voiceGender: "male" });
    await finishNext();
  });

  it("one save at a time, and a press after it's idle starts a new one", async () => {
    const { calls, save, finishNext } = deferredSave();
    const q = createSaveQueue<S>(save);
    void q.push({ lengthPreset: 90 });
    await finishNext();
    expect(q.busy).toBe(false);
    void q.push({ lengthPreset: 60 });
    expect(calls).toEqual([{ lengthPreset: 90 }, { lengthPreset: 60 }]);
    expect(save).toHaveBeenCalledTimes(2);
    await finishNext();
  });

  it("cancel() drops what's waiting; the running save still finishes", async () => {
    const { calls, save, finishNext } = deferredSave();
    const q = createSaveQueue<S>(save);
    void q.push({ lengthPreset: 90 });
    void q.push({ lengthPreset: 60 });
    q.cancel();
    await finishNext();
    expect(calls).toEqual([{ lengthPreset: 90 }]);
    expect(q.busy).toBe(false);
  });

  it("a save that throws drops what was waiting, and later presses save normally", async () => {
    const calls: Partial<S>[] = [];
    let fail = true;
    let release!: () => void;
    const q = createSaveQueue<S>(async (c) => {
      calls.push(c);
      if (fail) {
        fail = false;
        await new Promise<void>((r) => (release = r));
        throw new Error("network");
      }
    });
    const first = q.push({ lengthPreset: 90 });
    void q.push({ lengthPreset: 60 }); // waiting when the first save fails
    release();
    await expect(first).rejects.toThrow("network");
    expect(calls).toEqual([{ lengthPreset: 90 }]);
    await q.push({ boardOrExam: "neet" });
    expect(calls).toEqual([{ lengthPreset: 90 }, { boardOrExam: "neet" }]);
  });
});
