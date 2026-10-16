import { AbsoluteFill, Audio, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { SceneType, Timeline, TimelineScene } from "../schema";
import { sceneOpacity } from "./anim";
import { LEAD_IN_FRAMES } from "../constants";
import { Captions } from "./Captions";
import { StyleContext } from "./context";
import { fontFamily, techSans } from "./fonts";
import { getStyle, type Look, type VideoStyle } from "./styles";
import { BulletSteps } from "./scenes/BulletSteps";
import { Comparison } from "./scenes/Comparison";
import { Flowchart } from "./scenes/Flowchart";
import { KeywordReveal } from "./scenes/KeywordReveal";
import { RecapOutro } from "./scenes/RecapOutro";
import { StatCounter } from "./scenes/StatCounter";
import { TitleHook } from "./scenes/TitleHook";
import { Illustration } from "./scenes/Illustration";
import type { SceneComponentProps } from "./scenes/common";
import { HeadlineLayer } from "./tech/Headline";
import { World } from "./tech/World";
import { TechBulletSteps, TechComparison, TechFlowchart, TechKeywordReveal, TechRecapOutro, TechStatCounter, TechTitleHook } from "./tech/scenes";
import { UnitGrid } from "./tech/UnitGrid";

const SCENES: Record<Look, Record<SceneType, React.FC<SceneComponentProps>>> = {
  card: { Illustration, TitleHook, KeywordReveal, BulletSteps, Flowchart, Comparison, StatCounter, RecapOutro, UnitGrid },
  tech: {
    Illustration,
    TitleHook: TechTitleHook,
    KeywordReveal: TechKeywordReveal,
    BulletSteps: TechBulletSteps,
    Flowchart: TechFlowchart,
    Comparison: TechComparison,
    StatCounter: TechStatCounter,
    RecapOutro: TechRecapOutro,
    UnitGrid,
  },
};

/** Soft gradient background with slowly drifting shapes (card look). */
const Background: React.FC<{ style: VideoStyle }> = ({ style }) => {
  const frame = useCurrentFrame();
  const c = style.colors;
  const drift = (speed: number, range: number) => Math.sin(frame / speed) * range;
  return (
    <AbsoluteFill style={{ background: `linear-gradient(170deg, ${c.bg} 0%, ${c.bg2} 100%)`, overflow: "hidden" }}>
      <div style={{ position: "absolute", width: 700, height: 700, borderRadius: "50%", background: c.primary, opacity: 0.08, left: -260 + drift(90, 40), top: 120 + drift(70, 30) }} />
      <div style={{ position: "absolute", width: 520, height: 520, borderRadius: "50%", background: c.accent, opacity: 0.09, right: -180 + drift(80, 35), top: 1180 + drift(100, 40) }} />
      <div style={{ position: "absolute", width: 260, height: 260, borderRadius: 60, background: c.primary, opacity: 0.06, right: 120 + drift(60, 20), top: 300, transform: `rotate(${frame / 3}deg)` }} />
    </AbsoluteFill>
  );
};

const ProgressBar: React.FC<{ style: VideoStyle }> = ({ style }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const p = interpolate(frame, [0, durationInFrames - 1], [0, 1], { extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", top: 228, left: 70, right: 70, height: 10, borderRadius: 5, background: `${style.colors.muted}33` }}>
      <div style={{ width: `${p * 100}%`, height: "100%", borderRadius: 5, background: style.colors.primary }} />
    </div>
  );
};

/** A scene should never sit empty: if its first visual is cued late, bring that one in right away. */
const MAX_FIRST_CUE = 24;
function withEarlyStart(cueFrames: Record<string, number>): Record<string, number> {
  const visual = Object.entries(cueFrames).filter(([k]) => k !== "title");
  if (!visual.length) return cueFrames;
  const [firstKey, firstFrame] = visual.reduce((m, e) => (e[1] < m[1] ? e : m));
  return firstFrame > MAX_FIRST_CUE ? { ...cueFrames, [firstKey]: LEAD_IN_FRAMES + 4 } : cueFrames;
}

const SceneView: React.FC<{ scene: TimelineScene; style: VideoStyle }> = ({ scene, style }) => {
  const frame = useCurrentFrame();
  const Cmp = SCENES[style.look][scene.type];
  const opacity = sceneOpacity(frame, scene.durationInFrames);
  // Tech look: scenes dissolve with a slight blur so the persistent world feels continuous.
  const blur = style.look === "tech" ? (1 - opacity) * 10 : 0;
  return (
    <AbsoluteFill style={{ opacity, filter: blur ? `blur(${blur}px)` : undefined }}>
      <Cmp props={scene.props} cue={withEarlyStart(scene.cueFrames)} style={style} duration={scene.durationInFrames} />
    </AbsoluteFill>
  );
};

export const Explainer: React.FC<Timeline> = (timeline) => {
  const style = getStyle(timeline.styleId);
  const tech = style.look === "tech";
  return (
    <StyleContext.Provider value={style}>
      <AbsoluteFill style={{ fontFamily: tech ? techSans : fontFamily }}>
        {tech ? <World scenes={timeline.scenes} style={style} /> : <Background style={style} />}
        {tech ? null : <ProgressBar style={style} />}
        {timeline.scenes.map((scene) => (
          <Sequence key={scene.id} from={scene.from} durationInFrames={scene.durationInFrames} name={`${scene.id} ${scene.type}`}>
            <SceneView scene={scene} style={style} />
            {scene.audioSrc ? (
              <Sequence from={LEAD_IN_FRAMES}>
                <Audio src={staticFile(scene.audioSrc)} />
              </Sequence>
            ) : null}
          </Sequence>
        ))}
        {tech ? <HeadlineLayer headlines={timeline.headlines ?? []} style={style} language={timeline.language} /> : null}
        {style.showCaptions ? <Captions captions={timeline.captions} style={style} language={timeline.language} /> : null}
      </AbsoluteFill>
    </StyleContext.Provider>
  );
};
