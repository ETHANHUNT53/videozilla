import { useCurrentFrame, useVideoConfig } from "remotion";
import { enter } from "../anim";
import { fitFontSize } from "../anim";
import { CONTENT_WIDTH, Stage, type SceneComponentProps } from "./common";

export const KeywordReveal: React.FC<SceneComponentProps> = ({ props, cue, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const c = style.colors;
  const keywords: { id: string; text: string }[] = props.keywords;

  return (
    <Stage gap={48}>
      {keywords.map((k, i) => {
        const p = enter(frame, cue[k.id], fps, 10);
        const isMain = i === 0;
        const size = fitFontSize(k.text, CONTENT_WIDTH - 120, 2, isMain ? 120 : 92, 60);
        return (
          <div
            key={k.id}
            style={{
              opacity: Math.min(1, p * 1.5),
              transform: `scale(${0.6 + 0.4 * p}) rotate(${(1 - p) * (i % 2 ? 6 : -6)}deg)`,
              background: isMain ? c.primary : c.surface,
              color: isMain ? c.onPrimary : c.text,
              border: isMain ? "none" : `6px solid ${c.accent}`,
              borderRadius: style.radius,
              padding: "34px 60px",
              fontSize: size,
              fontWeight: 800,
              textAlign: "center",
              lineHeight: 1.1,
              boxShadow: "0 24px 60px rgba(15,23,42,0.18)",
              maxWidth: CONTENT_WIDTH,
            }}
          >
            {k.text}
          </div>
        );
      })}
    </Stage>
  );
};
