import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { enter, enterStyle, fitFontSize } from "../anim";
import { Icon } from "../Icon";
import { CONTENT_WIDTH, Stage, type SceneComponentProps } from "./common";

export const TitleHook: React.FC<SceneComponentProps> = ({ props, cue, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const c = style.colors;
  const pIcon = enter(frame, cue.icon ?? 0, fps, 9);
  const pHead = enter(frame, cue.headline, fps, style.springDamping);
  const pSub = enter(frame, cue.subline, fps, style.springDamping);
  const underline = interpolate(frame - (cue.headline ?? 0), [6, 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const size = fitFontSize(props.headline, CONTENT_WIDTH, 3, 112, 72);

  return (
    <Stage gap={44}>
      <div
        style={{
          width: 230,
          height: 230,
          borderRadius: "50%",
          background: c.primary,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: `0 30px 80px ${c.primary}55`,
          transform: `scale(${pIcon}) rotate(${(1 - pIcon) * -30}deg)`,
        }}
      >
        <Icon name={props.icon} size={120} color={c.onPrimary} strokeWidth={2.2} />
      </div>
      <div style={{ ...enterStyle(pHead, 70), textAlign: "center" }}>
        <div style={{ fontSize: size, fontWeight: 800, lineHeight: 1.12, color: c.text, letterSpacing: -1, textWrap: "balance" }}>{props.headline}</div>
        <div
          style={{
            height: 14,
            borderRadius: 7,
            background: c.accent,
            width: `${underline * 60}%`,
            margin: "26px auto 0",
          }}
        />
      </div>
      {props.subline ? (
        <div style={{ ...enterStyle(pSub, 40), fontSize: 54, fontWeight: 600, color: c.muted, textAlign: "center", lineHeight: 1.25, textWrap: "balance" }}>
          {props.subline}
        </div>
      ) : null}
    </Stage>
  );
};
