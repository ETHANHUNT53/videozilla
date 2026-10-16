import {
  cueTargetsFor,
  LEAD_IN_FRAMES,
  type CaptionPhrase, type CaptionWord, type Cue, type HeadlineBeat, type Scene, type Storyboard, type Timeline, type TimelineScene,
  type WordTiming,
} from "@videozilla/schema";
import { normalizeToken, similarity, tokenize } from "./text";

export { LEAD_IN_FRAMES };

export const FPS = 30;
const TAIL_MS = 350;
/** Visuals appear this many frames before the anchor word is spoken. */
const CUE_LEAD_FRAMES = 3;
const MATCH_THRESHOLD = 0.8;

const msToFrames = (ms: number) => Math.round((ms / 1000) * FPS);

export interface SceneAudio {
  audioSrc: string | null;
  durationMs: number;
  words: WordTiming[];
}

export type CueMethod = "exact" | "fuzzy" | "proportional" | "default";

export interface SyncReport {
  cues: { sceneId: string; target: string; anchor: string; method: CueMethod; frame: number }[];
  counts: Record<CueMethod, number>;
  durationSec: number;
}

/** Finds the word index where the anchor phrase starts, honoring `occurrence`. */
function findAnchor(anchor: string, words: WordTiming[], occurrence = 1): { index: number; method: CueMethod } | null {
  const a = tokenize(anchor).map(normalizeToken);
  const w = words.map((x) => normalizeToken(x.text));
  if (!a.length) return null;

  // Exact (or near-exact per token) phrase match.
  let seen = 0;
  for (let i = 0; i + a.length <= w.length; i++) {
    const exact = a.every((tok, k) => w[i + k] === tok);
    const fuzzy = exact || a.every((tok, k) => similarity(w[i + k], tok) >= MATCH_THRESHOLD);
    if (fuzzy && ++seen === occurrence) return { index: i, method: exact ? "exact" : "fuzzy" };
  }
  // Single best match on the first anchor token.
  let best = { index: -1, score: 0 };
  w.forEach((tok, i) => {
    const s = similarity(tok, a[0]);
    if (s > best.score) best = { index: i, score: s };
  });
  if (best.score >= 0.7) return { index: best.index, method: "fuzzy" };
  return null;
}

function resolveCues(scene: Scene, audio: SceneAudio, durationInFrames: number, report: SyncReport): Record<string, number> {
  const leadInFrames = LEAD_IN_FRAMES;
  const lastUsable = Math.max(leadInFrames, durationInFrames - 12);
  const clamp = (f: number) => Math.min(Math.max(f, 0), lastUsable);
  const cueFrames: Record<string, number> = {};
  const byTarget = new Map<string, Cue>(scene.cues.map((c) => [c.target, c]));
  const targets = cueTargetsFor(scene.type, scene.props);

  targets.forEach((target, i) => {
    const cue = byTarget.get(target);
    let frame: number;
    let method: CueMethod;
    if (cue) {
      const hit = findAnchor(cue.anchor, audio.words, cue.occurrence);
      if (hit) {
        frame = LEAD_IN_FRAMES + msToFrames(audio.words[hit.index].startMs) - CUE_LEAD_FRAMES;
        method = hit.method;
      } else {
        // Position the cue by where the anchor sits in the narration text.
        const pos = scene.narration.toLowerCase().indexOf(cue.anchor.toLowerCase());
        const ratio = pos >= 0 ? pos / scene.narration.length : i / targets.length;
        frame = LEAD_IN_FRAMES + msToFrames(ratio * audio.durationMs);
        method = "proportional";
      }
    } else {
      // No cue: stagger elements across the first 70% of the narration.
      frame = LEAD_IN_FRAMES + msToFrames((i / targets.length) * 0.7 * audio.durationMs);
      method = "default";
    }
    cueFrames[target] = clamp(frame);
    report.counts[method]++;
    report.cues.push({ sceneId: scene.id, target, anchor: cue?.anchor ?? "", method, frame: cueFrames[target] });
  });
  return cueFrames;
}

/** Groups words into caption phrases of at most two short lines. */
function buildCaptions(words: CaptionWord[], language: Storyboard["language"]): CaptionPhrase[] {
  // Two lines of the caption band at caption font size (see Captions.tsx).
  const maxChars = (language === "hi" ? 17 : 20) * 2;
  const phrases: CaptionPhrase[] = [];
  let current: CaptionWord[] = [];
  let chars = 0;

  const flush = () => {
    if (!current.length) return;
    phrases.push({ from: current[0].from, to: current[current.length - 1].to + 4, words: current });
    current = [];
    chars = 0;
  };

  for (const word of words) {
    const prev = current[current.length - 1];
    const gap = prev ? word.from - prev.to : 0;
    const endsSentence = prev ? /[.!?।]$/.test(prev.text) : false;
    if (current.length && (chars + word.text.length + 1 > maxChars || gap > msToFrames(450) || (endsSentence && current.length >= 2))) {
      flush();
    }
    current.push(word);
    chars += word.text.length + 1;
  }
  flush();

  // Never let one phrase overlap the next.
  for (let i = 0; i < phrases.length - 1; i++) {
    phrases[i].to = Math.min(phrases[i].to, phrases[i + 1].from);
  }
  return phrases;
}

/** Times each headline beat: the first starts with the scene, later ones when their anchor words are spoken. */
function resolveBeats(scene: Scene, audio: SceneAudio, sceneFrom: number, durationInFrames: number): HeadlineBeat[] {
  const starts = scene.beats.map((beat, i) => {
    if (i === 0) return sceneFrom;
    const hit = beat.anchor ? findAnchor(beat.anchor, audio.words, beat.occurrence) : null;
    const local = hit
      ? LEAD_IN_FRAMES + msToFrames(audio.words[hit.index].startMs) - CUE_LEAD_FRAMES
      : Math.round((i / scene.beats.length) * durationInFrames);
    return sceneFrom + Math.min(Math.max(local, 20), durationInFrames - 20);
  });
  // Keep beats in order and on screen for at least a second.
  for (let i = 1; i < starts.length; i++) starts[i] = Math.max(starts[i], starts[i - 1] + 30);
  return scene.beats.map((beat, i) => ({
    from: starts[i],
    to: i + 1 < starts.length ? starts[i + 1] : sceneFrom + durationInFrames,
    text: beat.headline,
    accent: beat.accent ?? "cyan",
    section: scene.section ?? "",
  }));
}

export function buildTimeline(storyboard: Storyboard, audios: SceneAudio[], styleId: string): { timeline: Timeline; report: SyncReport } {
  const report: SyncReport = { cues: [], counts: { exact: 0, fuzzy: 0, proportional: 0, default: 0 }, durationSec: 0 };
  const scenes: TimelineScene[] = [];
  const captionWords: CaptionWord[] = [];
  const headlines: HeadlineBeat[] = [];
  let cursor = 0;

  storyboard.scenes.forEach((scene, i) => {
    const audio = audios[i];
    const durationInFrames = LEAD_IN_FRAMES + msToFrames(audio.durationMs + TAIL_MS);
    const cueFrames = resolveCues(scene, audio, durationInFrames, report);
    headlines.push(...resolveBeats(scene, audio, cursor, durationInFrames));

    for (const w of audio.words) {
      captionWords.push({
        text: w.text,
        from: cursor + LEAD_IN_FRAMES + msToFrames(w.startMs),
        to: cursor + LEAD_IN_FRAMES + msToFrames(w.endMs),
      });
    }

    scenes.push({
      id: scene.id,
      type: scene.type,
      role: scene.role,
      props: scene.props,
      from: cursor,
      durationInFrames,
      audioSrc: audio.audioSrc,
      cueFrames,
    });
    cursor += durationInFrames;
  });

  report.durationSec = Math.round((cursor / FPS) * 10) / 10;
  return {
    timeline: {
      fps: FPS,
      width: 1080,
      height: 1920,
      durationInFrames: cursor,
      language: storyboard.language,
      styleId,
      title: storyboard.title,
      scenes,
      captions: buildCaptions(captionWords, storyboard.language),
      headlines,
    },
    report,
  };
}
