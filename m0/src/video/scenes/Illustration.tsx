import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Chem, resolveActorKind, type ActorDef } from "../illustration/actors";
import { curvePath, makeCurve, moveToward, pointAt, tangentAngle, type Curve, type Pt } from "../illustration/geometry";
import { Chip } from "../tech/hud";
import { FLOW_COLORS, NATURE } from "../illustration/palette";
import { setActorLook } from "../illustration/actors";
import { SAFE, safeAreaFor } from "../styles";
import type { SceneComponentProps } from "./common";

const W = 1080 - SAFE.sideX * 2;
const SIZES = { s: 210, m: 310, l: 440 } as const;
const GROUND_FRACTION = 0.82;
/** Where each grounded drawing touches the floor (viewBox y), so it stands on the ground line. */
const BASE_Y: Record<string, number> = { plant: 180, tree: 192, person: 192, house: 190, factory: 190, mountain: 190, lightbulb: 176, battery: 190, flame: 190 };
const ENTER_FRAMES = 26;
const FLOW_DRAW_FRAMES = 16;
const PARTICLE_TRIP_FRAMES = 54;

interface ActorSpec {
  id: string;
  kind: string;
  x: number;
  y: number;
  size?: keyof typeof SIZES;
  label?: string;
}

interface FlowSpec {
  id: string;
  from: string;
  to: string;
  label?: string;
  style?: "particles" | "beam" | "arrow";
  kind?: string;
}

interface PlacedActor extends ActorSpec {
  def: ActorDef;
  resolvedKind: string;
  px: number;
  cx: number;
  cy: number;
  at: number;
}

const EDGES = new Set(["left", "right", "top", "bottom"]);

/** Entrance progress 0..1 with an ease-out (no spring overshoot, so growing things don't wobble). */
const progress = (frame: number, at: number, frames = ENTER_FRAMES) =>
  interpolate(frame, [at, at + frames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });

/** The part of a curve from its start up to parameter d (de Casteljau split). */
function partialCurve(c: Curve, d: number): Curve {
  return { a: c.a, c: { x: c.a.x + (c.c.x - c.a.x) * d, y: c.a.y + (c.c.y - c.a.y) * d }, b: pointAt(c, d) };
}

/** HTML text with chemical-formula subscripts (H2O → H₂O). */
const ChemHtml: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.split(/(\d+)/);
  return (
    <>
      {parts.map((part, i) => (/^\d+$/.test(part) && i > 0 && /[A-Za-z)]$/.test(parts[i - 1]) ? <sub key={i}>{part}</sub> : <span key={i}>{part}</span>))}
    </>
  );
};

export const Illustration: React.FC<SceneComponentProps> = ({ props, cue, style, duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const c = style.colors;
  const tech = style.look === "tech";
  setActorLook(style.look);
  const area = safeAreaFor(style);
  const H = area.contentBottom - area.contentTop;
  const GROUND_Y = H * GROUND_FRACTION;
  const specs: ActorSpec[] = props.actors ?? [];
  const flows: FlowSpec[] = props.flows ?? [];

  const actors: PlacedActor[] = specs.map((a, i) => {
    const { def, kind } = resolveActorKind(a.kind);
    const px = SIZES[a.size ?? "m"] ?? SIZES.m;
    let cy = (a.y / 100) * H;
    // With a ground, things that stand (plants, people, houses…) and sit in the lower half snap onto it.
    const base = BASE_Y[kind];
    if (props.ground && base !== undefined && a.y >= 45) cy = GROUND_Y - (base / 200 - 0.5) * px;
    return { ...a, def, resolvedKind: kind, px, cx: (a.x / 100) * W, cy, at: cue[a.id] ?? i * 12 };
  });
  separateActors(actors, H);
  const byId = new Map(actors.map((a) => [a.id, a]));

  /** Resolves "plant", "plant.roots" or an edge name to a point; `shorten` stops arrows at the object's edge. */
  const endpoint = (ref: string): { pt: Pt; shorten: number } | null => {
    const [id, anchor] = ref.split(".");
    const a = byId.get(id);
    if (!a) return null;
    const anchorPt = anchor ? a.def.anchors?.[anchor] : undefined;
    if (anchorPt) {
      return { pt: { x: a.cx - a.px / 2 + (anchorPt[0] / 200) * a.px, y: a.cy - a.px / 2 + (anchorPt[1] / 200) * a.px }, shorten: 6 };
    }
    return { pt: { x: a.cx, y: a.cy }, shorten: a.px * (a.def.radius ?? 0.42) };
  };
  const edgePoint = (edge: string, other: Pt): Pt =>
    edge === "left" ? { x: -40, y: other.y } : edge === "right" ? { x: W + 40, y: other.y } : edge === "top" ? { x: other.x, y: -40 } : { x: other.x, y: H + 40 };

  const zoom = interpolate(frame, [0, duration], [1, 1.06]);
  const groundP = progress(frame, 0, 14);

  return (
    <AbsoluteFill style={{ top: area.contentTop, left: area.sideX, width: W, height: H, overflow: "visible" }}>
      <div style={{ position: "absolute", inset: 0, transform: `scale(${zoom})`, transformOrigin: "50% 60%" }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          <defs>
            <filter id="ill-glow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <linearGradient id="ill-horizon" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={style.accents.green} stopOpacity={0.18} />
              <stop offset="100%" stopColor={style.accents.green} stopOpacity={0} />
            </linearGradient>
          </defs>
          {props.ground && tech ? (
            <g opacity={groundP}>
              <rect x={-120} y={GROUND_Y} width={W + 240} height={H - GROUND_Y + 40} fill="url(#ill-horizon)" />
              <line x1={-120} x2={W + 120} y1={GROUND_Y} y2={GROUND_Y} stroke={style.accents.green} strokeWidth={3} filter="url(#ill-glow)" />
              {Array.from({ length: 13 }, (_, k) => (
                <line key={k} x1={W / 2} y1={GROUND_Y} x2={W / 2 + (k - 6) * 220} y2={H + 60} stroke={style.accents.green} strokeOpacity={0.12} strokeWidth={1.5} />
              ))}
            </g>
          ) : null}
          {props.ground && !tech ? (
            <g transform={`translate(0 ${(1 - groundP) * 160})`}>
              <rect x={-120} y={GROUND_Y - 8} width={W + 240} height={H - GROUND_Y + 8} rx={36} fill={NATURE.soil} opacity={0.9} />
              <rect x={-120} y={GROUND_Y - 14} width={W + 240} height={30} rx={15} fill={NATURE.leaf} />
              {[0.12, 0.3, 0.55, 0.78, 0.92].map((f, k) => (
                <ellipse key={k} cx={W * f} cy={GROUND_Y + 60 + (k % 2) * 40} rx={18} ry={9} fill={NATURE.soilDark} opacity={0.5} />
              ))}
            </g>
          ) : null}

          {/* Beams sit behind objects; particles and arrows are drawn on top. */}
          {flows.map((f, i) => renderFlow(f, i, "under"))}
          {actors.map((a) => {
            if (frame < a.at) return null;
            const p = progress(frame, a.at);
            const t = (frame - a.at) / fps;
            const Draw = a.def.draw;
            return (
              <g key={a.id} transform={`translate(${a.cx - a.px / 2} ${a.cy - a.px / 2}) scale(${a.px / 200})`} filter={tech ? "url(#ill-glow)" : undefined}>
                <Draw p={p} t={t} label={a.label} accent={c.primary} kind={a.resolvedKind} />
              </g>
            );
          })}
          {flows.map((f, i) => renderFlow(f, i, "over"))}
        </svg>

        {/* Labels as HTML so Hindi text shapes and wraps properly. */}
        {actors.map((a) => {
          if (!a.label || a.def.labelInside) return null;
          const lp = progress(frame, a.at + 10, 14);
          if (lp <= 0) return null;
          const pos = labelPosition(a, actors, H);
          return (
            <div
              key={`l-${a.id}`}
              style={{
                position: "absolute",
                left: pos.x,
                top: pos.y,
                transform: `translate(-50%, -50%) scale(${0.8 + 0.2 * lp})`,
                opacity: lp,
                ...(tech ? {} : pill(c.surface, c.text, c.primary)),
              }}
            >
              {tech ? (
                <Chip color={style.accents.cyan} style={style} size={30}>
                  <ChemHtml text={a.label} />
                </Chip>
              ) : (
                <ChemHtml text={a.label} />
              )}
            </div>
          );
        })}
        {flows.map((f, i) => {
          const geo = flowGeometry(f, i);
          if (!geo || !f.label || isBubbleLabel(f.label)) return null;
          const d = (frame - geo.at) / FLOW_DRAW_FRAMES;
          const lp = interpolate(d, [0.6, 1.4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          if (lp <= 0) return null;
          const mid = pointAt(geo.curve, 0.5);
          const ang = (tangentAngle(geo.curve, 0.5) * Math.PI) / 180;
          const off = 52 * (i % 2 ? 1 : -1);
          return (
            <div
              key={`fl-${f.id}`}
              style={{
                position: "absolute",
                left: mid.x - Math.sin(ang) * off,
                top: mid.y + Math.cos(ang) * off,
                transform: `translate(-50%, -50%) scale(${0.8 + 0.2 * lp})`,
                opacity: lp,
                ...(tech ? {} : pill(geo.color, "#FFFFFF", geo.color)),
              }}
            >
              {tech ? (
                <Chip color={geo.color} style={style} size={28}>
                  <ChemHtml text={f.label} />
                </Chip>
              ) : (
                <ChemHtml text={f.label} />
              )}
            </div>
          );
        })}

        {props.title && !tech ? (
          <div
            style={{
              position: "absolute",
              top: -10,
              left: 0,
              right: 0,
              textAlign: "center",
              fontSize: 64,
              fontWeight: 800,
              color: c.text,
              opacity: progress(frame, cue.title ?? 0, 12),
              textWrap: "balance",
            }}
          >
            {props.title}
          </div>
        ) : null}
      </div>
    </AbsoluteFill>
  );

  function flowGeometry(f: FlowSpec, i: number) {
    const fromEdge = EDGES.has(f.from);
    const toEdge = EDGES.has(f.to);
    const A = fromEdge ? null : endpoint(f.from);
    const B = toEdge ? null : endpoint(f.to);
    if ((!fromEdge && !A) || (!toEdge && !B) || (fromEdge && toEdge)) return null;
    let a = A ? A.pt : edgePoint(f.from, B!.pt);
    let b = B ? B.pt : edgePoint(f.to, A!.pt);
    if (A) a = moveToward(a, b, A.shorten);
    if (B) b = moveToward(b, a, B.shorten);
    const style = f.style ?? "particles";
    const curve = makeCurve(a, b, style === "beam" ? 0.04 : 0.16 * (i % 2 ? 1 : -1));
    const fromActor = byId.get(f.from.split(".")[0]);
    const toActor = byId.get(f.to.split(".")[0]);
    // A flow never starts before both of its ends are on screen.
    const endsVisible = Math.max(fromActor ? fromActor.at + 10 : 0, toActor ? toActor.at + 10 : 0);
    const at = Math.max(cue[f.id] ?? (toActor ? toActor.at + 14 : 20), endsVisible);
    const color = FLOW_COLORS[(f.kind ?? "").toLowerCase()] ?? c.accent;
    return { curve, at, color, style };
  }

  function renderFlow(f: FlowSpec, i: number, layer: "under" | "over") {
    const geo = flowGeometry(f, i);
    if (!geo || frame < geo.at) return null;
    const isBeam = geo.style === "beam";
    if ((layer === "under") !== isBeam) return null;
    const d = Math.min(1, (frame - geo.at) / FLOW_DRAW_FRAMES);
    const drawn = partialCurve(geo.curve, d);
    const path = curvePath(drawn);

    if (isBeam) {
      return (
        <g key={f.id} filter={tech ? "url(#ill-glow)" : undefined}>
          <path d={path} stroke={geo.color} strokeWidth={46} strokeLinecap="round" fill="none" opacity={0.28} />
          <path d={path} stroke={geo.color} strokeWidth={22} strokeLinecap="round" fill="none" opacity={0.55} />
          <path d={path} stroke="#FFFFFF" strokeWidth={8} strokeLinecap="round" strokeDasharray="26 40" strokeDashoffset={-frame * 7} fill="none" opacity={0.85} />
        </g>
      );
    }

    const head = d >= 0.95 ? pointAt(geo.curve, 1) : null;
    const headAngle = tangentAngle(geo.curve, 1);
    const arrowHead = head ? (
      <polygon points="0,-16 28,0 0,16" fill={geo.color} transform={`translate(${head.x} ${head.y}) rotate(${headAngle}) translate(-20 0)`} />
    ) : null;

    if (geo.style === "arrow") {
      return (
        <g key={f.id} filter={tech ? "url(#ill-glow)" : undefined}>
          <path d={path} stroke={geo.color} strokeWidth={10} strokeLinecap="round" fill="none" />
          {arrowHead}
        </g>
      );
    }

    const bubble = f.label && isBubbleLabel(f.label) ? f.label : null;
    const count = bubble ? 3 : 4;
    return (
      <g key={f.id} filter={tech ? "url(#ill-glow)" : undefined}>
        <path d={path} stroke={geo.color} strokeWidth={7} strokeLinecap="round" strokeDasharray="2 18" fill="none" opacity={0.8} />
        {arrowHead}
        {Array.from({ length: count }, (_, k) => {
          const s = ((frame - geo.at) / PARTICLE_TRIP_FRAMES + k / count) % 1;
          if (s > d) return null;
          const pt = pointAt(geo.curve, s);
          const fade = Math.min(1, s * 6, (1 - s) * 6);
          return bubble ? (
            <g key={k} transform={`translate(${pt.x} ${pt.y})`} opacity={fade}>
              <circle r={34} fill={geo.color} stroke="#FFFFFF" strokeWidth={4} />
              <text textAnchor="middle" dominantBaseline="central" fontSize={bubble.length <= 2 ? 30 : 24} fontWeight={800} fill="#FFFFFF">
                <Chem text={bubble} />
              </text>
            </g>
          ) : (
            <circle key={k} cx={pt.x} cy={pt.y} r={14} fill={geo.color} stroke="#FFFFFF" strokeWidth={3} opacity={fade} />
          );
        })}
      </g>
    );
  }
};

/** Visual radius of an actor (drawings leave some empty margin in their 200x200 box). */
const radiusOf = (a: PlacedActor) => a.px * 0.44;
/** Space kept between objects so the flows between them stay visible. */
const MIN_GAP = 70;

/** Pushes overlapping actors apart and keeps them inside the picture. Grounded ones only move sideways. */
function separateActors(actors: PlacedActor[], H: number) {
  // If the objects can't all fit side by side, shrink them a little and try again.
  for (let round = 0; round < 4; round++) {
    if (spreadOnce(actors, H)) return;
    for (const a of actors) a.px *= 0.86;
  }
}

/** Returns true when no two actors overlap after relaxing their positions. */
function spreadOnce(actors: PlacedActor[], H: number): boolean {
  const grounded = (a: PlacedActor) => BASE_Y[a.resolvedKind] !== undefined;
  for (let iter = 0; iter < 30; iter++) {
    let moved = false;
    for (let i = 0; i < actors.length; i++) {
      for (let j = i + 1; j < actors.length; j++) {
        const a = actors[i];
        const b = actors[j];
        const dx = b.cx - a.cx;
        const dy = b.cy - a.cy;
        const dist = Math.hypot(dx, dy) || 1;
        const min = radiusOf(a) + radiusOf(b) + MIN_GAP;
        if (dist >= min) continue;
        const push = (min - dist) / 2 + 1;
        const ux = dist > 1 ? dx / dist : 1;
        const uy = dist > 1 ? dy / dist : 0;
        if (!grounded(a)) a.cy -= uy * push;
        if (!grounded(b)) b.cy += uy * push;
        a.cx -= ux * push;
        b.cx += ux * push;
        moved = true;
      }
    }
    for (const a of actors) {
      const r = radiusOf(a);
      a.cx = Math.min(W - r * 0.8, Math.max(r * 0.8, a.cx));
      a.cy = Math.min(H - r * 0.6, Math.max(r * 0.6, a.cy));
    }
    if (!moved) break;
  }
  for (let i = 0; i < actors.length; i++) {
    for (let j = i + 1; j < actors.length; j++) {
      const d = Math.hypot(actors[j].cx - actors[i].cx, actors[j].cy - actors[i].cy);
      if (d < radiusOf(actors[i]) + radiusOf(actors[j]) + MIN_GAP * 0.9) return false;
    }
  }
  return true;
}

/** Puts an actor's label below it, or above / beside it when another actor or the edge is in the way. */
function labelPosition(a: PlacedActor, all: PlacedActor[], H: number): Pt {
  const r = radiusOf(a);
  const candidates: Pt[] = [
    { x: a.cx, y: a.cy + r + 40 },
    { x: a.cx, y: a.cy - r - 40 },
    { x: a.cx + r + 110, y: a.cy },
    { x: a.cx - r - 110, y: a.cy },
  ];
  const clear = (p: Pt) =>
    p.y > 40 &&
    p.y < H - 20 &&
    p.x > 90 &&
    p.x < W - 90 &&
    all.every((o) => o === a || Math.hypot(o.cx - p.x, o.cy - p.y) > radiusOf(o) + 40);
  return candidates.find(clear) ?? candidates[0];
}

/** Short labels like CO2, O2, H2O ride inside the moving particles instead of a separate tag. */
function isBubbleLabel(label: string): boolean {
  return /^[A-Za-z0-9+\-]{1,4}$/.test(label.replace(/\s/g, ""));
}

function pill(bg: string, color: string, border: string): React.CSSProperties {
  return {
    background: bg,
    color,
    border: `4px solid ${border}`,
    borderRadius: 999,
    padding: "8px 26px",
    fontSize: 40,
    fontWeight: 700,
    whiteSpace: "nowrap",
    boxShadow: "0 10px 26px rgba(15,23,42,0.18)",
  };
}
