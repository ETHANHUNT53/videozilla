import { useCurrentFrame, useVideoConfig } from "remotion";
import { enter, enterStyle, fitFontSize } from "../anim";
import { Icon } from "../Icon";
import { Stage, type SceneComponentProps } from "./common";

interface Side {
  title: string;
  points: string[];
  icon?: string;
}

const Column: React.FC<{ side: Side; at: number | undefined; color: string } & Pick<SceneComponentProps, "style">> = ({ side, at, color, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const c = style.colors;
  const p = enter(frame, at, fps, style.springDamping);
  const longest = Math.max(...side.points.map((x) => x.length), 1);
  const size = fitFontSize("x".repeat(longest), 360, 3, 44, 32);

  return (
    <div
      style={{
        ...enterStyle(p, 80),
        width: 440,
        minHeight: 580,
        borderRadius: style.radius,
        background: c.surface,
        boxShadow: "0 20px 50px rgba(15,23,42,0.14)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ background: color, padding: "36px 24px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <Icon name={side.icon} size={84} color={c.onPrimary} />
        <div style={{ fontSize: 54, fontWeight: 800, color: c.onPrimary, textAlign: "center", lineHeight: 1.1 }}>{side.title}</div>
      </div>
      <div style={{ padding: "34px 30px", display: "flex", flexDirection: "column", gap: 28 }}>
        {side.points.map((pt, i) => {
          const pp = enter(frame, (at ?? 0) + 8 + i * 8, fps, style.springDamping);
          return (
            <div key={i} style={{ ...enterStyle(pp, 30), display: "flex", gap: 16, alignItems: "flex-start" }}>
              <div style={{ width: 22, height: 22, borderRadius: 11, background: color, marginTop: 14, flex: "0 0 auto" }} />
              <div style={{ fontSize: size, fontWeight: 600, color: c.text, lineHeight: 1.25 }}>{pt}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const Comparison: React.FC<SceneComponentProps> = ({ props, cue, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const c = style.colors;
  const pVs = enter(frame, cue.right, fps, 8);

  return (
    <Stage>
      <div style={{ display: "flex", gap: 60, position: "relative", alignItems: "stretch" }}>
        <Column side={props.left} at={cue.left} color={c.primary} style={style} />
        <Column side={props.right} at={cue.right} color={c.accent} style={style} />
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 300,
            width: 120,
            height: 120,
            marginLeft: -60,
            borderRadius: "50%",
            background: c.text,
            color: c.bg,
            fontSize: 48,
            fontWeight: 800,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: `scale(${pVs})`,
            boxShadow: "0 16px 40px rgba(0,0,0,0.25)",
          }}
        >
          VS
        </div>
      </div>
    </Stage>
  );
};
