"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ApiClientError, apiCall } from "@/lib/api-client";
import { LANGUAGE_OPTIONS, labelOf } from "@/lib/project-options";
import { versionSourceLabel, versionWhen, type VersionSummaryResource } from "@/lib/version-history";
import type { ProjectResource, StoryboardVersionResource } from "@/server/api/resources";
import { Button, cx } from "./ui";

/**
 * Storyboard version history (F3.5, PRD F3-FR8; Stitch 10's "Version 3 ▾"): the chip opens the list of kept versions,
 * newest first; View shows one read-only in place; the banner then offers Restore this version (a pointer move, your
 * answer) or Back to current. See docs/features/F3.5-version-history.md.
 */
export function VersionMenu(props: { projectId: string; current: number; viewing: number | null; onView: (v: StoryboardVersionResource) => void }) {
  const { projectId, current, viewing, onView } = props;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<VersionSummaryResource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<number | null>(null);
  // When the list was opened: "12 min ago" is relative to it (the list is only ever drawn in the browser).
  const [openedAt, setOpenedAt] = useState(0);
  const chip = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiCall<{ items: VersionSummaryResource[] }>(`/api/v1/projects/${projectId}/storyboard/versions`)
      .then(({ data }) => {
        if (!cancelled) setItems(data.items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiClientError ? err.message : "Couldn't load the history.");
      });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      chip.current?.focus();
    };
    const onClick = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !chip.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      cancelled = true;
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, projectId, current]);

  const view = async (v: number) => {
    setLoading(v);
    setError(null);
    try {
      const { data } = await apiCall<StoryboardVersionResource>(`/api/v1/projects/${projectId}/storyboard/versions/${v}`);
      onView(data);
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't open that version.");
    } finally {
      setLoading(null);
    }
  };

  return (
    // The panel is placed against the chips row (its positioned ancestor), full width: it never runs off the screen,
    // wherever the chip lands in the row (and on a phone it reads as a sheet under the chips).
    <div>
      <button
        ref={chip}
        id={`version-chip-${projectId}`}
        type="button"
        className="rounded-lg border border-line-strong px-2.5 py-1 text-fg hover:border-cyan/60"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          setOpenedAt(Date.now());
          setOpen((o) => !o);
        }}
      >
        Version {viewing ?? current} ▾<span className="sr-only">, show the version history</span>
      </button>
      {open ? (
        <div
          ref={panel}
          id={id}
          className="absolute inset-x-0 top-full z-20 mt-2 flex flex-col gap-1 rounded-xl border border-line bg-[#080B12] p-2 shadow-2xl"
        >
          <p className="px-2 py-1 font-mono text-xs text-muted">{"// version history"}</p>
          {error ? <p className="px-2 text-sm text-red">{error}</p> : null}
          {!items && !error ? <p className="px-2 py-1 text-sm text-muted">Loading…</p> : null}
          {items?.length === 1 ? <p className="px-2 py-1 text-sm text-muted">This is the first version. Edits and regenerates will appear here.</p> : null}
          <ol className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {items?.map((v) => {
              const isCurrent = v.version === current;
              return (
                <li key={v.version} className={cx("flex items-center justify-between gap-3 rounded-lg px-2 py-2", isCurrent && "bg-cyan/5")}>
                  <span className="flex min-w-0 flex-col">
                    <span className="flex flex-wrap items-center gap-2 font-mono text-xs">
                      <span className="text-fg">v{v.version}</span>
                      {isCurrent ? <span className="text-cyan">current</span> : v.version > current ? <span className="text-muted">newer</span> : null}
                      <span className="text-muted">
                        {labelOf(LANGUAGE_OPTIONS, v.language)} · ~{v.targetDurationSec}s · {v.sceneCount} scenes
                      </span>
                    </span>
                    <span className="text-sm">{versionSourceLabel(v)}</span>
                    <time dateTime={v.createdAt} title={new Date(v.createdAt).toLocaleString("en-IN")} className="font-mono text-xs text-muted">
                      {versionWhen(v.createdAt, openedAt)}
                    </time>
                  </span>
                  {isCurrent ? null : (
                    <Button type="button" variant="ghost" className="shrink-0 px-2.5 py-1 font-mono text-xs" onClick={() => view(v.version)} aria-busy={loading === v.version} aria-label={`View version ${v.version}`}>
                      {loading === v.version ? "Opening…" : "View"}
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

/** Shown while an older (or newer) version is open read-only: what it is, Restore this version, Back to current. */
export function ViewingBanner(props: {
  projectId: string;
  project: ProjectResource;
  viewing: StoryboardVersionResource;
  onBack: () => void;
  onRestored: (version: StoryboardVersionResource, project: ProjectResource) => void;
  onStale: () => void;
}) {
  const { projectId, project, viewing, onBack, onRestored, onStale } = props;
  const [confirming, setConfirming] = useState(false);
  // Focus (QA, F3.5): the banner's "Back to current" when a version opens; Cancel when the confirm opens; back to
  // "Restore this version" when it closes. Effects after the render, as the F3.1 regenerate confirm does.
  const backButton = useRef<HTMLButtonElement>(null);
  const restoreButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    backButton.current?.focus();
  }, [viewing.version]);
  useEffect(() => {
    if (confirming) cancelButton.current?.focus();
    else if (refocus.current) {
      refocus.current = false;
      restoreButton.current?.focus();
    }
  }, [confirming]);
  const cancel = () => {
    refocus.current = true;
    setConfirming(false);
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sb = viewing.storyboard;
  const settingsChange = sb.language !== project.language || sb.targetDurationSec !== project.lengthPreset;

  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      const { data } = await apiCall<{ version: StoryboardVersionResource; project: ProjectResource }>(`/api/v1/projects/${projectId}/storyboard/versions/${viewing.version}/restore`, {
        method: "POST",
        body: {},
        headers: { "If-Match": `"${project.currentStoryboardVersion}"` },
      });
      onRestored(data.version, data.project);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Couldn't restore that version. Please try again.");
      if (err instanceof ApiClientError && (err.code === "PRECONDITION_FAILED" || err.code === "INVALID_STATE")) onStale();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div role="region" aria-label={`Viewing version ${viewing.version}`} className="flex flex-col gap-3 rounded-xl border border-violet/50 bg-violet/5 px-4 py-3">
      <p className="text-sm">
        <span className="font-semibold">Viewing version {viewing.version}</span>{" "}
        <span className="text-muted">
          ({versionSourceLabel(viewing)}, {new Date(viewing.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}). This isn&apos;t the current storyboard; nothing here can be edited.
        </span>
      </p>
      {confirming ? (
        <div
          role="alertdialog"
          aria-label="Restore this version?"
          className="flex flex-col gap-2"
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
          }}
        >
          <p className="text-sm">
            Make version {viewing.version} the current storyboard? Version {project.currentStoryboardVersion} stays in the history, so you can switch back.
            {settingsChange
              ? ` Version ${viewing.version} is in ${labelOf(LANGUAGE_OPTIONS, sb.language)}, ~${sb.targetDurationSec}s, so the video's settings change to match.`
              : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={restore} disabled={busy} aria-busy={busy}>
              {busy ? "Restoring…" : "Restore"}
            </Button>
            <Button ref={cancelButton} type="button" variant="ghost" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button ref={restoreButton} type="button" onClick={() => setConfirming(true)}>
            Restore this version
          </Button>
          <Button ref={backButton} type="button" variant="ghost" onClick={onBack}>
            Back to current
          </Button>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-sm text-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
