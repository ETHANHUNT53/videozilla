"use client";

import { sceneTimeline, stillFrame } from "@videozilla/pipeline";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { LANGUAGE_OPTIONS, STYLE_LABELS, VOICE_OPTIONS, labelOf } from "@/lib/project-options";
import { reviewModel, type SceneCard } from "@/lib/storyboard-review";
import { runFailure, type StaleAction } from "@/lib/storyboard-run";
import type { ProjectResource, StoryboardVersionResource } from "@/server/api/resources";
import { SceneEditForm } from "./scene-edit";
import { ConfirmChange, SceneActions, useSceneOps } from "./scene-ops";
import { useReorder } from "./scene-reorder";
import { SocialPanel } from "./social-panel";
import { VersionMenu } from "./version-history";
import type { StoryboardRun } from "./storyboard-run";
import { Card, Eyebrow, Slashes, cx } from "./ui";

/**
 * The Storyboard Review screen (F3.3, Stitch 10, PRD S5): the chips row (language, estimated length with the duration
 * guard, scenes, voice, theme, version), then the scene cards by chapter, each with a 9:16 preview of the scene drawn by
 * the video's own scene components, its narration and what it shows on screen; then the Instagram panel (F3.4).
 * Previews are stills that play on hover or tap, one at a time. See docs/features/F3.3-storyboard-screen.md.
 */

// The player and the scene components load only here, in the browser.
const ScenePreview = dynamic(() => import("./scene-preview"), { ssr: false, loading: () => null });

export function StoryboardReview(props: {
  project: ProjectResource;
  version: StoryboardVersionResource;
  storyboard: StoryboardRun;
  onBackToIdea: () => void;
  /** A caption edit saved a new version (F3.4). */
  onSaved: (version: StoryboardVersionResource, project: ProjectResource) => void;
  onStale: (action: StaleAction, opts?: { quiet?: boolean }) => void;
  /** The user did something in the caption panel: the page's "moved on in another tab" line is no longer news. */
  onActivity: () => void;
  /** F3.5: an older (or newer) version opened read-only from the history; null shows the current one. */
  viewing?: StoryboardVersionResource | null;
  /** The banner shown above the chips while `viewing` (Restore this version / Back to current). */
  banner?: React.ReactNode;
  onView: (v: StoryboardVersionResource) => void;
}) {
  const { project, storyboard, onBackToIdea, onSaved, onStale, onActivity, viewing = null, banner, onView } = props;
  // Viewing another version: show it, read-only.
  const version = viewing ?? props.version;
  const readOnly = viewing !== null;
  const sb = version.storyboard;
  const model = useMemo(() => reviewModel(sb, project.styleId, version.estimatedDurationSec), [sb, project.styleId, version.estimatedDurationSec]);
  const [playing, setPlaying] = useState<string | null>(null);
  const failure = runFailure(storyboard.run);
  // F3.6: edit, delete and move scenes, on the current version only (not an old one being viewed).
  const editable = !readOnly && project.status === "storyboard_ready" && project.currentStoryboardVersion === version.version;
  const ops = useSceneOps({ projectId: project.id, version, onSaved, onStale, onActivity });
  const position = (id: string) => sb.scenes.findIndex((x) => x.id === id) + 1;
  const reorder = useReorder({
    ids: sb.scenes.map((x) => x.id),
    label: (id) => `scene ${position(id)}`,
    disabled: !editable || ops.busy || ops.editing !== null,
    onDrop: (id, afterId) => ops.run({ kind: "move", sceneId: id, afterSceneId: afterId }, reorder.reset),
  });
  const cardsById = new Map(model.cards.map((c) => [c.id, c]));
  const theme = STYLE_LABELS[project.styleId] ?? STYLE_LABELS.midnight;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* Stitch 10's chips row. */}
      {/* A list, each chip with a sentence for screen readers ("~60s · est. 59s" read aloud is noise). */}
      <ul className="relative flex flex-wrap items-center gap-2 font-mono text-xs" aria-label="Storyboard details">
        <ChipBox spoken={`Language: ${labelOf(LANGUAGE_OPTIONS, sb.language)}`}>{labelOf(LANGUAGE_OPTIONS, sb.language)}</ChipBox>
        <ChipBox
          tone={model.durationOff ? "warn" : undefined}
          spoken={`Estimated ${version.estimatedDurationSec} seconds of a ${sb.targetDurationSec}-second target${model.durationOff ? `, a little ${model.durationOff}` : ""}`}
        >
          ~{sb.targetDurationSec}s · est. {version.estimatedDurationSec}s{model.durationOff ? ` · a little ${model.durationOff}` : ""}
        </ChipBox>
        <ChipBox spoken={`${sb.scenes.length} scenes`}>{sb.scenes.length} scenes</ChipBox>
        <ChipBox spoken={labelOf(VOICE_OPTIONS, project.voiceGender)}>{labelOf(VOICE_OPTIONS, project.voiceGender)}</ChipBox>
        <ChipBox spoken={`Theme: ${theme}`}>{theme}</ChipBox>
        <li>
          <VersionMenu projectId={project.id} current={project.currentStoryboardVersion ?? props.version.version} viewing={viewing?.version ?? null} onView={onView} />
        </li>
      </ul>

      {banner}

      {model.durationOff ? (
        <p role="status" className="rounded-xl border border-orange/40 bg-orange/5 px-4 py-3 text-sm">
          At about {version.estimatedDurationSec} seconds the script is a little {model.durationOff} for a ~{sb.targetDurationSec}-second video.
          {readOnly ? null : (
            <>
              {" "}
              <button type="button" className="text-cyan underline-offset-2 hover:underline" onClick={onBackToIdea}>
                Regenerate it from the Idea step
              </button>
              .
            </>
          )}
        </p>
      ) : null}

      {failure ? (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-red/40 bg-red/5 px-4 py-3 text-sm">
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

      <div className="flex items-center justify-between px-1">
        <Eyebrow>{`scenes overview (${sb.scenes.length} scenes)`}</Eyebrow>
        <button type="button" className="font-mono text-xs text-muted hover:text-fg" onClick={onBackToIdea}>
          ← back to idea
        </button>
      </div>

      {/* What the drag handles and saves did, for screen readers. */}
      <p className="sr-only" aria-live="assertive">
        {reorder.announce}
      </p>
      <p className="sr-only" aria-live="polite">
        {ops.announce}
      </p>
      <p id="reorder-help" className="sr-only">
        Press Space to pick the scene up, the arrow keys to move it, Space to drop it, Escape to cancel. Or drag it.
      </p>

      <ol className="flex flex-col gap-4 outline-none" aria-label="Scenes" tabIndex={-1}>
        {reorder.order.map((sceneId) => cardsById.get(sceneId)!).map((card) => (
          <li key={card.id} ref={reorder.itemRef(card.id)} className={cx("flex flex-col gap-3", reorder.dragging === card.id && "opacity-80 [&>div]:border-cyan [&>div]:shadow-[0_0_24px_rgba(56,217,245,0.25)]")}>
            {card.chapterHeading ? (
              <p className="mt-2 px-1 font-mono text-sm text-cyan">
                <Slashes />
                chapter {card.chapterHeading.index} · {card.chapterHeading.headline}
                {card.chapterHeading.subhead ? <span className="text-muted"> — {card.chapterHeading.subhead}</span> : null}
              </p>
            ) : null}
            <SceneCardView
              card={card}
              timeline={model.timeline}
              playing={playing === card.id}
              onPlay={(on) => setPlaying((p) => (on ? card.id : p === card.id ? null : p))}
              actions={
                editable ? (
                  <SceneActions
                    sceneId={card.id}
                    number={card.index + 1}
                    disabled={ops.busy || (ops.editing !== null && ops.editing !== card.id) || ops.pending !== null}
                    onEdit={() => ops.edit(card.id)}
                    onDelete={() => ops.run({ kind: "delete", sceneId: card.id })}
                    handle={reorder.handle(card.id)}
                  />
                ) : null
              }
              body={
                editable && ops.editing === card.id ? (
                  <SceneEditForm
                    scene={sb.scenes[card.index]}
                    position={card.index + 1}
                    busy={ops.busy}
                    error={ops.error}
                    onCancel={ops.cancelEdit}
                    onSubmit={(op) => ops.run(op)}
                  />
                ) : null
              }
              confirm={ops.pending?.sceneId === card.id ? <ConfirmChange pending={ops.pending} busy={ops.busy} error={ops.error} onConfirm={ops.confirm} onCancel={ops.cancelConfirm} /> : null}
            />
          </li>
        ))}
      </ol>

      <SocialPanel projectId={project.id} version={version} onSaved={onSaved} onStale={onStale} onActivity={onActivity} readOnly={readOnly} />
    </div>
  );
}

function ChipBox({ children, tone, spoken }: { children: React.ReactNode; tone?: "warn"; spoken: string }) {
  return (
    <li className={cx("rounded-lg border px-2.5 py-1", tone === "warn" ? "border-orange/50 bg-orange/10 text-orange" : "border-line bg-surface text-fg")}>
      <span aria-hidden>{children}</span>
      <span className="sr-only">{spoken}</span>
    </li>
  );
}

function SceneCardView(props: {
  card: SceneCard;
  timeline: ReturnType<typeof reviewModel>["timeline"];
  playing: boolean;
  onPlay: (on: boolean) => void;
  /** F3.6: the card's Edit / Delete / drag handle. */
  actions?: React.ReactNode;
  /** F3.6: the edit form, in place of the narration and on-screen text. */
  body?: React.ReactNode;
  /** F3.6: "what will change" before a save. */
  confirm?: React.ReactNode;
}) {
  const { card, timeline, playing, onPlay, actions, body, confirm } = props;
  const one = useMemo(() => sceneTimeline(timeline, card.index), [timeline, card.index]);
  const still = useMemo(() => stillFrame(one.scenes[0]), [one]);
  const box = useRef<HTMLDivElement>(null);
  const near = useNearViewport(box);
  const reduced = useReducedMotion();
  usePauseOffScreen(box, playing, () => onPlay(false));
  const number = card.index + 1;

  return (
    <Card
      // While its edit form is open, a phone stacks the card so the form gets the full width (QA, F3.6).
      className={cx("flex gap-4 p-4 transition-colors sm:gap-5 sm:p-5", Boolean(body) && "flex-col sm:flex-row", playing && "border-cyan/50")}
      // Hovering with a mouse plays it; the ▶ button plays and pauses it (a tap on a phone, or the keyboard). Reduced
      // motion: only the button.
      onPointerEnter={(e) => {
        // A real mouse only: a tap also "enters", and the ▶ tap that follows would then pause it straight away.
        if (e.pointerType === "mouse" && !reduced) onPlay(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") onPlay(false);
      }}
    >
      <div ref={box} className="flex w-24 shrink-0 flex-col gap-1 self-start sm:w-28">
        <span className="font-mono text-[10px] text-muted">{card.range}</span>
        <div className="relative">
          <div aria-hidden className="aspect-[9/16] w-full overflow-hidden rounded-xl border border-line bg-[#030407]">
            {near ? <ScenePreview timeline={one} still={still} playing={playing} /> : null}
          </div>
          <button
          type="button"
          className="absolute bottom-1.5 right-1.5 grid size-7 place-items-center rounded-full border border-line bg-[#030407]/80 font-mono text-xs text-fg hover:text-cyan"
          // The label says what a press does (no aria-pressed as well: "Pause …, pressed" would say it twice, oddly).
          aria-label={playing ? `Pause scene ${number} preview` : `Play scene ${number} preview`}
          onClick={() => onPlay(!playing)}
        >
            {playing ? "❚❚" : "▶"}
          </button>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="flex flex-wrap items-center gap-2 font-mono text-xs">
          {/* Read once, as the sentence below (QA: the visible parts were read too). */}
          <span aria-hidden className="font-semibold text-cyan">{card.label}</span>
          <span aria-hidden className="rounded-md border border-line bg-surface px-2 py-0.5 text-muted">{card.type}</span>
          <span aria-hidden className="text-muted">{card.length}</span>
          <span className="sr-only">{`Scene ${number}, ${card.role}, ${card.type}, about ${card.length.replace("~", "")}`}</span>
        </h3>
        {actions}
        </div>
        {confirm}
        {body ?? (
          <>
            <p className="text-[15px] leading-relaxed">{card.narration}</p>
            {card.onScreen ? (
              <p className="rounded-lg border border-line bg-surface px-3 py-1.5 font-mono text-xs text-muted">
                <span className="font-semibold text-cyan">{"// on screen:"}</span> {card.onScreen}
              </p>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}

/** Mounts a preview once its card is near the screen (13 players at once are heavy on a phone). */
function useNearViewport(ref: React.RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true); // eslint-disable-line react-hooks/set-state-in-effect -- no observer: show it now
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setNear(true);
        io.disconnect();
      }
    }, { rootMargin: "400px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, near]);
  return near;
}

/**
 * Stops a playing preview once its card scrolls off the screen (a tap on ▶ on a phone, then scrolling on), so a hidden
 * scene doesn't keep animating in a loop.
 */
function usePauseOffScreen(ref: React.RefObject<HTMLElement | null>, playing: boolean, pause: () => void): void {
  const pauseRef = useRef(pause);
  useEffect(() => {
    pauseRef.current = pause;
  });
  useEffect(() => {
    const el = ref.current;
    if (!playing || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.every((e) => !e.isIntersecting)) pauseRef.current();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, playing]);
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setReduced(mq.matches); // eslint-disable-line react-hooks/set-state-in-effect -- read once the page is in the browser
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}
