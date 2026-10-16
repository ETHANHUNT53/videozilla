import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Language } from "@videozilla/schema";

/**
 * Duration fitting (PRD F6-FR10): keep videos inside their 60 / 90 second window by choosing the voice's speaking speed.
 * Each voice's real words-per-minute (at speed 1.0) is learned from past runs and cached, so the speed is usually right
 * on the first recording; if not, the voice step re-records once with a corrected speed.
 */

export const WINDOWS: Record<60 | 90, [number, number]> = { 60: [55, 65], 90: [80, 95] };
const DEFAULT_WPM: Record<Language, number> = { en: 150, hi: 140 };
/** ElevenLabs allows 0.7–1.2; stay in a range that still sounds natural. */
const MIN_SPEED = 0.85;
const MAX_SPEED = 1.18;
/** Silence the timeline adds around each scene's voice (lead-in + tail, see timeline.ts). */
export const SCENE_PADDING_SEC = 0.52;

type Stats = Record<string, { wpm: number; runs: number }>;

const clampSpeed = (s: number) => Math.min(MAX_SPEED, Math.max(MIN_SPEED, Math.round(s * 100) / 100));

export class VoiceStats {
  private constructor(
    private file: string,
    private stats: Stats,
  ) {}

  static async load(root: string): Promise<VoiceStats> {
    const file = path.join(root, ".cache", "voice-stats.json");
    try {
      return new VoiceStats(file, JSON.parse(await readFile(file, "utf8")));
    } catch {
      return new VoiceStats(file, {});
    }
  }

  wpm(key: string, language: Language): number {
    return this.stats[key]?.wpm ?? DEFAULT_WPM[language];
  }

  /** Records the measured rate, normalised to speed 1.0, as a running average. */
  async record(key: string, words: number, speechSec: number, speed: number) {
    if (speechSec <= 0) return;
    const measured = (words / speechSec) * 60 / speed;
    const prev = this.stats[key];
    const runs = (prev?.runs ?? 0) + 1;
    this.stats[key] = { wpm: prev ? prev.wpm + (measured - prev.wpm) / Math.min(runs, 5) : measured, runs };
    await mkdir(path.dirname(this.file), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.stats, null, 2));
  }
}

/** Speed that should make `words` of narration fill the middle of the target window. */
export function plannedSpeed(words: number, scenes: number, wpm: number, targetSec: 60 | 90): number {
  const [lo, hi] = WINDOWS[targetSec];
  const goalSpeech = (lo + hi) / 2 - scenes * SCENE_PADDING_SEC;
  const naturalSpeech = (words / wpm) * 60;
  return clampSpeed(naturalSpeech / goalSpeech);
}

/** If the recorded video misses its window, the speed to re-record at; otherwise null. */
export function correctedSpeed(videoSec: number, scenes: number, speed: number, targetSec: 60 | 90): number | null {
  const [lo, hi] = WINDOWS[targetSec];
  if (videoSec >= lo && videoSec <= hi) return null;
  const speech = videoSec - scenes * SCENE_PADDING_SEC;
  const goalSpeech = (lo + hi) / 2 - scenes * SCENE_PADDING_SEC;
  const next = clampSpeed(speed * (speech / goalSpeech));
  return Math.abs(next - speed) >= 0.03 ? next : null;
}
