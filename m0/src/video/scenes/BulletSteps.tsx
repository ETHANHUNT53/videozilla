import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { enter, enterStyle, fitFontSize } from "../anim";
import { Icon } from "../Icon";
import { CONTENT_WIDTH, Stage, type SceneComponentProps } from "./common";

export const BulletSteps: React.FC<SceneComponentProps> = ({ props, cue, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const c = style.colors;
  const items: { id: string; text: string; icon?: string }[] = props.items;
  const pTitle = enter(frame, cue.title ?? 0, fps, style.springDamping);
  const longest = Math.max(...items.map((i) => i.text.length));
  const size = fitFontSize("x".repeat(longest), CONTENT_WIDTH - 220, 2, 58, 40);

  return (
    <Stage gap={30}>
      {props.title ? (
        <div style={{ ...enterStyle(pTitle), fontSize: 76, fontWeight: 800, color: c.text, textAlign: "center", marginBottom: 14 }}>
          {props.title}
        </div>
      ) : null}
      {items.map((item, i) => {
        const p = enter(frame, cue[item.id], fps, style.springDamping);
        const x = interpolate(p, [0, 1], [-120, 0]);
        return (
          <div
            key={item.id}
            style={{
              opacity: p,
              transform: `translateX(${x}px)`,
              width: CONTENT_WIDTH,
              display: "flex",
              alignItems: "center",
              gap: 30,
              background: c.surface,
              borderRadius: style.radius,
              padding: "28px 34px",
              boxShadow: "0 18px 44px rgba(15,23,42,0.12)",
              borderLeft: `14px solid ${i % 2 ? c.accent : c.primary}`,
            }}
          >
            <div
              style={{
                flex: "0 0 110px",
                height: 110,
                borderRadius: 30,
                background: i % 2 ? c.accent : c.primary,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: c.onPrimary,
                fontSize: 56,
                fontWeight: 800,
              }}
            >
              {item.icon ? <Icon name={item.icon} size={64} color={c.onPrimary} /> : i + 1}
            </div>
            <div style={{ fontSize: size, fontWeight: 600, color: c.text, lineHeight: 1.2 }}>{item.text}</div>
          </div>
        );
      })}
    </Stage>
  );
};
