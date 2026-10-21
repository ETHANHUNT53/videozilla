/* eslint-disable @typescript-eslint/no-explicit-any -- scene props differ per scene type (see schema.ts). */
import type { Language, Scene, Storyboard, Timeline, TimelineScene, WordTiming } from "@videozilla/schema";
import { tokenize } from "./text";
import { buildTimeline, FPS, type SceneAudio } from "./timeline";

/**
 * Placeholder timing for the storyboard screen (PRD F3-FR3, F3.3): the timeline the video will roughly have, before any
 * voice is recorded. Each scene's words are spread evenly at the language's speaking rate (the validator's estimate),
 * then the real timeline builder runs, so cues land on their anchor words as they will once the voice exists.
 */

export const ESTIMATE_WPM: Record<Language, number> = { en: 150, hi: 140 };

/** Evenly timed words for one narration, as a recording at `wpm` would roughly give. */
export function estimatedAudio(narration: string, language: Language): SceneAudio {
  const msPerWord = 60_000 / ESTIMATE_WPM[language];
  const words: WordTiming[] = tokenize(narration).map((text, i) => ({ text, startMs: Math.round(i * msPerWord), endMs: Math.round((i + 0.85) * msPerWord) }));
  return { audioSrc: null, durationMs: Math.max(1000, Math.round(words.length * msPerWord)), words };
}

export interface SceneTiming {
  id: string;
  startSec: number;
  endSec: number;
  durationSec: number;
}

/** The estimated timeline and each scene's start, end and length in seconds. */
export function estimateTimeline(storyboard: Storyboard, styleId: string): { timeline: Timeline; scenes: SceneTiming[] } {
  const { timeline } = buildTimeline(storyboard, storyboard.scenes.map((s) => estimatedAudio(s.narration, storyboard.language)), styleId);
  const scenes = timeline.scenes.map((s) => ({
    id: s.id,
    startSec: s.from / FPS,
    endSec: (s.from + s.durationInFrames) / FPS,
    durationSec: s.durationInFrames / FPS,
  }));
  return { timeline, scenes };
}

/** A timeline with only the scene at `index`, starting at frame 0 (a card's preview): its headlines move with it. */
export function sceneTimeline(timeline: Timeline, index: number): Timeline {
  const scene = timeline.scenes[index];
  const end = scene.from + scene.durationInFrames;
  return {
    ...timeline,
    durationInFrames: scene.durationInFrames,
    scenes: [{ ...scene, from: 0, audioSrc: null }],
    captions: [],
    headlines: (timeline.headlines ?? []).filter((h) => h.from >= scene.from && h.from < end).map((h) => ({ ...h, from: h.from - scene.from, to: Math.min(h.to, end) - scene.from })),
  };
}

/** The frame a still preview shows: everything cued in, just before the scene fades out. */
export function stillFrame(scene: TimelineScene): number {
  const lastCue = Math.max(0, ...Object.values(scene.cueFrames));
  return Math.min(scene.durationInFrames - 8, Math.max(lastCue + 15, Math.round(scene.durationInFrames * 0.6)));
}

/** "00:07" */
export function clock(sec: number): string {
  const s = Math.round(sec);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const plain = (t: unknown) => String(t ?? "").replace(/\*/g, "").trim();
const labels = (list: unknown, key = "text") => (Array.isArray(list) ? list.map((x: any) => plain(typeof x === "string" ? x : x?.[key] ?? x?.label)).filter(Boolean) : []);

/**
 * What a scene shows as text (F3.3 "// on screen:"): its headline beats (without the *accent* marks), then the labels in
 * its props. Never the narration.
 */
export function onScreenText(scene: Pick<Scene, "type" | "props" | "beats">): string {
  const p: any = scene.props ?? {};
  let fromProps: string[];
  switch (scene.type) {
    case "TitleHook":
      fromProps = [plain(p.headline), plain(p.subline)].filter(Boolean);
      break;
    case "KeywordReveal":
      fromProps = [labels(p.keywords).join(" · ")];
      break;
    case "BulletSteps":
      fromProps = [[plain(p.title), labels(p.items).join(" · ")].filter(Boolean).join(": ")];
      break;
    case "Flowchart":
      fromProps = [labels(p.nodes, "label").join(" → ")];
      break;
    case "Comparison":
      fromProps = [`${plain(p.left?.title)} vs ${plain(p.right?.title)}`];
      break;
    case "StatCounter":
      fromProps = [`${plain(p.prefix)}${p.value ?? ""}${plain(p.suffix)} ${plain(p.label)}`.trim()];
      break;
    case "RecapOutro":
      fromProps = [labels(p.points).join(" · "), plain(p.cta)];
      break;
    case "Illustration":
      fromProps = [[plain(p.title), ...labels(p.actors, "label"), ...labels(p.flows, "label")].filter(Boolean).join(" · ")];
      break;
    case "UnitGrid":
      fromProps = [[plain(p.label), ...labels(p.states, "note")].filter(Boolean).join(" · ")];
      break;
    default:
      fromProps = [];
  }
  const beats = (scene.beats ?? []).map((b) => plain(b.headline));
  const seen = new Set<string>();
  return [...beats, ...fromProps]
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .join(" — ");
}
