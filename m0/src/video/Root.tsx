import { Composition } from "remotion";
import type { Timeline } from "../schema";
import { Explainer } from "./Explainer";
import { sampleTimeline } from "./sampleTimeline";

export const Root: React.FC = () => (
  <Composition
    id="Explainer"
    component={Explainer as unknown as React.FC<Record<string, unknown>>}
    defaultProps={sampleTimeline as unknown as Record<string, unknown>}
    durationInFrames={sampleTimeline.durationInFrames}
    fps={30}
    width={1080}
    height={1920}
    calculateMetadata={({ props }) => {
      const t = props as unknown as Timeline;
      return { durationInFrames: t.durationInFrames, fps: t.fps, width: t.width, height: t.height };
    }}
  />
);
