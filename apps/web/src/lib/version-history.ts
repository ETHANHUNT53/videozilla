/**
 * Storyboard version history on the page (F3.5): the row labels. Pure, so it can be unit-tested; safe to import from
 * client components.
 */
import { timeAgo } from "./status";

/** A row of `GET …/storyboard/versions`. */
export interface VersionSummaryResource {
  version: number;
  source: "generate" | "revision" | "manual_edit" | "restore" | "duplicate";
  changeSummary: string;
  createdAt: string;
  language: "en" | "hi";
  targetDurationSec: 60 | 90;
  sceneCount: number;
  isCurrent: boolean;
}

/** What made a version, in words ("Generated", "Regenerated", "Edited the cover text", …). */
export function versionSourceLabel(v: { source: string; changeSummary: string }): string {
  if (v.source === "generate") return v.changeSummary === "First storyboard" ? "Generated" : "Regenerated";
  if (v.source === "duplicate") return "Copied from another video";
  return v.changeSummary || "Changed";
}

/** "12 min ago", in the browser's time zone (the history opens in the browser only). */
export function versionWhen(iso: string, now: number): string {
  return timeAgo(iso, now, Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata");
}
