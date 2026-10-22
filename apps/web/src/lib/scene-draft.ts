/**
 * A scene edit that couldn't be saved because the storyboard moved on (412: another tab changed it, or a regenerate
 * finished), kept in this tab while the page loads the newer storyboard, so the scene's form can open again with what
 * was typed (F3.6 QA, like the caption panel's draft in caption-draft.ts). One per video and scene. Storage can be
 * missing or throw (private windows, blocked site data), so every access is wrapped.
 */
import { SCENE_TYPES, type SceneType } from "@videozilla/schema";

export interface SceneDraft {
  sceneId: string;
  narration: string;
  type: SceneType;
  /** The type's props as typed (checked again when saved). */
  props: Record<string, unknown>;
  headlines: string[];
}

const key = (projectId: string, sceneId: string) => `vz:scene-draft:${projectId}:${sceneId}`;

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Keeps the draft for this video and scene (in this tab). */
export function keepSceneDraft(projectId: string, draft: SceneDraft): void {
  try {
    storage()?.setItem(key(projectId, draft.sceneId), JSON.stringify(draft));
  } catch {
    // Full or blocked storage: the edit is lost, as before.
  }
}

/**
 * The kept draft of the first of `sceneIds` that has one, once (it's removed as it's read), or null. Drafts of scenes
 * that are gone stay until their scene comes back (a restore) or the tab closes. Anything that isn't a draft is dropped.
 */
export function takeSceneDraft(projectId: string, sceneIds: string[]): SceneDraft | null {
  const s = storage();
  if (!s) return null;
  for (const sceneId of sceneIds) {
    try {
      const raw = s.getItem(key(projectId, sceneId));
      if (raw == null) continue;
      s.removeItem(key(projectId, sceneId));
      const v = JSON.parse(raw) as Partial<SceneDraft>;
      const ok =
        v.sceneId === sceneId &&
        typeof v.narration === "string" &&
        (SCENE_TYPES as readonly string[]).includes(v.type as string) &&
        v.props !== null &&
        typeof v.props === "object" &&
        !Array.isArray(v.props) &&
        Array.isArray(v.headlines) &&
        v.headlines.every((h) => typeof h === "string");
      if (ok) return v as SceneDraft;
    } catch {
      // Unreadable: skip it.
    }
  }
  return null;
}
