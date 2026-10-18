import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./api-client";
import { AutosaveQueue, type AutosaveState } from "./autosave";

type Saved = { rev: number; text: string };

/** A save whose promise each test settles by hand, recording what was sent. */
function setup(rev = 0) {
  const calls: { value: string; rev: number; keepalive: boolean; resolve: (r: Saved) => void; reject: (e: unknown) => void }[] = [];
  const states: AutosaveState<Saved>[] = [];
  const saved: Saved[] = [];
  const queue = new AutosaveQueue<string, Saved>({
    rev,
    save: (value, r, o) => new Promise((resolve, reject) => calls.push({ value, rev: r, keepalive: o.keepalive, resolve, reject })),
    onState: (s) => states.push(s),
    onSaved: (s) => saved.push(s),
    retryDelaysMs: [1_000, 3_000],
  });
  const last = () => states[states.length - 1];
  return { queue, calls, states, saved, last };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("AutosaveQueue", () => {
  it("saves 800 ms after the last change, once, with the latest text and the loaded rev", async () => {
    const { queue, calls, last } = setup(4);
    queue.change("h");
    await vi.advanceTimersByTimeAsync(500);
    queue.change("he");
    queue.change("hey");
    expect(last().status).toBe("pending");
    await vi.advanceTimersByTimeAsync(799);
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls.map((c) => [c.value, c.rev])).toEqual([["hey", 4]]);
    expect(last().status).toBe("saving");
    calls[0].resolve({ rev: 5, text: "hey" });
    await settle();
    expect(last().status).toBe("saved");
    expect(queue.hasUnsaved()).toBe(false);
  });

  it("keeps one save in flight; text typed meanwhile goes next, with the new rev", async () => {
    const { queue, calls, last, saved } = setup(0);
    queue.change("a");
    await vi.advanceTimersByTimeAsync(800);
    queue.change("ab");
    await vi.advanceTimersByTimeAsync(800); // debounce passed while the first save is still in flight
    expect(calls).toHaveLength(1);
    expect(queue.hasUnsaved()).toBe(true);
    calls[0].resolve({ rev: 1, text: "a" });
    await settle();
    expect(calls.map((c) => [c.value, c.rev])).toEqual([["a", 0], ["ab", 1]]);
    calls[1].resolve({ rev: 2, text: "ab" });
    await settle();
    expect(last().status).toBe("saved");
    expect(saved.map((s) => s.rev)).toEqual([1, 2]);
  });

  it("offline: says so, retries with backoff, and at once when back online", async () => {
    const { queue, calls, last } = setup();
    queue.change("x");
    await vi.advanceTimersByTimeAsync(800);
    calls[0].reject(new ApiClientError(0, "NETWORK", "Couldn't reach Videozilla."));
    await settle();
    expect(last().status).toBe("offline");
    expect(queue.hasUnsaved()).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(2);
    calls[1].reject(new ApiClientError(0, "NETWORK", "Couldn't reach Videozilla."));
    await settle();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(2); // second backoff is 3 s
    queue.retryNow(); // the browser's "online" event
    expect(calls).toHaveLength(3);
    calls[2].resolve({ rev: 1, text: "x" });
    await settle();
    expect(last().status).toBe("saved");
  });

  it("412: stops with the other tab's copy; keepMine saves over it with that copy's rev", async () => {
    const { queue, calls, last } = setup(0);
    queue.change("mine");
    await vi.advanceTimersByTimeAsync(800);
    calls[0].reject(new ApiClientError(412, "PRECONDITION_FAILED", "Changed in another tab.", [{ field: "If-Match", issue: "x", current: { rev: 7, text: "theirs" } }]));
    await settle();
    expect(last()).toMatchObject({ status: "conflict", conflict: { rev: 7, text: "theirs" } });
    queue.change("mine, more");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(1); // nothing is sent until the user chooses
    queue.keepMine();
    expect(calls.map((c) => [c.value, c.rev])[1]).toEqual(["mine, more", 7]);
  });

  it("412: loadLatest takes the other tab's copy and leaves nothing unsaved", async () => {
    const { queue, calls, last } = setup(0);
    queue.change("mine");
    await vi.advanceTimersByTimeAsync(800);
    calls[0].reject(new ApiClientError(412, "PRECONDITION_FAILED", "Changed.", [{ issue: "x", current: { rev: 7, text: "theirs" } }]));
    await settle();
    queue.loadLatest("theirs", 7);
    expect(last().status).toBe("saved");
    expect(queue.hasUnsaved()).toBe(false);
    queue.change("theirs!");
    await vi.advanceTimersByTimeAsync(800);
    expect(calls[1]).toMatchObject({ value: "theirs!", rev: 7 });
  });

  it("409 / 404: stops for good with the server's message", async () => {
    const { queue, calls, last } = setup();
    queue.change("x");
    await vi.advanceTimersByTimeAsync(800);
    calls[0].reject(new ApiClientError(409, "INVALID_STATE", "The idea can't be changed at this stage of the video."));
    await settle();
    expect(last()).toMatchObject({ status: "error", stopped: true, error: "The idea can't be changed at this stage of the video." });
    queue.change("y");
    queue.retryNow();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(1);
  });

  it("400: reports it, and the next change tries again", async () => {
    const { queue, calls, last } = setup();
    queue.change("x");
    await vi.advanceTimersByTimeAsync(800);
    calls[0].reject(new ApiClientError(400, "VALIDATION_FAILED", "Must be at most 200 characters"));
    await settle();
    expect(last()).toMatchObject({ status: "error", error: "Must be at most 200 characters" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toHaveLength(1);
    queue.change("ok");
    await vi.advanceTimersByTimeAsync(800);
    expect(calls).toHaveLength(2);
  });

  it("server trouble (5xx) is retried with backoff", async () => {
    const { queue, calls, last } = setup();
    queue.change("x");
    await vi.advanceTimersByTimeAsync(800);
    calls[0].reject(new ApiClientError(503, "UNAVAILABLE", "Try again in a moment."));
    await settle();
    expect(last()).toMatchObject({ status: "error", error: "Try again in a moment." });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toHaveLength(2);
  });

  it("flush saves at once (tab hidden); nothing to flush sends nothing", async () => {
    const { queue, calls } = setup();
    queue.flush();
    expect(calls).toHaveLength(0);
    queue.change("x");
    queue.flush();
    expect(calls).toHaveLength(1);
  });

  it("resumes after dispose (React's development double mount) and saves what's still unsaved", async () => {
    const { queue, calls } = setup();
    queue.dispose();
    queue.resume();
    queue.change("x");
    await vi.advanceTimersByTimeAsync(800);
    expect(calls).toHaveLength(1);
    queue.change("y");
    queue.dispose();
    queue.resume();
    calls[0].resolve({ rev: 1, text: "x" });
    await settle();
    await vi.advanceTimersByTimeAsync(800);
    expect(calls.map((c) => c.value)).toEqual(["x", "y"]);
  });

  it("leaving while a save is in flight still sends what was typed after it (no lost update)", async () => {
    const { queue, calls } = setup(0);
    queue.change("photosynthesis");
    await vi.advanceTimersByTimeAsync(800); // save 1 in flight
    queue.change("photosynthesis for class 7");
    // The component unmounts (e.g. "← library"): its flush can't send while save 1 is in flight.
    queue.flush({ keepalive: true });
    queue.dispose();
    expect(calls).toHaveLength(1);
    calls[0].resolve({ rev: 1, text: "photosynthesis" });
    await settle();
    expect(calls.map((c) => [c.value, c.rev, c.keepalive])).toEqual([
      ["photosynthesis", 0, false],
      ["photosynthesis for class 7", 1, true],
    ]);
    calls[1].resolve({ rev: 2, text: "photosynthesis for class 7" });
    await settle();
    expect(queue.hasUnsaved()).toBe(false);
  });

  it("marks saves that must outlive the page as keepalive, and only those", async () => {
    const { queue, calls } = setup(0);
    queue.change("a");
    await vi.advanceTimersByTimeAsync(800);
    calls[0].resolve({ rev: 1, text: "a" });
    await settle();
    queue.change("ab");
    queue.flush({ keepalive: true }); // tab hidden
    calls[1].resolve({ rev: 2, text: "ab" });
    await settle();
    queue.change("abc");
    await vi.advanceTimersByTimeAsync(800);
    expect(calls.map((c) => c.keepalive)).toEqual([false, true, false]);
  });

  it("412 without the other copy stops with a reload message instead of a dead-end conflict", async () => {
    const { queue, calls, last } = setup(0);
    queue.change("a");
    await vi.advanceTimersByTimeAsync(800);
    calls[0].reject(new ApiClientError(412, "PRECONDITION_FAILED", "changed", []));
    await settle();
    expect(last()).toMatchObject({ status: "error", stopped: true });
    expect(last().error).toMatch(/Reload/);
  });

  it("does nothing after dispose", async () => {
    const { queue, calls } = setup();
    queue.change("x");
    queue.dispose();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toHaveLength(0);
  });

  describe("settle() (save now and wait, before an action that reads the saved copy)", () => {
    const watch = (p: Promise<boolean>) => {
      const out: { value?: boolean } = {};
      void p.then((v) => (out.value = v));
      return out;
    };

    it("is true at once when there is nothing to save", async () => {
      const { queue, calls } = setup();
      const done = watch(queue.settle());
      await settle();
      expect(done.value).toBe(true);
      expect(calls).toHaveLength(0);
    });

    it("sends pending typing without waiting for the debounce, and resolves once the server has it", async () => {
      const { queue, calls } = setup();
      queue.change("idea");
      const done = watch(queue.settle());
      expect(calls.map((c) => c.value)).toEqual(["idea"]);
      await settle();
      expect(done.value).toBeUndefined();
      calls[0].resolve({ rev: 1, text: "idea" });
      await settle();
      expect(done.value).toBe(true);
    });

    it("waits for a save in flight and for the text typed meanwhile", async () => {
      const { queue, calls } = setup();
      queue.change("a");
      await vi.advanceTimersByTimeAsync(800);
      queue.change("ab");
      const done = watch(queue.settle());
      calls[0].resolve({ rev: 1, text: "a" });
      await settle();
      expect(done.value).toBeUndefined();
      expect(calls.map((c) => c.value)).toEqual(["a", "ab"]);
      calls[1].resolve({ rev: 2, text: "ab" });
      await settle();
      expect(done.value).toBe(true);
    });

    it("is false when the save can't get through (offline, or another tab changed the idea)", async () => {
      const offline = setup();
      offline.queue.change("x");
      const a = watch(offline.queue.settle());
      offline.calls[0].reject(new ApiClientError(0, "NETWORK", "Couldn't reach Videozilla."));
      await settle();
      expect(a.value).toBe(false);

      const conflict = setup();
      conflict.queue.change("mine");
      const b = watch(conflict.queue.settle());
      conflict.calls[0].reject(new ApiClientError(412, "PRECONDITION_FAILED", "Changed.", [{ issue: "x", current: { rev: 3, text: "theirs" } }]));
      await settle();
      expect(b.value).toBe(false);
      // While the conflict is open nothing is sent, and settle() says so at once.
      const c = watch(conflict.queue.settle());
      await settle();
      expect(c.value).toBe(false);
    });
  });
});
