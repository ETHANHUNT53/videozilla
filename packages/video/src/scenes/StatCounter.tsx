import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { enter, enterStyle, fitFontSize } from "../anim";
import { Icon } from "../Icon";
import { Stage, type SceneComponentProps } from "./common";

const COUNT_FRAMES = 36;

export const StatCounter: React.FC<SceneComponentProps> = ({ props, cue, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const c = style.colors;
  const start = cue.value ?? 0;
  const t = interpolate(frame, [start, start + COUNT_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const value: number = props.value;
  const decimals = Number.isInteger(value) ? 0 : Math.min(2, String(value).split(".")[1]?.length ?? 0);
  const shown = (value * t).toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const text = `${props.prefix ?? ""}${shown}${props.suffix ?? ""}`;
  const finalText = `${props.prefix ?? ""}${value.toLocaleString("en-IN")}${props.suffix ?? ""}`;
  const size = fitFontSize(finalText, 860, 1, 210, 96);
  const pRing = enter(frame, start, fps, 12);
  const pLabel = enter(frame, cue.label, fps, style.springDamping);
  const circumference = 2 * Math.PI * 300;

  return (
    <Stage gap={40}>
      <div style={{ position: "relative", width: 680, height: 680, opacity: pRing }}>
        <svg width={680} height={680} style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
          <circle cx={340} cy={340} r={300} fill="none" stroke={c.bg2} strokeWidth={34} />
          <circle
            cx={340}
            cy={340}
            r={300}
            fill="none"
            stroke={c.primary}
            strokeWidth={34}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - t)}
          />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10 }}>
          {props.icon ? <Icon name={props.icon} size={90} color={c.accent} /> : null}
          <div style={{ fontSize: size, fontWeight: 800, color: c.text, fontVariantNumeric: "tabular-nums", letterSpacing: -3 }}>{text}</div>
        </div>
      </div>
      <div style={{ ...enterStyle(pLabel), fontSize: 60, fontWeight: 700, color: c.muted, textAlign: "center", lineHeight: 1.2, textWrap: "balance" }}>{props.label}</div>
    </Stage>
  );
};
