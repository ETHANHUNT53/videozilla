import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from "remotion";
import type { TimelineScene } from "../../schema";
import type { VideoStyle } from "../styles";

const MOVE_FRAMES = 24;

/** Camera "shots" the world cycles through, one per scene, so the view keeps moving gently. */
const SHOTS = [
  { tilt: 64, turn: -8, zoom: 1.0, y: 0 },
  { tilt: 58, turn: 6, zoom: 1.12, y: -40 },
  { tilt: 68, turn: 12, zoom: 0.95, y: 30 },
  { tilt: 60, turn: -14, zoom: 1.08, y: -20 },
];

/**
 * The persistent dark world behind every scene: a near-black backdrop with a soft centre glow and a
 * perspective dot floor. It never cuts between scenes; the camera eases from one shot to the next.
 */
export const World: React.FC<{ scenes: TimelineScene[]; style: VideoStyle }> = ({ scenes, style }) => {
  const frame = useCurrentFrame();
  const i = Math.max(0, scenes.findIndex((s) => frame >= s.from && frame < s.from + s.durationInFrames));
  const cur = SHOTS[i % SHOTS.length];
  const prev = SHOTS[(i + SHOTS.length - 1) % SHOTS.length];
  const t = i === 0 ? 1 : interpolate(frame, [scenes[i].from, scenes[i].from + MOVE_FRAMES], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const mix = (a: number, b: number) => a + (b - a) * t;
  const drift = (frame * 0.6) % 60;
  const c = style.colors;

  return (
    <AbsoluteFill style={{ background: c.bg, overflow: "hidden" }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 70% 45% at 50% 58%, ${c.bg2} 0%, ${c.bg} 70%)` }} />
      <AbsoluteFill style={{ perspective: 1300, perspectiveOrigin: "50% 40%" }}>
        <div
          style={{
            position: "absolute",
            left: -1100,
            top: 900 + mix(prev.y, cur.y),
            width: 3280,
            height: 2600,
            transformOrigin: "50% 0%",
            transform: `rotateX(${mix(prev.tilt, cur.tilt)}deg) rotateZ(${mix(prev.turn, cur.turn)}deg) scale(${mix(prev.zoom, cur.zoom)})`,
            backgroundImage: `radial-gradient(circle, ${c.muted}88 2.6px, transparent 3px)`,
            backgroundSize: "60px 60px",
            backgroundPosition: `0px ${drift}px`,
            maskImage: "radial-gradient(ellipse 45% 55% at 50% 30%, black 0%, transparent 75%)",
            WebkitMaskImage: "radial-gradient(ellipse 45% 55% at 50% 30%, black 0%, transparent 75%)",
            opacity: 0.8,
          }}
        />
      </AbsoluteFill>
      {/* Vignette keeps the edges and the Instagram UI area dark. */}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 80% 70% at 50% 45%, transparent 55%, rgba(0,0,0,0.75) 100%)" }} />
      <AbsoluteFill style={{ background: `linear-gradient(to bottom, transparent 72%, ${c.bg} 92%)` }} />
    </AbsoluteFill>
  );
};
