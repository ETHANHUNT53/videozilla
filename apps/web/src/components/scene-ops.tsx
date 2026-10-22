"use client";

import { applySceneOp, describeChanges, needsConfirm, type SceneOp } from "@videozilla/pipeline";
import { useEffect, useRef, useState } from "react";
import type { Storyboard } from "@videozilla/schema";
import { ApiClientError, apiCall } from "@/lib/api-client";
import { keepSceneDraft, takeSceneDraft, type SceneDraft } from "@/lib/scene-draft";
import { isStaleState, type StaleAction } from "@/lib/storyboard-run";
import type { ProjectResource, StoryboardVersionResource } from "@/server/api/resources";
import { Button } from "./ui";

/**
 * Saving manual scene edits (F3.6): the change is worked out first with the same code the server runs
 * (`applySceneOp`), so the page can show what will change and ask (your answer: "ask me each time" when cue timings
 * or chapters change, and always before a delete). Then one request, one new version, with If-Match.
 */

export interface PendingChange {
  op: SceneOp;
  sceneId: string;
  title: string;
  lines: string[];
  /** The storyboard as it will be once saved (a move's cards show their new times while asking; QA, F3.6). */
  preview: Storyboard;
  onCancelled?: () => void;
}

export function useSceneOps(opts: {
  projectId: string;
  version: StoryboardVersionResource;
  /** The current version, ready, not an old one being viewed: where a kept draft may open again. */
  editable: boolean;
  onSaved: (version: StoryboardVersionResource, project: ProjectResource) => void;
  onStale: (action: StaleAction, opts?: { quiet?: boolean }) => void;
  onActivity: () => void;
}) {
  const { projectId, version, editable, onSaved, onStale, onActivity } = opts;
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  // An edit refused with 412 before the reload (see commit): its form opens again on the newer version (QA, F3.6).
  const [restored, setRestored] = useState<SceneDraft | null>(null);
  const sb = version.storyboard;
  const sceneIds = sb.scenes.map((s) => s.id).join(",");
  useEffect(() => {
    if (!editable) return; // not into an old version being viewed, nor while a storyboard is being written
    const kept = takeSceneDraft(projectId, sceneIds.split(","));
    if (!kept) return;
    // Restoring from browser storage after the newer version arrives (it isn't there during the server render).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRestored(kept);
    setPending(null);
    setEditing(kept.sceneId);
  }, [projectId, editable, version.version, sceneIds]);
  const position = (id: string) => sb.scenes.findIndex((s) => s.id === id) + 1;
  // Where focus goes once a change is saved or a confirm closes: the cards re-render and the confirm unmounts, which
  // would drop focus to the page (QA, F3.6). Found by data attributes, after React has re-rendered.
  const focusScene = (sceneId: string | undefined, action: "edit" | "delete" | "move" | "save") => {
    setTimeout(() => {
      const el = sceneId ? document.querySelector<HTMLElement>(`[data-scene="${sceneId}"][data-action="${action}"]`) : null;
      (el ?? document.querySelector<HTMLElement>('ol[aria-label="Scenes"]'))?.focus();
    }, 0);
  };

  const commit = async (op: SceneOp) => {
    setBusy(true);
    setError(null);
    const base = `/api/v1/projects/${projectId}/storyboard/scenes/${op.sceneId}`;
    const headers = { "If-Match": `"${version.version}"` };
    try {
      const { data } = await apiCall<{ version: StoryboardVersionResource; project: ProjectResource }>(
        op.kind === "move" ? `${base}/move` : base,
        op.kind === "edit"
          ? { method: "PATCH", body: { narration: op.narration, type: op.type, props: op.props, beats: op.beats }, headers }
          : op.kind === "delete"
            ? { method: "DELETE", headers }
            : { method: "POST", body: { afterSceneId: op.afterSceneId }, headers },
      );
      setEditing(null);
      setPending(null);
      setRestored(null);
      onActivity();
      onSaved(data.version, data.project);
      if (op.kind === "delete") {
        // The scene that took its place (or the one before, when it was last).
        const ids = data.version.storyboard.scenes.map((s) => s.id);
        const at = Math.min(position(op.sceneId) - 1, ids.length - 1);
        focusScene(ids[at], "edit");
      } else focusScene(op.sceneId, op.kind === "move" ? "move" : "edit");
      setAnnounce(op.kind === "delete" ? `Scene ${position(op.sceneId)} deleted.` : op.kind === "move" ? `${data.version.changeSummary}.` : `Scene ${position(op.sceneId)} saved.`);
    } catch (err) {
      const stale = err instanceof ApiClientError && (err.code === "PRECONDITION_FAILED" || isStaleState(err));
      setError(err instanceof ApiClientError ? (err.details[0]?.field && err.code === "VALIDATION_FAILED" ? `${err.message} (${err.details.map((d) => `${d.field}: ${d.issue}`).join("; ")})` : err.message) : "Couldn't save that change. Please try again.");
      if (stale) {
        // What was typed isn't thrown away: kept in this tab and put back in the form on the newer version.
        // Only on a 412 (the storyboard changed); a 409 means a new storyboard is being written, whose scenes are new.
        const kept = op.kind === "edit" && err.code === "PRECONDITION_FAILED";
        if (kept) keepSceneDraft(projectId, { sceneId: op.sceneId, narration: op.narration ?? "", type: op.type ?? sb.scenes[position(op.sceneId) - 1].type, props: (op.props ?? {}) as Record<string, unknown>, headlines: (op.beats ?? []).map((b) => b.headline) });
        setRestored(null);
        pending?.onCancelled?.();
        setPending(null);
        setEditing(null);
        // A kept edit says it itself, in the form that opens again (as the caption panel does): no second line.
        onStale("scene_edit", { quiet: kept });
      }
    } finally {
      setBusy(false);
    }
  };

  /** Works the change out; saves it, or asks first when it re-times cues, changes chapters, warns, or deletes. */
  const run = (op: SceneOp, onCancelled?: () => void) => {
    setError(null);
    const local = applySceneOp(sb, op);
    if (!local.ok) {
      setError(local.problems.map((p) => `${p.field === "sceneId" ? "" : `${p.field} `}${p.issue}`.trim()).join("; "));
      onCancelled?.();
      return;
    }
    if (local.noop) {
      setEditing(null);
      onCancelled?.();
      return;
    }
    const n = position(op.sceneId);
    if (op.kind === "delete" || needsConfirm(local.changes)) {
      const lines = describeChanges(local.changes, local.storyboard, sb);
      if (op.kind === "delete") lines.push("You can bring it back from the version history.");
      setPending({
        op,
        sceneId: op.sceneId,
        title: op.kind === "delete" ? `Delete scene ${n}?` : op.kind === "move" ? `Move scene ${n}?` : `Save scene ${n}?`,
        lines,
        preview: local.storyboard,
        onCancelled,
      });
      return;
    }
    void commit(op);
  };

  return {
    editing,
    pending,
    busy,
    error,
    announce,
    restored,
    run,
    edit: (id: string) => {
      setError(null);
      setRestored(null);
      setPending(null);
      onActivity();
      setEditing(id);
    },
    cancelEdit: () => {
      const id = editing ?? undefined;
      setEditing(null);
      setError(null);
      setRestored(null);
      focusScene(id, "edit");
    },
    confirm: () => {
      if (pending) void commit(pending.op);
    },
    cancelConfirm: () => {
      pending?.onCancelled?.();
      setPending(null);
      setError(null);
      // Back to what opened it: the delete button, the drag handle, or the edit form's Save.
      if (pending) focusScene(pending.sceneId, pending.op.kind === "edit" ? "save" : pending.op.kind);
    },
  };
}

/** The card's actions (Stitch 10): Edit ✎, Delete 🗑 and the ⋮⋮ handle for drag-and-drop. */
export function SceneActions(props: { sceneId: string; number: number; disabled: boolean; onEdit: () => void; onDelete: () => void; handle: Record<string, unknown> }) {
  const { sceneId, number, disabled, onEdit, onDelete, handle } = props;
  // 44 × 44: a finger-sized target (QA, F3.6).
  const icon = "grid size-11 place-items-center rounded-lg text-muted hover:bg-surface hover:text-fg disabled:opacity-40";
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={icon} onClick={onEdit} disabled={disabled} data-scene={sceneId} data-action="edit" aria-label={`Edit scene ${number}`} title="Edit">
        ✎
      </button>
      <button type="button" className={`${icon} hover:text-red`} onClick={onDelete} disabled={disabled} data-scene={sceneId} data-action="delete" aria-label={`Delete scene ${number}`} title="Delete">
        🗑
      </button>
      <button type="button" className={`${icon} cursor-grab touch-none active:cursor-grabbing`} title="Drag to reorder" data-scene={sceneId} data-action="move" {...(handle as object)} disabled={disabled || Boolean(handle.disabled)}>
        ⋮⋮
      </button>
    </div>
  );
}

/** "What will change" before saving (your answer: ask each time), with Save / Cancel. */
export function ConfirmChange(props: { pending: PendingChange; busy: boolean; error: string | null; onConfirm: () => void; onCancel: () => void }) {
  const { pending, busy, error, onConfirm, onCancel } = props;
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelButton.current?.focus();
  }, []);
  return (
    <div
      role="alertdialog"
      aria-label={pending.title}
      className="flex flex-col gap-2 rounded-xl border border-orange/40 bg-orange/5 px-3 py-2"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <p className="text-sm font-semibold">{pending.title}</p>
      {pending.lines.length ? (
        <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm">
          {pending.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onConfirm} disabled={busy} aria-busy={busy}>
          {busy ? "Saving…" : pending.op.kind === "delete" ? "Delete" : "Save"}
        </Button>
        <Button ref={cancelButton} type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
