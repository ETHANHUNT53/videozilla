import { describe, expect, it } from "vitest";
import { cueTargetsFor, RawStoryboard, SCENE_PROPS, SCENE_TYPES } from "./index";

describe("RawStoryboard", () => {
  it("rejects a storyboard with fewer than 3 scenes", () => {
    const scene = { role: "hook", narration: "Hi", type: "TitleHook", props: {} };
    const result = RawStoryboard.safeParse({ title: "t", hook: "h", social: { caption: "", hashtags: [], coverText: "" }, scenes: [scene, scene] });
    expect(result.success).toBe(false);
  });

  it("defaults missing cues to an empty list", () => {
    const scene = { role: "hook", narration: "Hi", type: "TitleHook", props: {} };
    const parsed = RawStoryboard.parse({ title: "t", hook: "h", social: { caption: "", hashtags: [], coverText: "" }, scenes: [scene, scene, scene] });
    expect(parsed.scenes[0].cues).toEqual([]);
  });
});

describe("cueTargetsFor", () => {
  it("covers every scene type", () => {
    expect([...SCENE_TYPES].sort()).toEqual(Object.keys(SCENE_PROPS).sort());
    expect(SCENE_TYPES).toHaveLength(9);
  });

  it.each([
    ["TitleHook", { headline: "h" }, ["headline", "subline", "icon"]],
    ["KeywordReveal", { keywords: [{ id: "k1" }, { id: "k2" }] }, ["k1", "k2"]],
    ["BulletSteps", { items: [{ id: "i1" }, { id: "i2" }] }, ["title", "i1", "i2"]],
    ["Flowchart", { nodes: [{ id: "n1" }, { id: "n2" }] }, ["n1", "n2"]],
    ["Comparison", {}, ["left", "right"]],
    ["StatCounter", {}, ["value", "label"]],
    ["RecapOutro", { points: [{ id: "p1" }] }, ["p1", "cta"]],
    ["UnitGrid", { states: [{ id: "g1" }, { id: "g2" }] }, ["g1", "g2"]],
  ] as const)("%s exposes its element ids", (type, props, expected) => {
    expect(cueTargetsFor(type, props)).toEqual(expected);
  });

  it("Illustration exposes the title (when set), actors and flows", () => {
    const props = { title: "Water cycle", actors: [{ id: "sun" }, { id: "sea" }], flows: [{ id: "f1" }] };
    expect(cueTargetsFor("Illustration", props)).toEqual(["title", "sun", "sea", "f1"]);
    expect(cueTargetsFor("Illustration", { actors: [{ id: "sun" }] })).toEqual(["sun"]);
  });
});
