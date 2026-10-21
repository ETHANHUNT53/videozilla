"use client";

import { Player, Thumbnail } from "@remotion/player";
import type { Timeline } from "@videozilla/schema";
import { Explainer } from "@videozilla/video";
import type { ComponentType } from "react";

/**
 * One scene's 9:16 preview (F3.3), drawn in the browser by the same scene components as the final video, in the video's
 * theme (`timeline.styleId` through the video package's `getStyle`, Midnight by default). A still frame, or the scene
 * playing in a loop with no sound while `playing`. Loaded only on the Storyboard step (next/dynamic, client-only).
 */
export default function ScenePreview({ timeline, still, playing }: { timeline: Timeline; still: number; playing: boolean }) {
  const common = {
    component: Explainer as unknown as ComponentType<Record<string, unknown>>,
    inputProps: timeline as unknown as Record<string, unknown>,
    durationInFrames: Math.max(1, timeline.durationInFrames),
    compositionWidth: timeline.width,
    compositionHeight: timeline.height,
    fps: timeline.fps,
    style: { width: "100%", height: "100%" },
  };
  return playing ? (
    <Player {...common} autoPlay loop initiallyMuted controls={false} clickToPlay={false} doubleClickToFullscreen={false} spaceKeyToPlayOrPause={false} />
  ) : (
    <Thumbnail {...common} frameToDisplay={still} />
  );
}
