/** How each project status looks in the library (PRD F1-FR6). Safe to import from client components. */
export type ProjectStatus =
  | "idea_draft"
  | "storyboard_generating"
  | "storyboard_ready"
  | "building"
  | "preview_ready"
  | "rendering"
  | "exported"
  | "scheduled"
  | "publishing"
  | "posted"
  | "publish_failed"
  | "needs_attention";

const CYAN = "#38d9f5";
const ORANGE = "#ff8a3d";
const VIOLET = "#a78bfa";
const GREEN = "#4ade80";
const DIM = "#8a92a3";
const RED = "#f87171";

export const STATUS_DISPLAY: Record<ProjectStatus, { label: string; color: string }> = {
  idea_draft: { label: "Draft · Idea", color: DIM },
  storyboard_generating: { label: "Writing storyboard", color: VIOLET },
  storyboard_ready: { label: "Draft · Storyboard", color: DIM },
  building: { label: "Building", color: VIOLET },
  preview_ready: { label: "Ready to review", color: CYAN },
  rendering: { label: "Rendering", color: VIOLET },
  exported: { label: "Ready", color: CYAN },
  scheduled: { label: "Scheduled", color: ORANGE },
  publishing: { label: "Publishing", color: VIOLET },
  posted: { label: "Posted", color: GREEN },
  publish_failed: { label: "Needs attention", color: RED },
  needs_attention: { label: "Needs attention", color: RED },
};

export const FILTERS = [
  { id: "all", label: "All" },
  { id: "drafts", label: "Drafts" },
  { id: "ready", label: "Ready" },
  { id: "scheduled", label: "Scheduled" },
  { id: "posted", label: "Posted" },
] as const;

/**
 * Relative time like "5 min ago" (UI only). Older than 30 days it shows the date in `timeZone` (the user's profile
 * time zone), never the runtime's own: the server runs in UTC and the browser doesn't, and both render this text.
 */
export function timeAgo(iso: string, now = Date.now(), timeZone = "Asia/Kolkata"): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} d ago`;
  const format = (tz: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: tz });
  try {
    return format(timeZone);
  } catch {
    return format("Asia/Kolkata"); // an unknown time zone name must not break the page
  }
}
