import { afterEach, describe, expect, it, vi } from "vitest";
import { keepSceneDraft, takeSceneDraft, type SceneDraft } from "./scene-draft";

/** F3.6 QA: a scene edit refused with 412 is kept while the page loads the newer storyboard, then put back once. */

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

describe("scene draft (kept across the reload after a 412)", () => {
  const draft: SceneDraft = { sceneId: "s3", narration: "धूप में सात रंग छिपे हैं।", type: "BulletSteps", props: { items: [{ id: "i1", text: "Light" }, { id: "i2", text: "Drops" }] }, headlines: ["Rainbow"] };

  it("is put back once, for the same video and a scene that's still there", () => {
    vi.stubGlobal("sessionStorage", fakeStorage());
    keepSceneDraft("p1", draft);
    expect(takeSceneDraft("p2", ["s3"])).toBeNull();
    expect(takeSceneDraft("p1", ["s1", "s2"])).toBeNull(); // the scene is gone (deleted in the other tab): kept for now
    expect(takeSceneDraft("p1", ["s1", "s3"])).toEqual(draft);
    expect(takeSceneDraft("p1", ["s3"])).toBeNull();
  });

  it("ignores anything that isn't a scene draft, and works without storage", () => {
    const s = fakeStorage();
    vi.stubGlobal("sessionStorage", s);
    s.setItem("vz:scene-draft:p1:s3", JSON.stringify({ ...draft, type: "Nope" }));
    expect(takeSceneDraft("p1", ["s3"])).toBeNull();
    s.setItem("vz:scene-draft:p1:s3", "{not json");
    expect(takeSceneDraft("p1", ["s3"])).toBeNull();
    s.setItem("vz:scene-draft:p1:s3", JSON.stringify({ ...draft, sceneId: "s9" }));
    expect(takeSceneDraft("p1", ["s3"])).toBeNull();
    vi.stubGlobal("sessionStorage", undefined);
    keepSceneDraft("p1", draft);
    expect(takeSceneDraft("p1", ["s3"])).toBeNull();
  });
});
