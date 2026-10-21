import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RawStoryboard, type Scene } from "@videozilla/schema";
import { describe, expect, it } from "vitest";
import { clock, estimatedAudio, estimateTimeline, onScreenText, sceneTimeline, stillFrame } from "./estimate";
import { validateStoryboard } from "./validate";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../schema/fixtures");
const load = (file: string, language: "en" | "hi") => validateStoryboard(RawStoryboard.parse(JSON.parse(readFileSync(path.join(FIXTURES, file), "utf8"))), language, 60).storyboard;

describe("estimatedAudio", () => {
  it("spreads the words evenly at 150 wpm (en) / 140 wpm (hi)", () => {
    const en = estimatedAudio("one two three four five", "en");
    expect(en.words.map((w) => w.startMs)).toEqual([0, 400, 800, 1200, 1600]);
    expect(en.durationMs).toBe(2000);
    expect(en.audioSrc).toBeNull();
    expect(estimatedAudio("एक दो तीन", "hi").durationMs).toBe(Math.round((3 * 60000) / 140));
  });
});

describe("estimateTimeline", () => {
  it("times every scene back to back and resolves cues to their anchor words", () => {
    const sb = load("sky-blue.en.json", "en");
    const { timeline, scenes } = estimateTimeline(sb, "midnight");
    expect(scenes).toHaveLength(sb.scenes.length);
    expect(scenes[0].startSec).toBe(0);
    for (let i = 1; i < scenes.length; i++) expect(scenes[i].startSec).toBeCloseTo(scenes[i - 1].endSec, 5);
    expect(timeline.styleId).toBe("midnight");
    expect(timeline.scenes.every((s) => s.audioSrc === null)).toBe(true);
    const words = sb.scenes.reduce((n, s) => n + s.narration.split(/\s+/).filter(Boolean).length, 0);
    expect(scenes.at(-1)!.endSec).toBeGreaterThan((words / 150) * 60);
  });

  it("a one-scene timeline starts at 0 and keeps that scene's headlines", () => {
    const sb = load("tech-demo.en.json", "en");
    const { timeline } = estimateTimeline(sb, "midnight");
    const one = sceneTimeline(timeline, 2);
    expect(one.scenes).toHaveLength(1);
    expect(one.scenes[0].from).toBe(0);
    expect(one.durationInFrames).toBe(timeline.scenes[2].durationInFrames);
    expect(one.headlines.every((h) => h.from >= 0 && h.to <= one.durationInFrames)).toBe(true);
    expect(one.headlines.length).toBeGreaterThan(0);
    expect(one.captions).toEqual([]);
    const still = stillFrame(one.scenes[0]);
    expect(still).toBeGreaterThan(0);
    expect(still).toBeLessThan(one.durationInFrames);
  });

  it("works for Hindi", () => {
    const { scenes } = estimateTimeline(load("photosynthesis.hi.json", "hi"), "midnight");
    expect(scenes.length).toBeGreaterThan(3);
  });
});

describe("clock", () => {
  it("formats seconds as mm:ss", () => {
    expect(clock(0)).toBe("00:00");
    expect(clock(7.4)).toBe("00:07");
    expect(clock(65)).toBe("01:05");
  });
});

describe("onScreenText", () => {
  const s = (type: Scene["type"], props: unknown, beats: Scene["beats"] = []) => onScreenText({ type, props, beats });
  it.each([
    ["TitleHook", { headline: "Why *blue*?", subline: "Not the sea" }, "Why blue? — Not the sea"],
    ["KeywordReveal", { keywords: [{ id: "k1", text: "Rayleigh" }, { id: "k2", text: "scatter" }] }, "Rayleigh · scatter"],
    ["BulletSteps", { title: "Steps", items: [{ id: "i1", text: "Cut" }, { id: "i2", text: "Cry" }] }, "Steps: Cut · Cry"],
    ["Flowchart", { nodes: [{ id: "n1", label: "Cut" }, { id: "n2", label: "Gas" }, { id: "n3", label: "Tears" }] }, "Cut → Gas → Tears"],
    ["Comparison", { left: { title: "Myth", points: [] }, right: { title: "Fact", points: [] } }, "Myth vs Fact"],
    ["StatCounter", { value: 70, suffix: "%", label: "of Earth is water" }, "70% of Earth is water"],
    ["RecapOutro", { points: [{ id: "p1", text: "Blue scatters" }], cta: "Follow for more" }, "Blue scatters — Follow for more"],
    ["Illustration", { title: "Water cycle", actors: [{ id: "a", kind: "sun", label: "Sun" }, { id: "b", kind: "cloud" }], flows: [{ id: "f", from: "a", to: "b", label: "Heat" }] }, "Water cycle · Sun · Heat"],
    ["UnitGrid", { total: 100, label: "online", states: [{ id: "g1", active: 50, note: "half" }] }, "online · half"],
  ] as const)("%s", (type, props, expected) => {
    expect(s(type, props)).toBe(expected);
  });

  it("puts the headline beats first, without accent marks, and drops repeats", () => {
    expect(s("TitleHook", { headline: "Why blue?" }, [{ headline: "Why *blue*?", accent: "cyan" }, { headline: "Light *splits*", accent: "orange" }])).toBe("Why blue? — Light splits");
  });
});
