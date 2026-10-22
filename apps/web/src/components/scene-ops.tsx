"use client";

import { applySceneOp, describeChanges, needsConfirm, type SceneOp } from "@videozilla/pipeline";
import { useEffect, useRef, useState } from "react";
import { ApiClientError, apiCall } from "@/lib/api-client";
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
  onCancelled?: () => void;
}

export function useSceneOps(opts: {
  projectId: string;
  version: StoryboardVersionResource;
  onSaved: (version: StoryboardVersionResource, project: ProjectResource) => void;
  onStale: (action: StaleAction, opts?: { quiet?: boolean }) => void;
  onActivity: () => void;
}) {
  const { projectId, version, onSaved, onStale, onActivity } = opts;
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const sb = version.storyboard;
  const position = (id: string) => sb.scenes.findIndex((s) => s.id === id) + 1;

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
      onActivity();
      onSaved(data.version, data.project);
      setAnnounce(op.kind === "delete" ? `Scene ${position(op.sceneId)} deleted.` : op.kind === "move" ? `${data.version.changeSummary}.` : `Scene ${position(op.sceneId)} saved.`);
    } catch (err) {
      const stale = err instanceof ApiClientError && (err.code === "PRECONDITION_FAILED" || isStaleState(err));
      setError(err instanceof ApiClientError ? (err.details[0]?.field && err.code === "VALIDATION_FAILED" ? `${err.message} (${err.details.map((d) => `${d.field}: ${d.issue}`).join("; ")})` : err.message) : "Couldn't save that change. Please try again.");
      if (stale) {
        pending?.onCancelled?.();
        setPending(null);
        setEditing(null);
        onStale("scene_edit");
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
      const lines = describeChanges(local.changes, local.storyboard);
      if (op.kind === "delete") lines.push("You can bring it back from the version history.");
      setPending({
        op,
        sceneId: op.sceneId,
        title: op.kind === "delete" ? `Delete scene ${n}?` : op.kind === "move" ? `Move scene ${n}?` : `Save scene ${n}?`,
        lines,
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
    error: pending ? error : error,
    announce,
    run,
    edit: (id: string) => {
      setError(null);
      setPending(null);
      onActivity();
      setEditing(id);
    },
    cancelEdit: () => {
      setEditing(null);
      setError(null);
    },
    confirm: () => {
      if (pending) void commit(pending.op);
    },
    cancelConfirm: () => {
      pending?.onCancelled?.();
      setPending(null);
      setError(null);
    },
  };
}

/** The card's actions (Stitch 10): Edit ✎, Delete 🗑 and the ⋮⋮ handle for drag-and-drop. */
export function SceneActions(props: { number: number; disabled: boolean; onEdit: () => void; onDelete: () => void; handle: Record<string, unknown> }) {
  const { number, disabled, onEdit, onDelete, handle } = props;
  const icon = "grid size-8 place-items-center rounded-lg text-muted hover:bg-surface hover:text-fg disabled:opacity-40";
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={icon} onClick={onEdit} disabled={disabled} aria-label={`Edit scene ${number}`} title="Edit">
        ✎
      </button>
      <button type="button" className={`${icon} hover:text-red`} onClick={onDelete} disabled={disabled} aria-label={`Delete scene ${number}`} title="Delete">
        🗑
      </button>
      <button type="button" className={`${icon} cursor-grab touch-none active:cursor-grabbing`} title="Drag to reorder" {...(handle as object)} disabled={disabled || Boolean(handle.disabled)}>
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
