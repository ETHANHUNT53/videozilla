import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RawStoryboard } from "@videozilla/schema";
import { describe, expect, it } from "vitest";
import { validateStoryboard } from "./validate";

type RawScene = RawStoryboard["scenes"][number];

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../m0/fixtures");

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

const hook: RawScene = {
  role: "hook",
  narration: "Why is the sky blue? It is not reflecting the ocean at all.",
  type: "TitleHook",
  props: { headline: "Why is the sky *blue*?" },
  cues: [],
  beats: [{ headline: "Why is the sky *blue*?", accent: "cyan" }],
};
const outro: RawScene = {
  role: "outro",
  narration: "So the sky is blue because blue light scatters the most. Follow for more.",
  type: "RecapOutro",
  props: { points: [{ id: "p1", text: "Blue scatters most" }], cta: "Follow for more" },
  cues: [],
  beats: [{ headline: "Blue *scatters* most", accent: "green" }],
};

/** A three-scene storyboard with `middle` as the second scene. */
function board(middle: Partial<RawScene>): RawStoryboard {
  const scene: RawScene = {
    role: "explain",
    narration: "Sunlight looks white but it hides every colour of the rainbow inside it.",
    type: "KeywordReveal",
    props: { keywords: [{ id: "k1", text: "white light" }] },
    cues: [],
    beats: [{ headline: "Sunlight is *every* colour" }],
    ...middle,
  };
  return { title: "Sky", hook: "Why blue?", social: { caption: "", hashtags: [], coverText: "" }, scenes: [hook, scene, outro] };
}

const run = (middle: Partial<RawScene>) => validateStoryboard(board(middle), "en", 60);

describe("validateStoryboard: fixtures", () => {
  it.each(readdirSync(FIXTURES))("needs no repairs for the hand-written fixture %s", (file) => {
    const raw = RawStoryboard.parse(JSON.parse(readFileSync(path.join(FIXTURES, file), "utf8")));
    const { storyboard, report } = validateStoryboard(raw, file.includes(".hi.") ? "hi" : "en", 60);
    expect(report.repairs).toEqual([]);
    expect(storyboard.scenes.map((s) => s.id)).toEqual(raw.scenes.map((_, i) => `s${i + 1}`));
  });
});

describe("validateStoryboard: scene repairs", () => {
  it("replaces an unknown scene type with a KeywordReveal of the first words", () => {
    const { storyboard, report } = run({ type: "Hologram", props: {} });
    expect(storyboard.scenes[1].type).toBe("KeywordReveal");
    expect(storyboard.scenes[1].props).toEqual({ keywords: [{ id: "k1", text: "Sunlight looks white but" }] });
    expect(report.repairs).toEqual(['scene 2: unknown type "Hologram", replaced with KeywordReveal']);
  });

  it("replaces props that still fail the schema after coercion", () => {
    const { storyboard, report } = run({ type: "Flowchart", props: { nodes: [{ id: "n1", label: "only one" }] } });
    expect(storyboard.scenes[1].type).toBe("KeywordReveal");
    expect(report.repairs[0]).toMatch(/^scene 2: invalid Flowchart props \(nodes .*\), replaced with KeywordReveal$/);
  });

  it("trims long lists and gives string items ids", () => {
    const { storyboard, report } = run({ type: "BulletSteps", props: { items: ["one", "two", "three", "four", "five"] } });
    expect(storyboard.scenes[1].props.items.map((i: any) => i.id)).toEqual(["i1", "i2", "i3", "i4"]);
    expect(storyboard.scenes[1].props.items[0].text).toBe("one");
    expect(report.repairs).toEqual(["scene 2: trimmed items from 5 to 4"]);
  });

  it("fills missing ids on object items", () => {
    const { storyboard } = run({ type: "Flowchart", props: { nodes: [{ label: "Sun" }, { label: "Leaf" }] } });
    expect(storyboard.scenes[1].props.nodes.map((n: any) => n.id)).toEqual(["n1", "n2"]);
  });

  it("turns RecapOutro string points into objects", () => {
    const { storyboard } = run({ type: "RecapOutro", props: { points: ["Blue scatters", "Red travels"], cta: "Follow" } });
    expect(storyboard.scenes[1].props.points).toEqual([
      { id: "p1", text: "Blue scatters" },
      { id: "p2", text: "Red travels" },
    ]);
  });

  it("trims Comparison sides to 3 points", () => {
    const side = (title: string) => ({ title, points: ["a", "b", "c", "d"] });
    const { storyboard, report } = run({ type: "Comparison", props: { left: side("Day"), right: side("Sunset") } });
    expect(storyboard.scenes[1].props.left.points).toHaveLength(3);
    expect(report.repairs).toEqual(["scene 2: trimmed left points to 3", "scene 2: trimmed right points to 3"]);
  });

  it("converts a StatCounter value written as text", () => {
    const { storyboard, report } = run({ type: "StatCounter", props: { value: "₹1,200", label: "per month" } });
    expect(storyboard.scenes[1].props.value).toBe(1200);
    expect(report.repairs).toEqual(['scene 2: converted StatCounter value "₹1,200" to number']);
  });

  it("keeps Illustration actors inside the frame and drops flows to unknown objects", () => {
    const props = {
      title: "Water cycle",
      actors: [
        { id: "sun", kind: "sun", x: 120, y: 5, size: "xl" },
        { id: "sea", kind: "ocean", x: 50, y: 80 },
      ],
      flows: [
        { id: "f1", from: "sun", to: "sea.top" },
        { id: "f2", from: "sea", to: "moon" },
        { id: "f3", from: "left", to: "right" },
        { id: "f4", from: "left", to: "sea" },
      ],
    };
    const { storyboard, report } = run({ type: "Illustration", props });
    const out = storyboard.scenes[1].props;
    expect(out.actors[0]).toMatchObject({ x: 90, y: 24, size: "m" });
    expect(out.flows.map((f: any) => f.id)).toEqual(["f1", "f4"]);
    expect(report.repairs).toEqual(['scene 2: moved "sun" inside the frame', "scene 2: dropped flows that referenced unknown objects"]);
  });

  it("clamps UnitGrid totals, counts and unit", () => {
    const props = { total: 5000, unit: "tree", states: [{ active: 9000 }, { id: "x", active: -3 }] };
    const { storyboard } = run({ type: "UnitGrid", props });
    expect(storyboard.scenes[1].props).toMatchObject({
      total: 600,
      unit: "dot",
      states: [
        { id: "g1", active: 600 },
        { id: "x", active: 0 },
      ],
    });
  });

  it("does not change the raw input", () => {
    const raw = board({ type: "BulletSteps", props: { items: ["one", "two", "three", "four", "five"] } });
    const before = structuredClone(raw);
    validateStoryboard(raw, "en", 60);
    expect(raw).toEqual(before);
  });
});

describe("validateStoryboard: cues", () => {
  it("drops cues for targets the scene does not have", () => {
    const { storyboard, report } = run({ cues: [{ target: "k9", anchor: "white" }, { target: "k1", anchor: "white" }] });
    expect(storyboard.scenes[1].cues).toEqual([{ target: "k1", anchor: "white" }]);
    expect(report.repairs).toEqual(['scene 2: dropped cue for unknown target "k9"']);
  });

  it("keeps a cue whose anchor is not in the narration but warns (it will be fuzzy-matched)", () => {
    const { storyboard, report } = run({ cues: [{ target: "k1", anchor: "purple sky" }] });
    expect(storyboard.scenes[1].cues).toHaveLength(1);
    expect(report.warnings).toContain('scene 2: cue anchor "purple sky" not found verbatim in narration (will fuzzy-match)');
  });

  it("matches anchors ignoring case and punctuation", () => {
    const { report } = run({ cues: [{ target: "k1", anchor: "Rainbow, inside" }] });
    expect(report.warnings.some((w) => w.includes("cue anchor"))).toBe(false);
  });
});

describe("validateStoryboard: headline beats and sections", () => {
  it("defaults unknown accents to cyan and keeps at most 3 beats", () => {
    const beats = [{ headline: "A", accent: "pink" }, { headline: "B", accent: "orange" }, { headline: "C" }, { headline: "D" }];
    const { storyboard } = run({ beats });
    expect(storyboard.scenes[1].beats.map((b) => [b.headline, b.accent])).toEqual([
      ["A", "cyan"],
      ["B", "orange"],
      ["C", "cyan"],
    ]);
  });

  it("falls back to the first narration words when a scene has no beats", () => {
    const { storyboard, report } = run({ beats: [], narration: "Light bends, then light splits into colours." });
    expect(storyboard.scenes[1].beats).toEqual([{ headline: "Light bends, then light splits into", accent: "cyan" }]);
    expect(report.warnings).toContain('scene 2: no headline beats, used "Light bends, then light splits into"');
  });

  it("uses the TitleHook headline as the fallback beat for a hook", () => {
    const raw = board({});
    raw.scenes[0] = { ...hook, beats: undefined };
    const { storyboard } = validateStoryboard(raw, "en", 60);
    expect(storyboard.scenes[0].beats[0].headline).toBe("Why is the sky *blue*?");
  });

  it("strips a leading // from the section and falls back to the role", () => {
    expect(run({ section: "// the setup " }).storyboard.scenes[1].section).toBe("the setup");
    expect(run({ section: undefined }).storyboard.scenes[1].section).toBe("explain");
  });
});

describe("validateStoryboard: whole-storyboard checks", () => {
  it("warns when the first scene is not a hook or the last is not a RecapOutro", () => {
    const raw = board({});
    raw.scenes = [raw.scenes[1], raw.scenes[1], raw.scenes[1]];
    const { report } = validateStoryboard(raw, "en", 60);
    expect(report.warnings).toContain("first scene is not a hook");
    expect(report.warnings).toContain("last scene is not a RecapOutro");
  });

  it("warns about scenes with too few or too many words", () => {
    expect(run({ narration: "Too short." }).report.warnings).toContain("scene 2: 2 words of narration (target 8-35)");
    expect(run({ narration: words(41) }).report.warnings).toContain("scene 2: 41 words of narration (target 8-35)");
  });

  it("counts words, estimates duration and warns when far outside the word budget", () => {
    const { report } = run({});
    // 13 + 13 + 14 words; en speaks 150 wpm, plus 0.5 s per scene.
    expect(report.wordCount).toBe(40);
    expect(report.estimatedDurationSec).toBe(Math.round((40 / 150) * 60 + 1.5));
    expect(report.warnings).toContain("narration is 40 words; target 125-150");
  });

  it("does not warn about the budget within ±15 %", () => {
    // 27 words in hook + outro; 110 more makes 137, inside 125-150 for an English 60 s video.
    const { report } = run({ narration: words(110) });
    expect(report.warnings.some((w) => w.startsWith("narration is"))).toBe(false);
  });

  it("uses the Hindi budget and speaking rate for Hindi", () => {
    const { report } = validateStoryboard(board({}), "hi", 90);
    expect(report.estimatedDurationSec).toBe(Math.round((40 / 140) * 60 + 1.5));
    expect(report.warnings).toContain("narration is 40 words; target 175-210");
  });
});
