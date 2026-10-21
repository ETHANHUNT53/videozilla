/**
 * A caption edit that couldn't be saved because the storyboard moved on (412: another tab saved a caption, or a
 * regenerate finished), kept in this tab while the page loads the newer storyboard, so the Instagram panel can put it
 * back in the form (F3.4 review): typed text, or an AI rewrite that cost a revision, is never thrown away. Storage can
 * be missing or throw (private windows, blocked site data), so every access is wrapped.
 */
import type { Social } from "@videozilla/schema";

const key = (projectId: string) => `vz:caption-draft:${projectId}`;

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Keeps the draft for this video (in this tab). */
export function keepCaptionDraft(projectId: string, draft: Social): void {
  try {
    storage()?.setItem(key(projectId), JSON.stringify(draft));
  } catch {
    // Full or blocked storage: the edit is lost, as before.
  }
}

/** The kept draft, once (it's removed as it's read), or null. Anything that isn't a caption draft is ignored. */
export function takeCaptionDraft(projectId: string): Social | null {
  try {
    const s = storage();
    const raw = s?.getItem(key(projectId));
    if (!s || raw == null) return null;
    s.removeItem(key(projectId));
    const v = JSON.parse(raw) as Partial<Social>;
    if (typeof v.caption !== "string" || typeof v.coverText !== "string" || !Array.isArray(v.hashtags) || !v.hashtags.every((h) => typeof h === "string")) return null;
    return { caption: v.caption, hashtags: v.hashtags, coverText: v.coverText };
  } catch {
    return null;
  }
}
