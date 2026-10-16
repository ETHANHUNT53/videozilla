import type { Language } from "./schema";

/** Frames of silence before each scene's voiceover starts (shared by the timeline builder and the video). */
export const LEAD_IN_FRAMES = 5;

/** Target narration length in words, per language and video length (PRD §15.2). */
export const WORD_BUDGET: Record<Language, Record<60 | 90, [number, number]>> = {
  en: { 60: [125, 150], 90: [190, 225] },
  hi: { 60: [115, 140], 90: [175, 210] },
};

/** Semantic accent colours for headline beats: cyan = normal/good, orange = problem, violet = system, green = growth. */
export type AccentName = "cyan" | "orange" | "violet" | "green";
export const ACCENT_NAMES: AccentName[] = ["cyan", "orange", "violet", "green"];

/** One spoken word with its timing inside a scene's audio. */
export interface WordTiming {
  text: string;
  startMs: number;
  endMs: number;
}
