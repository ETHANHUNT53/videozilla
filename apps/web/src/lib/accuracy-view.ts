/**
 * What the Storyboard step shows about the accuracy check (F3.7): the chip's words, its tone, and which button it offers.
 * Kept free of React so it can be unit-tested. See docs/features/F3.7-accuracy-check.md.
 */
import type { StoryboardVersionResource } from "@/server/api/resources";

export type AccuracyState = StoryboardVersionResource["accuracy"];

export interface AccuracyChip {
  /** What the chip shows. */
  text: string;
  /** The same for screen readers, as a sentence. */
  spoken: string;
  tone: "warn" | "ok" | "muted";
  /** The button next to it ("Check now" / "Check again"), or null while a check runs. */
  action: "Check now" | "Check again" | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The chip for a version's check; `position` turns a scene id into its number on screen. */
export function accuracyChip(a: AccuracyState, position: (sceneId: string) => number): AccuracyChip {
  if (a.status === "pending") return { text: "Checking facts…", spoken: "Checking the facts in your script.", tone: "muted", action: null };
  if (a.status !== "done") return { text: "Facts not checked", spoken: "The facts haven't been checked.", tone: "warn", action: "Check now" };
  const changed = a.uncheckedSceneIds.map(position).filter((n) => n > 0).sort((x, y) => x - y);
  const changedText = changed.length === 0 ? "" : changed.length === 1 ? `scene ${changed[0]} changed` : `${changed.length} scenes changed`;
  const base = a.openCount > 0 ? plural(a.openCount, "claim to check", "claims to check") : "Facts checked ✓";
  const spokenBase =
    a.openCount > 0
      ? `${plural(a.openCount, "claim", "claims")} to check.`
      : a.dismissedCount > 0
        ? `No open claims (${a.dismissedCount} dismissed).`
        : "Facts checked, nothing flagged.";
  return {
    text: changedText ? `${base} · ${changedText}` : base,
    spoken: changedText ? `${spokenBase} ${changedText[0].toUpperCase()}${changedText.slice(1)} since the check.` : spokenBase,
    tone: a.openCount > 0 || changed.length > 0 ? "warn" : "ok",
    action: changed.length > 0 ? "Check now" : "Check again",
  };
}

/** The line read out when a check finishes (polite live region). */
export function accuracyAnnouncement(a: AccuracyState): string {
  if (a.status === "failed") return "The facts couldn't be checked. You can check them again.";
  if (a.status !== "done") return "";
  if (a.openCount > 0) return `Facts checked: ${plural(a.openCount, "claim", "claims")} to check.`;
  return a.dismissedCount > 0 ? `Facts checked: no open claims (${a.dismissedCount} dismissed).` : "Facts checked: nothing flagged.";
}
