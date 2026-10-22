import type { Scene, Storyboard } from "@videozilla/schema";
import { describe, expect, it } from "vitest";
import { carryAccuracy, newAccuracyFlags, sceneFactsText, sceneOnScreen, type AccuracyReport } from "./accuracy";

/** F3.7: how the accuracy report follows the storyboard to later versions (pure). */

const scene = (id: string, narration: string): Scene => ({
  id,
  role: "explain",
  section: "part",
  beats: [{ headline: `Headline ${id}`, accent: "cyan" }],
  narration,
  type: "KeywordReveal",
  props: { keywords: [{ id: "k1", text: `word ${id}` }] },
  cues: [],
  beat: { mood: "explain" },
});
const board = (scenes: Scene[]): Storyboard => ({ language: "en", targetDurationSec: 60, title: "Light", hook: "Why?", social: { caption: "c", hashtags: [], coverText: "c" }, scenes });
const flag = (id: string, sceneId: string, dismissed = false) => ({ id, sceneId, claim: "300,000 km", note: "Why.", kind: "number" as const, dismissed });
const done = (flags: AccuracyReport["flags"], unchecked: string[] = []): AccuracyReport => ({ status: "done", flags, uncheckedSceneIds: unchecked, startedAt: new Date(0), checkedAt: new Date(1) });

describe("carryAccuracy", () => {
  const before = board([scene("s1", "One."), scene("s2", "Light travels 300,000 km."), scene("s3", "Three.")]);

  it("keeps flags (dismissed too) on unchanged scenes; changed and new scenes wait for Check now; deleted ones drop out", () => {
    const after = board([scene("s1", "One, edited."), scene("s2", "Light travels 300,000 km."), scene("s4", "New.")]);
    const r = carryAccuracy(done([flag("f1", "s2", true), flag("f2", "s1"), flag("f3", "s3")]), before, after)!;
    expect(r.flags.map((f) => [f.id, f.dismissed])).toEqual([["f1", true]]);
    expect(r.uncheckedSceneIds).toEqual(["s1", "s4"]);
    expect(r.status).toBe("done");
  });

  it("scenes already waiting keep waiting; a moved scene isn't a change; on-screen text and headlines count", () => {
    const moved = board([before.scenes[2], before.scenes[0], before.scenes[1]]);
    expect(carryAccuracy(done([flag("f1", "s2")], ["s3"]), before, moved)!.uncheckedSceneIds).toEqual(["s3"]);
    const retitled = board([before.scenes[0], { ...before.scenes[1], beats: [{ headline: "New headline", accent: "cyan" }] }, before.scenes[2]]);
    expect(carryAccuracy(done([flag("f1", "s2")]), before, retitled)!.flags).toEqual([]);
  });

  it("a report that isn't done doesn't carry", () => {
    expect(carryAccuracy(null, before, before)).toBeNull();
    expect(carryAccuracy({ ...done([]), status: "pending" }, before, before)).toBeNull();
    expect(carryAccuracy({ ...done([]), status: "failed" }, before, before)).toBeNull();
  });
});

describe("newAccuracyFlags and scene text", () => {
  it("numbers the flags and keeps a dismissal for the same claim on the same scene", () => {
    const flags = newAccuracyFlags(
      [
        { sceneId: "s2", claim: "300,000  KM", note: "n", kind: "number" },
        { sceneId: "s3", claim: "300,000 km", note: "n", kind: "number" },
      ],
      done([flag("f7", "s2", true)]),
    );
    expect(flags.map((f) => [f.id, f.sceneId, f.dismissed])).toEqual([
      ["f1", "s2", true],
      ["f2", "s3", false],
    ]);
  });

  it("the text a claim can quote: narration, on-screen words, headlines", () => {
    const s = scene("s1", "Narration.");
    expect(sceneFactsText(s)).toContain("Narration.");
    expect(sceneFactsText(s)).toContain("word s1");
    expect(sceneOnScreen(s)).toContain("Headline s1");
    expect(sceneOnScreen(s)).toContain("word s1");
  });
});
