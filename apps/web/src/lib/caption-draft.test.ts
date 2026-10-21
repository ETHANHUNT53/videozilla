import { afterEach, describe, expect, it, vi } from "vitest";
import { keepCaptionDraft, takeCaptionDraft } from "./caption-draft";

/** F3.4 review: a caption edit refused with 412 is kept while the page loads the newer storyboard, then put back once. */

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("caption draft (kept across the reload after a 412)", () => {
  const draft = { caption: "मेरा कैप्शन ✨", hashtags: ["#विज्ञान", "#Science"], coverText: "Why the sky is blue" };

  it("is put back once, for the same video only", () => {
    vi.stubGlobal("sessionStorage", fakeStorage());
    keepCaptionDraft("p1", draft);
    expect(takeCaptionDraft("p2")).toBeNull();
    expect(takeCaptionDraft("p1")).toEqual(draft);
    expect(takeCaptionDraft("p1")).toBeNull();
  });

  it("ignores anything that isn't a caption draft, and works without storage", () => {
    const s = fakeStorage();
    vi.stubGlobal("sessionStorage", s);
    s.setItem("vz:caption-draft:p1", JSON.stringify({ caption: 1, hashtags: [], coverText: "x" }));
    expect(takeCaptionDraft("p1")).toBeNull();
    s.setItem("vz:caption-draft:p1", "{not json");
    expect(takeCaptionDraft("p1")).toBeNull();
    vi.stubGlobal("sessionStorage", undefined);
    expect(() => keepCaptionDraft("p1", draft)).not.toThrow();
    expect(takeCaptionDraft("p1")).toBeNull();
  });
});
