import { Easing, interpolate, useCurrentFrame } from "remotion";
import { Stage, type SceneComponentProps } from "../scenes/common";
import { blurIn, Chip } from "./hud";

interface GridState {
  id: string;
  active: number;
  color?: string;
  note?: string;
}

const SWITCH_FRAMES = 28;

/** Deterministic shuffle so the same units light up in every render. */
function rankOrder(total: number): number[] {
  const ranks = Array.from({ length: total }, (_, i) => i);
  let seed = 7;
  for (let i = total - 1; i > 0; i--) {
    seed = (seed * 9301 + 49297) % 233280;
    const j = Math.floor((seed / 233280) * (i + 1));
    [ranks[i], ranks[j]] = [ranks[j], ranks[i]];
  }
  return ranks;
}

/** One unit drawn at (x, y): a tiny car, person or dot. */
const Unit: React.FC<{ kind: string; x: number; y: number; s: number; fill: string; opacity: number }> = ({ kind, x, y, s, fill, opacity }) => {
  if (kind === "person") {
    return (
      <g opacity={opacity}>
        <circle cx={x} cy={y - s * 0.22} r={s * 0.2} fill={fill} />
        <rect x={x - s * 0.26} y={y} width={s * 0.52} height={s * 0.36} rx={s * 0.14} fill={fill} />
      </g>
    );
  }
  if (kind === "car") {
    return (
      <g opacity={opacity}>
        <rect x={x - s * 0.24} y={y - s * 0.38} width={s * 0.48} height={s * 0.76} rx={s * 0.14} fill={fill} />
        <rect x={x - s * 0.16} y={y - s * 0.2} width={s * 0.32} height={s * 0.2} rx={s * 0.05} fill="#030407" opacity={0.55} />
      </g>
    );
  }
  return <circle cx={x} cy={y} r={s * 0.24} fill={fill} opacity={opacity} />;
};

/**
 * A tilted field of many small units (the reel's 500 cars). Each cued state changes how many are lit and in which
 * colour, while a monospace counter chip ticks to match.
 */
export const UnitGrid: React.FC<SceneComponentProps> = ({ props, cue, style }) => {
  const frame = useCurrentFrame();
  const total: number = Math.max(4, Math.min(600, Math.round(props.total ?? 100)));
  const kind: string = props.unit ?? "dot";
  const states: GridState[] = (props.states ?? []).length ? props.states : [{ id: "all", active: total }];
  const cols: number = props.columns ?? Math.ceil(Math.sqrt(total * 1.5));
  const rows = Math.ceil(total / cols);
  const cell = Math.min(46, 900 / cols, 700 / rows);
  const W = cols * cell;
  const H = rows * cell;

  // Which state is current, and how far its switch-over has progressed.
  const starts = states.map((s, i) => cue[s.id] ?? i * 45);
  let cur = 0;
  starts.forEach((at, i) => {
    if (frame >= at) cur = i;
  });
  const prevActive = cur > 0 ? states[cur - 1].active : 0;
  const k = interpolate(frame, [starts[cur], starts[cur] + SWITCH_FRAMES], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic) });
  const active = Math.round(prevActive + (states[cur].active - prevActive) * k);
  const colorOf = (name?: string) => (name && name !== "dim" ? style.accents[name as keyof typeof style.accents] ?? style.accents.cyan : style.accents.cyan);
  const litColor = colorOf(states[cur].color);
  const ranks = rankOrder(total);

  const enter = blurIn(frame, starts[0], 18);
  const chip = blurIn(frame, starts[0] + 10);
  const label: string = props.label ?? "active";
  const note = states[cur].note;

  return (
    <Stage gap={40}>
      <div style={chip.style}>
        <Chip color={litColor} style={style} size={32}>
          <span>
            {label} <span style={{ color: litColor, fontWeight: 600 }}>{active.toLocaleString("en-IN")}</span>
            <span style={{ color: style.colors.muted }}> / {total.toLocaleString("en-IN")}</span>
          </span>
        </Chip>
      </div>
      <div style={{ perspective: 1600, ...enter.style }}>
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          style={{ transform: `rotateX(48deg) rotateZ(${-18 + Math.sin(frame / 90) * 3}deg)`, overflow: "visible" }}
        >
          <rect x={-cell * 0.6} y={-cell * 0.6} width={W + cell * 1.2} height={H + cell * 1.2} rx={cell * 0.6} fill="rgba(255,255,255,0.02)" stroke={`${litColor}55`} strokeWidth={2} />
          <g>
            {ranks.map((rank, i) => {
              if (rank < active) return null;
              return <Unit key={i} kind={kind} x={(i % cols) * cell + cell / 2} y={Math.floor(i / cols) * cell + cell / 2} s={cell} fill={style.colors.muted} opacity={0.28} />;
            })}
          </g>
          <g style={{ filter: `drop-shadow(0 0 6px ${litColor})` }}>
            {ranks.map((rank, i) => {
              if (rank >= active) return null;
              return <Unit key={i} kind={kind} x={(i % cols) * cell + cell / 2} y={Math.floor(i / cols) * cell + cell / 2} s={cell} fill={litColor} opacity={0.95} />;
            })}
          </g>
        </svg>
      </div>
      {note ? (
        <div style={blurIn(frame, starts[cur] + 6).style}>
          <Chip color={litColor} style={style} size={28} dot={false} css={{ color: style.colors.muted }}>
            {note}
          </Chip>
        </div>
      ) : null}
    </Stage>
  );
};
