import { useCurrentFrame, useVideoConfig } from "remotion";
import { Check } from "lucide-react";
import { enter, enterStyle } from "../anim";
import { CONTENT_WIDTH, Stage, type SceneComponentProps } from "./common";

export const RecapOutro: React.FC<SceneComponentProps> = ({ props, cue, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const c = style.colors;
  const points: { id: string; text: string }[] = props.points;
  const pCta = enter(frame, cue.cta, fps, 9);
  const pulse = 1 + 0.04 * Math.sin(Math.max(0, frame - (cue.cta ?? 0)) / 5);

  return (
    <Stage gap={34}>
      {points.map((pt) => {
        const p = enter(frame, cue[pt.id], fps, style.springDamping);
        return (
          <div
            key={pt.id}
            style={{
              ...enterStyle(p, 40),
              width: CONTENT_WIDTH,
              display: "flex",
              alignItems: "center",
              gap: 28,
              background: c.surface,
              borderRadius: style.radius,
              padding: "28px 36px",
              boxShadow: "0 16px 40px rgba(15,23,42,0.12)",
            }}
          >
            <div
              style={{
                width: 84,
                height: 84,
                borderRadius: "50%",
                background: c.primary,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "0 0 auto",
                transform: `scale(${p})`,
              }}
            >
              <Check size={52} color={c.onPrimary} strokeWidth={3} />
            </div>
            <div style={{ fontSize: 52, fontWeight: 700, color: c.text, lineHeight: 1.2 }}>{pt.text}</div>
          </div>
        );
      })}
      <div
        style={{
          marginTop: 30,
          opacity: pCta,
          transform: `scale(${(0.7 + 0.3 * pCta) * pulse})`,
          background: c.accent,
          color: "#FFFFFF",
          fontSize: 58,
          fontWeight: 800,
          padding: "34px 64px",
          borderRadius: 999,
          textAlign: "center",
          boxShadow: `0 24px 60px ${c.accent}66`,
          maxWidth: CONTENT_WIDTH,
        }}
      >
        {props.cta}
      </div>
    </Stage>
  );
};
