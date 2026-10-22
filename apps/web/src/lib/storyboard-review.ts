/**
 * The Storyboard Review screen's data (F3.3): scene cards with their timing, chapter headings and on-screen text, and
 * the duration guard (PRD F3-FR9). Pure, so it can be unit-tested; components/storyboard-review.tsx renders it. Safe to
 * import from client components.
 */
import { clock, estimateTimeline, lengthLabel, onScreenText } from "@videozilla/pipeline";
import type { Storyboard, Timeline } from "@videozilla/schema";

/** The target window per length preset (PRD §15.2). */
export const DURATION_WINDOW: Record<60 | 90, [number, number]> = { 60: [55, 65], 90: [80, 95] };

const ROLE_LABEL: Record<string, string> = { hook: "Hook", explain: "Explain", example: "Example", recap: "Recap", outro: "Outro" };

export interface SceneCard {
  index: number;
  id: string;
  /** "S3 · EXPLAIN" */
  label: string;
  role: string;
  type: string;
  narration: string;
  onScreen: string;
  /** "~11s" */
  length: string;
  /** "00:07 – 00:18" */
  range: string;
  /** The chapter heading to show above this card (its chapter's first scene), else null. */
  chapterHeading: { index: number; headline: string; subhead?: string } | null;
}

export interface ReviewModel {
  timeline: Timeline;
  cards: SceneCard[];
  /** Outside the target window: which way, else null. */
  durationOff: "long" | "short" | null;
}

export function reviewModel(storyboard: Storyboard, styleId: string, estimatedDurationSec: number): ReviewModel {
  const { timeline, scenes } = estimateTimeline(storyboard, styleId);
  const cards = storyboard.scenes.map((s, i): SceneCard => {
    const t = scenes[i];
    const chapter = s.beat?.chapter;
    const startsChapter = chapter && storyboard.scenes[i - 1]?.beat?.chapter?.index !== chapter.index;
    return {
      index: i,
      id: s.id,
      label: `S${i + 1} · ${(ROLE_LABEL[s.role] ?? s.role).toUpperCase()}`,
      role: ROLE_LABEL[s.role] ?? s.role,
      type: s.type,
      narration: s.narration,
      onScreen: onScreenText(s),
      length: lengthLabel(t.durationSec),
      range: `${clock(t.startSec)} – ${clock(t.endSec)}`,
      chapterHeading: startsChapter ? { index: chapter.index, headline: chapter.headline, ...(chapter.subhead ? { subhead: chapter.subhead } : {}) } : null,
    };
  });
  const [lo, hi] = DURATION_WINDOW[storyboard.targetDurationSec];
  const durationOff = estimatedDurationSec > hi ? "long" : estimatedDurationSec < lo ? "short" : null;
  return { timeline, cards, durationOff };
}
