"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ApiClientError, apiCall } from "@/lib/api-client";
import { currentStep, generateBlocked, isStaleState, nextPollMs, pickStoryboardRun, runFailure, type StatusResponse } from "@/lib/storyboard-run";
import type { ProjectResource, RunResource, StoryboardSummary } from "@/server/api/resources";
import { Button, ButtonLink, Card, Eyebrow, Slashes, cx } from "./ui";

/**
 * Generating the storyboard (F3.1) on the project page: the hook that starts a run and follows it through
 * `GET …/status`, the "Generate storyboard" card in the Idea step, and the Storyboard step's card (progress while it
 * runs, then "Storyboard ready"). See docs/features/F3.1-generate-storyboard.md.
 */

export interface StoryboardRun {
  run: RunResource | null;
  /** A request error (429, 409…), shown under the button. */
  error: string | null;
  starting: boolean;
  start: (regenerate: boolean) => Promise<void>;
  dismiss: () => void;
}

/**
 * Starts a generation and polls `/status` while it runs (every `pollAfterMs`, paused while the tab is hidden). When it
 * ends, `onProject` gets the project as it is now (ready, or back where it was).
 */
export function useStoryboardRun(projectId: string, initialRun: RunResource | null, onProject: (p: ProjectResource) => void, onStale: () => Promise<void>): StoryboardRun {
  const [run, setRun] = useState<RunResource | null>(initialRun);
  // A newer run from the server (the page refreshed, e.g. after another tab started one) replaces the one followed here.
  const [seenInitial, setSeenInitial] = useState(initialRun);
  if (initialRun && initialRun !== seenInitial && (initialRun.id !== seenInitial?.id || initialRun.updatedAt !== seenInitial?.updatedAt)) {
    setSeenInitial(initialRun);
    if (!run || run.id !== initialRun.id || Date.parse(initialRun.updatedAt) >= Date.parse(run.updatedAt)) setRun(initialRun);
  }
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const onProjectRef = useRef(onProject);
  const resyncRef = useRef(onStale);
  useEffect(() => {
    onProjectRef.current = onProject;
    resyncRef.current = onStale;
  });
  const active = run?.active ?? false;
  const runId = run?.id ?? null;

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (stopped) return;
      if (document.hidden) {
        // Paused while hidden; picks up again when the tab is shown.
        document.addEventListener("visibilitychange", poll, { once: true });
        return;
      }
      let wait: number | null = 2000;
      try {
        const { data } = await apiCall<StatusResponse>(`/api/v1/projects/${projectId}/status`);
        if (stopped) return;
        const next = pickStoryboardRun(data, runId);
        wait = nextPollMs(data);
        if (wait === null || !next?.active) {
          // Finished: show the project as it is now (ready, or back where it was). The finished run is set only after
          // that read: setting it ends this effect (the run is no longer active), which would drop the project.
          const { data: project } = await apiCall<ProjectResource>(`/api/v1/projects/${projectId}`);
          if (stopped) return;
          if (next) setRun(next);
          onProjectRef.current(project);
          return;
        }
        if (next) setRun(next);
      } catch {
        wait = 5000; // offline or a hiccup: try again a little later
      }
      timer = setTimeout(poll, wait);
    };
    timer = setTimeout(poll, 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [active, runId, projectId]);

  const start = useCallback(
    async (regenerate: boolean) => {
      setStarting(true);
      setError(null);
      try {
        const { data } = await apiCall<{ run: RunResource; project: ProjectResource }>(`/api/v1/projects/${projectId}/storyboard/generate`, {
          method: "POST",
          body: regenerate ? { regenerate: true } : {},
        });
        setRun(data.run);
        onProjectRef.current(data.project);
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : "Couldn't start the storyboard. Try again.");
        // 409: this tab is behind (another tab generated or changed the video): show the video as it is now.
        if (isStaleState(err)) await resyncRef.current();
      } finally {
        setStarting(false);
      }
    },
    [projectId],
  );

  return { run: run && run.id === dismissed ? null : run, error, starting, start, dismiss: () => setDismissed(runId) };
}

/** The Idea step's last card (Stitch 09): the brief's state and Generate / Regenerate storyboard. */
export function GenerateCard(props: { keyPoints: number | null; status: string; editable: boolean; aiIdle: boolean; storyboard: StoryboardRun }) {
  const { keyPoints, status, editable, aiIdle, storyboard } = props;
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const cancelButton = useRef<HTMLButtonElement>(null);
  // The confirm takes focus when it opens (Cancel: the safe choice); closing it gives focus back to the button (QA, F3.1).
  useEffect(() => {
    if (confirming) cancelButton.current?.focus();
  }, [confirming]);
  const cancel = () => {
    setConfirming(false);
    // The trigger is disabled while the confirm is open; focus it once it's enabled again.
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const ready = keyPoints !== null;
  const regenerate = status === "storyboard_ready";
  const blocked = generateBlocked({ hasBrief: ready, editable, aiIdle, starting: storyboard.starting, status });
  const failure = runFailure(storyboard.run);
  const label = storyboard.starting ? "Starting…" : regenerate ? "Regenerate storyboard" : "Generate storyboard →";

  const press = () => {
    if (regenerate && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    void storyboard.start(regenerate);
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      {/* Side by side in the right column (as Stitch 09); stacked only on a narrow phone. */}
      <div className="flex flex-wrap items-center justify-between gap-3 lg:flex-nowrap">
        <span className="flex min-w-0 items-center gap-3">
          <span aria-hidden className={cx("size-2 rounded-full", ready ? "bg-green shadow-[0_0_8px_var(--green)]" : "bg-line-strong")} />
          <span className="flex flex-col">
            <span className="font-mono text-sm">{ready ? "Brief ready" : "No brief yet"}</span>
            <span className="font-mono text-xs text-muted">{ready ? `${keyPoints} key point${keyPoints === 1 ? "" : "s"}` : "make a brief first"}</span>
          </span>
        </span>
        <Button ref={trigger} type="button" className="shrink-0 px-3" disabled={blocked !== null || confirming} title={blocked ?? undefined} onClick={press} aria-busy={storyboard.starting}>
          {label}
        </Button>
      </div>
      {confirming ? (
        <div
          role="alertdialog"
          aria-label="Regenerate storyboard?"
          aria-describedby={`${dialogId}-text`}
          className="flex flex-col gap-2 rounded-xl border border-line px-3 py-2"
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
          }}
        >
          <p id={`${dialogId}-text`} className="text-sm">This writes a new storyboard from your brief as a new version. The current one is kept in its history.</p>
          <div className="flex gap-2">
            <Button type="button" className="px-3" onClick={press}>
              Regenerate
            </Button>
            <Button ref={cancelButton} type="button" variant="ghost" className="px-3" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {storyboard.error ? (
        <p role="alert" className="text-sm text-red">
          {storyboard.error}
        </p>
      ) : failure ? (
        <div role="alert" className="flex items-start justify-between gap-3 text-sm">
          <p>
            <span className="text-red">{failure.message}</span>{" "}
            <span className="text-muted">{failure.counted ? "This counted against today's limit." : "This didn't count against today's limit."}</span>
          </p>
          <button type="button" className="font-mono text-xs text-muted hover:text-fg" onClick={storyboard.dismiss} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ) : null}
    </Card>
  );
}

/** The Storyboard step's main card: progress while the storyboard is written, then a short summary of it. */
export function StoryboardWorkspace(props: { projectId: string; status: string; summary: StoryboardSummary | null; storyboard: StoryboardRun; onBackToIdea: () => void }) {
  const { projectId, status, summary, storyboard, onBackToIdea } = props;
  const run = storyboard.run;
  if (status === "storyboard_generating") {
    const now = currentStep(run);
    return (
      <Card className="flex min-h-80 flex-col gap-5 p-6" aria-live="polite">
        <Eyebrow accent="text-violet">storyboard</Eyebrow>
        <div className="flex flex-col gap-1">
          <p className="text-2xl font-semibold">Writing your storyboard…</p>
          <p className="text-sm text-muted">Usually 20–40 seconds. You can leave this page; it keeps going.</p>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={run?.progress ?? 0} aria-label="Progress">
          <div className="h-full rounded-full bg-cyan transition-[width] duration-500" style={{ width: `${Math.max(4, run?.progress ?? 0)}%` }} />
        </div>
        <ol className="flex flex-col gap-2">
          {(run?.steps ?? []).map((s) => (
            <li key={s.name} className={cx("flex items-center gap-3 font-mono text-sm", s.status === "pending" && "text-muted")}>
              <span aria-hidden className={cx("size-2 shrink-0 rounded-full", s.status === "succeeded" ? "bg-green" : s.status === "running" ? "animate-pulse bg-cyan" : s.status === "failed" ? "bg-red" : "bg-line-strong")} />
              <span>{s.label}</span>
              <span className="sr-only">{s.status === "succeeded" ? "done" : s.status === "running" ? "in progress" : s.status}</span>
            </li>
          ))}
        </ol>
        {now ? <p className="sr-only">{now.label}</p> : null}
      </Card>
    );
  }
  // A regenerate that failed lands back here (the earlier version stays current), so say so here too.
  const failure = runFailure(run);
  return (
    <Card className="flex min-h-80 flex-col gap-5 p-6">
      <Eyebrow accent="text-violet">storyboard ready</Eyebrow>
      {failure ? (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-red/40 bg-red/5 px-3 py-2 text-sm">
          <p>
            <span className="text-red">The new storyboard couldn&apos;t be made: {failure.message}</span>{" "}
            <span className="text-muted">
              Your current storyboard is unchanged. {failure.counted ? "This counted against today's limit." : "This didn't count against today's limit."}
            </span>
          </p>
          <button type="button" className="font-mono text-xs text-muted hover:text-fg" onClick={storyboard.dismiss} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ) : null}
      {summary ? (
        <>
          <div className="flex flex-col gap-2">
            <p className="text-2xl font-semibold text-balance">{summary.title}</p>
            <p className="text-muted">{summary.hook}</p>
          </div>
          <p className="font-mono text-sm text-muted">
            <Slashes />
            {summary.sceneCount} scenes · ~{summary.estimatedDurationSec}s · {summary.wordCount} words · version {summary.version}
          </p>
          {summary.chapters.length ? (
            <ol className="flex flex-col gap-1 text-sm">
              {summary.chapters.map((c, i) => (
                <li key={i}>
                  <span className="font-mono text-cyan">{String(i + 1).padStart(2, "0")}</span> {c}
                </li>
              ))}
            </ol>
          ) : null}
        </>
      ) : (
        <p className="text-muted">Your storyboard is saved.</p>
      )}
      <div className="mt-auto flex flex-wrap gap-3">
        <ButtonLink href={`/projects/${projectId}/storyboard`}>Open storyboard →</ButtonLink>
        <Button type="button" variant="ghost" onClick={onBackToIdea}>
          ← Back to idea
        </Button>
      </div>
    </Card>
  );
}
