"use client";

import { sceneTimeline, stillFrame } from "@videozilla/pipeline";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { LANGUAGE_OPTIONS, STYLE_LABELS, VOICE_OPTIONS, labelOf } from "@/lib/project-options";
import { reviewModel, type SceneCard } from "@/lib/storyboard-review";
import { runFailure } from "@/lib/storyboard-run";
import type { ProjectResource, StoryboardVersionResource } from "@/server/api/resources";
import type { StoryboardRun } from "./storyboard-run";
import { Card, Eyebrow, Slashes, cx } from "./ui";

/**
 * The Storyboard Review screen (F3.3, Stitch 10, PRD S5): the chips row (language, estimated length with the duration
 * guard, scenes, voice, theme, version), then the scene cards by chapter, each with a 9:16 preview of the scene drawn by
 * the video's own scene components, its narration and what it shows on screen; then the caption (read-only until
 * F3.4). Previews are stills that play on hover, focus or tap, one at a time. See docs/features/F3.3-storyboard-screen.md.
 */

// The player and the scene components load only here, in the browser.
const ScenePreview = dynamic(() => import("./scene-preview"), { ssr: false, loading: () => null });

export function StoryboardReview(props: { project: ProjectResource; version: StoryboardVersionResource; storyboard: StoryboardRun; onBackToIdea: () => void }) {
  const { project, version, storyboard, onBackToIdea } = props;
  const sb = version.storyboard;
  const model = useMemo(() => reviewModel(sb, project.styleId, version.estimatedDurationSec), [sb, project.styleId, version.estimatedDurationSec]);
  const [playing, setPlaying] = useState<string | null>(null);
  const failure = runFailure(storyboard.run);
  const theme = STYLE_LABELS[project.styleId] ?? STYLE_LABELS.midnight;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* Stitch 10's chips row. */}
      <div className="flex flex-wrap items-center gap-2 font-mono text-xs" aria-label="Storyboard details">
        <ChipBox>{labelOf(LANGUAGE_OPTIONS, sb.language)}</ChipBox>
        <ChipBox tone={model.durationOff ? "warn" : undefined}>
          ~{sb.targetDurationSec}s · est. {version.estimatedDurationSec}s{model.durationOff ? ` · a little ${model.durationOff}` : ""}
        </ChipBox>
        <ChipBox>
          {sb.scenes.length} scenes
        </ChipBox>
        <ChipBox>{labelOf(VOICE_OPTIONS, project.voiceGender)}</ChipBox>
        <ChipBox>{theme}</ChipBox>
        <ChipBox>Version {version.version}</ChipBox>
      </div>

      {model.durationOff ? (
        <p role="status" className="rounded-xl border border-orange/40 bg-orange/5 px-4 py-3 text-sm">
          At about {version.estimatedDurationSec} seconds the script is a little {model.durationOff} for a ~{sb.targetDurationSec}-second video.{" "}
          <button type="button" className="text-cyan underline-offset-2 hover:underline" onClick={onBackToIdea}>
            Regenerate it from the Idea step
          </button>
          .
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

      <ol className="flex flex-col gap-4" aria-label="Scenes">
        {model.cards.map((card) => (
          <li key={card.id} className="flex flex-col gap-3">
            {card.chapterHeading ? (
              <p className="mt-2 px-1 font-mono text-sm text-cyan">
                <Slashes />
                chapter {card.chapterHeading.index} · {card.chapterHeading.headline}
                {card.chapterHeading.subhead ? <span className="text-muted"> — {card.chapterHeading.subhead}</span> : null}
              </p>
            ) : null}
            <SceneCardView card={card} timeline={model.timeline} playing={playing === card.id} onPlay={(on) => setPlaying((p) => (on ? card.id : p === card.id ? null : p))} />
          </li>
        ))}
      </ol>

      {/* Read-only until F3.4 (caption + hashtags panel). */}
      <Card className="flex flex-col gap-3 p-5">
        <Eyebrow>instagram caption</Eyebrow>
        <p className="whitespace-pre-line text-sm leading-relaxed">{sb.social.caption}</p>
        <div className="flex flex-wrap gap-2">
          {sb.social.hashtags.map((h) => (
            <span key={h} className="rounded-lg border border-line bg-surface px-2.5 py-1 font-mono text-xs text-muted">
              {h}
            </span>
          ))}
        </div>
        <p className="text-right font-mono text-xs text-muted">{Array.from(sb.social.caption).length} / 2200</p>
      </Card>
    </div>
  );
}

function ChipBox({ children, tone }: { children: React.ReactNode; tone?: "warn" }) {
  return (
    <span className={cx("rounded-lg border px-2.5 py-1", tone === "warn" ? "border-orange/50 bg-orange/10 text-orange" : "border-line bg-surface text-fg")}>{children}</span>
  );
}

function SceneCardView({ card, timeline, playing, onPlay }: { card: SceneCard; timeline: ReturnType<typeof reviewModel>["timeline"]; playing: boolean; onPlay: (on: boolean) => void }) {
  const one = useMemo(() => sceneTimeline(timeline, card.index), [timeline, card.index]);
  const still = useMemo(() => stillFrame(one.scenes[0]), [one]);
  const box = useRef<HTMLDivElement>(null);
  const near = useNearViewport(box);
  const reduced = useReducedMotion();
  const number = card.index + 1;

  return (
    <Card
      className={cx("flex gap-4 p-4 transition-colors sm:gap-5 sm:p-5", playing && "border-cyan/50")}
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
          aria-label={playing ? `Pause scene ${number} preview` : `Play scene ${number} preview`}
          aria-pressed={playing}
          onClick={() => onPlay(!playing)}
        >
            {playing ? "❚❚" : "▶"}
          </button>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <h3 className="flex flex-wrap items-center gap-2 font-mono text-xs">
          <span className="font-semibold text-cyan">{card.label}</span>
          <span className="rounded-md border border-line bg-surface px-2 py-0.5 text-muted">{card.type}</span>
          <span className="text-muted">{card.length}</span>
          <span className="sr-only">{`Scene ${number}, ${card.role}, ${card.type}, about ${card.length.replace("~", "")}`}</span>
        </h3>
        <p className="text-[15px] leading-relaxed">{card.narration}</p>
        {card.onScreen ? (
          <p className="rounded-lg border border-line bg-surface px-3 py-1.5 font-mono text-xs text-muted">
            <span className="font-semibold text-cyan">{"// on screen:"}</span> {card.onScreen}
          </p>
        ) : null}
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
