import type { Scene, Storyboard, WordTiming } from "@videozilla/schema";
import { describe, expect, it } from "vitest";
import { buildTimeline, FPS, LEAD_IN_FRAMES, type SceneAudio } from "./timeline";

/** Word timings at a steady pace: each word starts `stepMs` after the previous one and lasts `stepMs - 50`. */
function timed(text: string, stepMs = 400): WordTiming[] {
  return text.split(" ").map((w, i) => ({ text: w, startMs: i * stepMs, endMs: i * stepMs + stepMs - 50 }));
}

const NARRATION = "Sunlight looks white but it hides every colour of the rainbow";
// 11 words at 400 ms; 4450 ms of audio → 5 lead-in + round((4450 + 350 tail) ms × 30 fps) = 149 frames.
const AUDIO: SceneAudio = { audioSrc: "s1.mp3", durationMs: 4450, words: timed(NARRATION) };
const SCENE_FRAMES = 149;

function scene(over: Partial<Scene> = {}): Scene {
  return {
    id: "s1",
    role: "explain",
    section: "the setup",
    beats: [{ headline: "Sunlight is *every* colour", accent: "cyan" }],
    narration: NARRATION,
    type: "KeywordReveal",
    props: { keywords: [{ id: "k1", text: "white" }, { id: "k2", text: "rainbow" }, { id: "k3", text: "hidden" }] },
    cues: [],
    beat: { mood: "explain", chapter: { index: 1, headline: "the setup" } },
    ...over,
  };
}

function board(scenes: Scene[]): Storyboard {
  return { language: "en", targetDurationSec: 60, title: "Sky", hook: "Why blue?", social: { caption: "", hashtags: [], coverText: "" }, scenes };
}

const build = (scenes: Scene[], audios: SceneAudio[]) => buildTimeline(board(scenes), audios, "midnight");

/** Frame a cue lands on: lead-in + word start − 3 frames of lead. */
const cueFrame = (wordIndex: number, stepMs = 400) => LEAD_IN_FRAMES + Math.round((wordIndex * stepMs * FPS) / 1000) - 3;

describe("buildTimeline: scenes", () => {
  it("lays scenes back to back with lead-in and tail padding", () => {
    const { timeline, report } = build([scene(), scene({ id: "s2" })], [AUDIO, { ...AUDIO, audioSrc: "s2.mp3" }]);
    expect(timeline.scenes.map((s) => [s.id, s.from, s.durationInFrames, s.audioSrc])).toEqual([
      ["s1", 0, SCENE_FRAMES, "s1.mp3"],
      ["s2", SCENE_FRAMES, SCENE_FRAMES, "s2.mp3"],
    ]);
    expect(timeline).toMatchObject({ fps: 30, width: 1080, height: 1920, durationInFrames: 2 * SCENE_FRAMES, styleId: "midnight", language: "en" });
    expect(report.durationSec).toBe(9.9);
  });
});

describe("buildTimeline: cue sync", () => {
  it("lands an exact anchor 3 frames before its first word is spoken", () => {
    const { timeline, report } = build([scene({ cues: [{ target: "k1", anchor: "hides every" }] })], [AUDIO]);
    expect(timeline.scenes[0].cueFrames.k1).toBe(cueFrame(5));
    expect(report.cues[0]).toMatchObject({ sceneId: "s1", target: "k1", anchor: "hides every", method: "exact" });
  });

  it("matches anchors regardless of case and punctuation", () => {
    const audio = { ...AUDIO, words: timed("Sunlight looks white, but it HIDES every colour of the rainbow.") };
    const { report } = build([scene({ cues: [{ target: "k1", anchor: "hides every" }] })], [audio]);
    expect(report.cues[0].method).toBe("exact");
  });

  it("fuzzy-matches a slightly different spoken word", () => {
    const { timeline, report } = build([scene({ cues: [{ target: "k2", anchor: "rainbo" }] })], [AUDIO]);
    expect(report.cues.find((c) => c.target === "k2")?.method).toBe("fuzzy");
    expect(timeline.scenes[0].cueFrames.k2).toBe(cueFrame(10));
  });

  it("honours `occurrence` for repeated words", () => {
    const text = "light bends and then light splits into colours";
    const audio = { ...AUDIO, words: timed(text) };
    const cues = [
      { target: "k1", anchor: "light" },
      { target: "k2", anchor: "light", occurrence: 2 },
    ];
    const { timeline } = build([scene({ narration: text, cues })], [audio]);
    expect(timeline.scenes[0].cueFrames.k1).toBe(cueFrame(0));
    expect(timeline.scenes[0].cueFrames.k2).toBe(cueFrame(4));
  });

  it("places an anchor that was not spoken by its position in the narration text", () => {
    // The voice says "ten" where the script says "10", so the words never match.
    const narration = "It takes 10 minutes";
    const audio: SceneAudio = { audioSrc: null, durationMs: 2000, words: timed("It takes ten minutes", 500) };
    const { timeline, report } = build([scene({ narration, cues: [{ target: "k1", anchor: "10 minutes" }] })], [audio]);
    expect(report.cues[0].method).toBe("proportional");
    // "10 minutes" starts at character 9 of 19 → 9/19 × 2000 ms ≈ 947 ms ≈ 28 frames, after the 5-frame lead-in.
    expect(timeline.scenes[0].cueFrames.k1).toBe(LEAD_IN_FRAMES + 28);
  });

  it("staggers elements without a cue across the first 70 % of the narration", () => {
    const { timeline, report } = build([scene({ cues: [{ target: "k1", anchor: "white" }] })], [AUDIO]);
    expect(report.counts).toEqual({ exact: 1, fuzzy: 0, proportional: 0, default: 2 });
    // k2 is target 1 of 3: 1/3 × 0.7 × 4450 ms ≈ 1038 ms ≈ 31 frames; k3: 2/3 × … ≈ 62 frames.
    expect(timeline.scenes[0].cueFrames).toEqual({ k1: cueFrame(2), k2: LEAD_IN_FRAMES + 31, k3: LEAD_IN_FRAMES + 62 });
  });

  it("gives every cue target of the scene a frame", () => {
    const { timeline } = build([scene({ type: "TitleHook", props: { headline: "Why?" } })], [AUDIO]);
    expect(Object.keys(timeline.scenes[0].cueFrames)).toEqual(["headline", "subline", "icon"]);
  });
});

describe("buildTimeline: headline beats", () => {
  it("starts the first beat with the scene and later beats on their anchor words", () => {
    const beats = [
      { headline: "Sunlight looks *white*", accent: "cyan" },
      { headline: "It hides *every* colour", anchor: "every colour", accent: "orange" },
      { headline: "The whole *rainbow*", anchor: "rainbow", accent: "green" },
    ];
    const { timeline } = build([scene({ beats })], [AUDIO]);
    expect(timeline.headlines).toEqual([
      { from: 0, to: cueFrame(6), text: "Sunlight looks *white*", accent: "cyan", section: "the setup" },
      { from: cueFrame(6), to: cueFrame(10), text: "It hides *every* colour", accent: "orange", section: "the setup" },
      { from: cueFrame(10), to: SCENE_FRAMES, text: "The whole *rainbow*", accent: "green", section: "the setup" },
    ]);
  });

  it("keeps each beat on screen for at least a second", () => {
    const beats = [{ headline: "A" }, { headline: "B", anchor: "hides" }, { headline: "C", anchor: "every" }];
    const { timeline } = build([scene({ beats })], [AUDIO]);
    expect(timeline.headlines.map((h) => h.from)).toEqual([0, cueFrame(5), cueFrame(5) + 30]);
  });

  it("spreads beats without a matching anchor evenly and offsets them by the scene start", () => {
    const beats = [{ headline: "A" }, { headline: "B" }];
    const { timeline } = build([scene(), scene({ id: "s2", beats })], [AUDIO, AUDIO]);
    const second = timeline.headlines.slice(1);
    expect(second.map((h) => [h.text, h.from, h.to])).toEqual([
      ["A", SCENE_FRAMES, SCENE_FRAMES + Math.round(SCENE_FRAMES / 2)],
      ["B", SCENE_FRAMES + Math.round(SCENE_FRAMES / 2), 2 * SCENE_FRAMES],
    ]);
  });

  it("defaults a missing accent to cyan", () => {
    const { timeline } = build([scene({ beats: [{ headline: "A" }] })], [AUDIO]);
    expect(timeline.headlines[0].accent).toBe("cyan");
  });
});

describe("buildTimeline: captions", () => {
  const caption = (text: string, stepMs = 300) => build([scene({ narration: text })], [{ audioSrc: null, durationMs: 9000, words: timed(text, stepMs) }]);
  const phrases = (text: string, stepMs?: number) => caption(text, stepMs).timeline.captions.map((p) => p.words.map((w) => w.text).join(" "));

  it("starts a new phrase after a sentence ends", () => {
    expect(phrases("Light bends here. Then it splits")).toEqual(["Light bends here.", "Then it splits"]);
  });

  it("keeps a phrase within two caption lines (40 characters in English)", () => {
    const out = phrases("Rayleigh scattering makes shorter wavelengths bounce around the atmosphere much more");
    expect(out.length).toBeGreaterThan(1);
    for (const p of out) expect(p.length).toBeLessThanOrEqual(40);
  });

  it("starts a new phrase after a pause longer than 450 ms", () => {
    const words = [...timed("Sunlight looks white"), { text: "but", startMs: 2000, endMs: 2200 }];
    const { timeline } = build([scene()], [{ audioSrc: null, durationMs: 3000, words }]);
    expect(timeline.captions.map((p) => p.words.length)).toEqual([3, 1]);
  });

  it("never overlaps one phrase with the next and offsets word frames by the lead-in", () => {
    const { timeline } = caption("One two three. Four five six. Seven eight nine.", 150);
    expect(timeline.captions[0].words[0].from).toBe(LEAD_IN_FRAMES);
    for (let i = 0; i < timeline.captions.length - 1; i++) {
      expect(timeline.captions[i].to).toBeLessThanOrEqual(timeline.captions[i + 1].from);
    }
  });
});
