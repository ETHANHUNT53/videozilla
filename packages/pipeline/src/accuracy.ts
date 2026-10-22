import type { Scene, Storyboard } from "@videozilla/schema";
import { onScreenText } from "./estimate";

/**
 * The accuracy report kept on a storyboard version (F3.7, PRD F3-FR10, DB §4.6: the one field filled in after the
 * save), and how it follows the storyboard to later versions (your answers): flags on unchanged scenes carry over,
 * dismissed or not; edited or new scenes are left unchecked until "Check now". Pure, so the server and tests share it.
 * See docs/features/F3.7-accuracy-check.md.
 */

/** A check older than this that never finished (the server died mid-call) shows as "not checked". */
export const ACCURACY_STALE_MS = 3 * 60_000;

export type AccuracyFlagKind = "number" | "date" | "name" | "quote" | "fact";

export interface AccuracyFlag {
  /** Ours, stable while the flag carries over (`f1`, `f2`…). */
  id: string;
  sceneId: string;
  /** Quoted from the scene, in its own language and script. */
  claim: string;
  /** Why it's doubtful, always in English. */
  note: string;
  kind: AccuracyFlagKind;
  dismissed: boolean;
}

export interface AccuracyReport {
  status: "pending" | "done" | "failed";
  flags: AccuracyFlag[];
  /** Scenes changed or added since the check: they wait for "Check now". */
  uncheckedSceneIds: string[];
  startedAt: Date | null;
  checkedAt: Date | null;
  model?: string | null;
  provider?: string | null;
}

/** A scene's on-screen text for the check: its headlines and the visuals' words. */
export function sceneOnScreen(scene: Pick<Scene, "type" | "props" | "beats">): string {
  return onScreenText(scene);
}

/** A scene's checkable text: narration and on-screen text (what a claim can quote). */
export function sceneFactsText(scene: Pick<Scene, "narration" | "type" | "props" | "beats">): string {
  return [scene.narration, sceneOnScreen(scene)].join("\n");
}

/**
 * The report for a new version made from `before` (a manual edit, a caption edit): flags on scenes whose text is
 * unchanged carry over as they were (dismissed ones stay dismissed); scenes changed or added join `uncheckedSceneIds`;
 * deleted scenes drop out. A report that isn't done (never checked, still pending, failed) doesn't carry: the new
 * version shows "Facts not checked · Check now".
 */
export function carryAccuracy(prev: AccuracyReport | null | undefined, before: Storyboard, after: Storyboard): AccuracyReport | null {
  if (!prev || prev.status !== "done") return null;
  const old = new Map(before.scenes.map((s) => [s.id, sceneFactsText(s)]));
  const unchanged = new Set(after.scenes.filter((s) => old.get(s.id) === sceneFactsText(s)).map((s) => s.id));
  const unchecked = new Set(prev.uncheckedSceneIds);
  return {
    ...prev,
    flags: prev.flags.filter((f) => unchanged.has(f.sceneId)),
    uncheckedSceneIds: after.scenes.filter((s) => !unchanged.has(s.id) || unchecked.has(s.id)).map((s) => s.id),
  };
}

const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * A fresh check's flags as the report keeps them: numbered `f1`, `f2`…, and dismissed again when the same claim on the
 * same scene was dismissed before (your answer: hidden while the scene is unchanged, "I checked it" isn't asked twice).
 */
export function newAccuracyFlags(findings: { sceneId: string; claim: string; note: string; kind: AccuracyFlagKind }[], prev: AccuracyReport | null | undefined): AccuracyFlag[] {
  const dismissed = new Set((prev?.flags ?? []).filter((f) => f.dismissed).map((f) => `${f.sceneId}\u0000${norm(f.claim)}`));
  return findings.map((f, i) => ({ id: `f${i + 1}`, sceneId: f.sceneId, claim: f.claim, note: f.note, kind: f.kind, dismissed: dismissed.has(`${f.sceneId}\u0000${norm(f.claim)}`) }));
}
