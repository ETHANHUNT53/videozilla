"use client";

import { useEffect, useRef, useState } from "react";
import { accuracyAnnouncement, accuracyChip } from "@/lib/accuracy-view";
import { ApiClientError, apiCall } from "@/lib/api-client";
import { isStaleState, type StaleAction } from "@/lib/storyboard-run";
import type { ProjectResource, StoryboardVersionResource } from "@/server/api/resources";
import { cx } from "./ui";

/**
 * The accuracy check on the Storyboard step (F3.7, PRD F3-FR10, your answers): the chip that says how the facts check
 * went ("Checking facts…", "2 claims to check", "Facts checked ✓"), Check now (1 revision, given back when it fails),
 * and on each flagged scene an orange box with the claim, why it's doubtful (always in English) and Edit scene /
 * Dismiss. It never blocks anything. See docs/features/F3.7-accuracy-check.md.
 */

export type AccuracyFlagView = StoryboardVersionResource["accuracyFlags"][number];

export function useAccuracy(opts: {
  projectId: string;
  version: StoryboardVersionResource;
  /** The current version, ready, not an old one being viewed. */
  editable: boolean;
  /** Showing the current version (an old one being viewed doesn't poll). */
  current: boolean;
  onSaved: (version: StoryboardVersionResource, project: ProjectResource) => void;
  /** The same version with its finished check (no new version, nothing else changed). */
  onVersion: (version: StoryboardVersionResource) => void;
  onStale: (action: StaleAction, opts?: { quiet?: boolean }) => void;
  onActivity: () => void;
}) {
  const { projectId, version, editable, current, onSaved, onStale, onActivity } = opts;
  const [busy, setBusy] = useState<string | null>(null); // "check" or a flag id
  const [error, setError] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  // Nothing dismissed any more: "Show dismissed" switches off, so the next Dismiss hides its flag (adjusting state
  // during render, as React recommends).
  if (showDismissed && version.accuracy.dismissedCount === 0) setShowDismissed(false);
  const [announce, setAnnounce] = useState("");
  const onVersion = useRef(opts.onVersion);
  useEffect(() => {
    onVersion.current = opts.onVersion;
  });

  // The check after a generate runs in the background: poll this version until it's done (at most ~2 minutes).
  const pending = current && version.accuracy.status === "pending";
  useEffect(() => {
    if (!pending) return;
    let stopped = false;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      tries++;
      try {
        const { data } = await apiCall<StoryboardVersionResource>(`/api/v1/projects/${projectId}/storyboard`);
        if (stopped || data.version !== version.version) return; // moved on: the page loads the newer one itself
        if (data.accuracy.status !== "pending") {
          onVersion.current(data);
          setAnnounce(accuracyAnnouncement(data.accuracy));
          return;
        }
      } catch {
        // A blip: try again on the next tick.
      }
      if (!stopped && tries < 40) timer = setTimeout(tick, 3000);
    };
    timer = setTimeout(tick, 2000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [pending, projectId, version.version]);

  /** `key`: "check", or the flag's id; `action` says what a stale tab didn't save (QA, F3.7). */
  const send = async (key: string, url: string, action: "check" | "dismiss" | "restore"): Promise<boolean> => {
    setBusy(key);
    setError(null);
    onActivity();
    try {
      const { data } = await apiCall<{ version: StoryboardVersionResource; project: ProjectResource }>(url, { method: "POST", headers: { "If-Match": `"${version.version}"` } });
      onSaved(data.version, data.project);
      setAnnounce(action === "check" ? accuracyAnnouncement(data.version.accuracy) : action === "dismiss" ? "Flag dismissed." : "Flag brought back.");
      return true;
    } catch (err) {
      if (err instanceof ApiClientError && (err.code === "PRECONDITION_FAILED" || isStaleState(err))) {
        onStale(action === "check" ? "accuracy" : action === "dismiss" ? "flag_dismiss" : "flag_restore");
        return false;
      }
      const message = err instanceof ApiClientError ? err.message : "Something went wrong. Please try again.";
      setError(key === "check" && err instanceof ApiClientError && err.code === "AI_BUSY" ? `The facts couldn't be checked: ${message} Your flags are unchanged, and this didn't count.` : message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  return {
    busy,
    error,
    announce,
    showDismissed,
    toggleDismissed: () => setShowDismissed((s) => !s),
    checkNow: () => (editable ? send("check", `/api/v1/projects/${projectId}/storyboard/accuracy-check`, "check") : Promise.resolve(false)),
    setDismissed: (flagId: string, dismissed: boolean) =>
      editable ? send(flagId, `/api/v1/projects/${projectId}/storyboard/accuracy-flags/${flagId}/${dismissed ? "dismiss" : "restore"}`, dismissed ? "dismiss" : "restore") : Promise.resolve(false),
  };
}

export type AccuracyControls = ReturnType<typeof useAccuracy>;

/**
 * Keeps focus on the page after a button's request (QA, F3.7): on the button itself while it's still there, else on
 * the first of `fallbacks` that exists (the scene's Edit button, the chip's buttons). Buttons use aria-disabled while
 * busy, not disabled, which would drop focus to the page.
 */
function keepFocus(button: HTMLElement, fallbacks: string[]) {
  setTimeout(() => {
    if (button.isConnected) return button.focus();
    for (const sel of fallbacks) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) return el.focus();
    }
  }, 0);
}

/** The chip in the details row, and Check now / Check again next to it (on the current version only). */
export function AccuracyChipItems({ version, controls, editable, position }: { version: StoryboardVersionResource; controls: AccuracyControls; editable: boolean; position: (sceneId: string) => number }) {
  const chip = accuracyChip(version.accuracy, position);
  const dismissed = version.accuracy.dismissedCount;
  return (
    <>
      <li
        className={cx(
          "rounded-lg border px-2.5 py-1",
          chip.tone === "warn" ? "border-orange/50 bg-orange/10 text-orange" : chip.tone === "ok" ? "border-green/40 bg-green/10 text-green" : "border-line bg-surface text-muted",
        )}
      >
        <span aria-hidden>{chip.text}</span>
        <span className="sr-only">{chip.spoken}</span>
      </li>
      {editable && chip.action ? (
        <li>
          <button
            type="button"
            id="check-facts"
            className="inline-flex min-h-11 items-center rounded-lg border border-line px-2.5 py-1 text-cyan hover:bg-surface aria-disabled:opacity-50"
            onClick={(e) => {
              if (controls.busy !== null) return;
              const el = e.currentTarget;
              void controls.checkNow().then(() => keepFocus(el, ["#check-facts", 'ol[aria-label="Scenes"]']));
            }}
            aria-disabled={controls.busy !== null}
            aria-busy={controls.busy === "check"}
            title="Checks every scene again. Uses 1 of today's revisions (given back if it fails)."
            aria-describedby="check-now-cost"
          >
            {controls.busy === "check" ? "Checking…" : chip.action}
          </button>
          <span id="check-now-cost" className="sr-only">
            Uses 1 of today&apos;s revisions, given back if it fails.
          </span>
        </li>
      ) : null}
      {dismissed > 0 ? (
        <li>
          <button type="button" id="show-dismissed" className="inline-flex min-h-11 items-center rounded-lg px-1.5 py-1 text-muted underline-offset-2 hover:text-fg hover:underline" aria-pressed={controls.showDismissed} onClick={controls.toggleDismissed}>
            {controls.showDismissed ? "Hide dismissed" : `Show dismissed (${dismissed})`}
          </button>
        </li>
      ) : null}
    </>
  );
}

/** PRD §21.3's note: always there on the Storyboard step, flagged or not. */
export function AccuracyNote({ controls }: { controls: AccuracyControls }) {
  return (
    <>
      <p className="px-1 text-xs text-muted">AI can get facts wrong. Check names, numbers and dates before you post.</p>
      {controls.error ? (
        <p role="alert" className="rounded-xl border border-red/40 bg-red/5 px-4 py-3 text-sm text-red">
          {controls.error}
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {controls.announce}
      </p>
    </>
  );
}

/** A scene's flags: the open ones, and the dismissed ones while "Show dismissed" is on. */
export function sceneFlags(version: StoryboardVersionResource, sceneId: string, showDismissed: boolean): AccuracyFlagView[] {
  return version.accuracyFlags.filter((f) => f.sceneId === sceneId && (showDismissed || !f.dismissed));
}

/** The orange "Check this" boxes on a scene card. */
export function SceneFlags({ flags, number, editable, controls, onEdit }: { flags: AccuracyFlagView[]; number: number; editable: boolean; controls: AccuracyControls; onEdit: (() => void) | null }) {
  if (!flags.length) return null;
  return (
    <ul className="flex flex-col gap-2" aria-label={`Claims to check in scene ${number}`}>
      {flags.map((f) => (
        <li key={f.id} className={cx("flex flex-col gap-1.5 rounded-xl border px-3 py-2 text-sm", f.dismissed ? "border-line bg-surface text-muted" : "border-orange/40 bg-orange/5")}>
          <p>
            <span className={cx("font-semibold", f.dismissed ? "text-muted" : "text-orange")}>{f.dismissed ? "Dismissed: " : "Check this: "}</span>
            <q className="italic">{f.claim}</q>
          </p>
          <p className="text-muted">{f.note}</p>
          {editable ? (
            <div className="flex flex-wrap gap-x-3 font-mono text-xs">
              {onEdit && !f.dismissed ? (
                <button type="button" className="inline-flex min-h-11 items-center text-cyan underline-offset-2 hover:underline" onClick={onEdit}>
                  Edit scene
                </button>
              ) : null}
              <button
                type="button"
                className="inline-flex min-h-11 items-center text-muted underline-offset-2 hover:text-fg hover:underline aria-disabled:opacity-50"
                aria-disabled={controls.busy !== null}
                aria-busy={controls.busy === f.id}
                aria-label={`${f.dismissed ? "Bring back" : "Dismiss"} the flag on “${f.claim}” in scene ${number}`}
                onClick={(e) => {
                  if (controls.busy !== null) return;
                  const el = e.currentTarget;
                  // A dismissed flag disappears (unless dismissed ones are shown): focus goes to its scene's Edit button.
                  void controls.setDismissed(f.id, !f.dismissed).then(() => keepFocus(el, [`[data-scene="${f.sceneId}"][data-action="edit"]`, "#show-dismissed", "#check-facts"]));
                }}
              >
                {f.dismissed ? "Bring back" : "Dismiss"}
              </button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
