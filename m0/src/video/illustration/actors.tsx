import { useId } from "react";
import { Icon } from "../Icon";
import type { Look } from "../styles";
import { NATURE as N } from "./palette";

/**
 * How shapes are painted. "card": flat colour fills. "tech": glowing line-art — a bright outline over a dark tint of
 * the same colour, so overlapping parts still read as clean silhouettes on a black background.
 * Set once per frame by the Illustration scene (a video uses a single look throughout).
 */
let LOOK: Look = "card";
export const setActorLook = (look: Look) => {
  LOOK = look;
};

const hexToRgb = (hex: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (rgb: [number, number, number], target: number, amount: number) => rgb.map((v) => v + (target - v) * amount);

export function paint(color: string): { fill: string; stroke?: string; strokeWidth?: number; fillOpacity?: number } {
  if (LOOK === "card") return { fill: color };
  const rgb = hexToRgb(color);
  if (!rgb) return { fill: color, fillOpacity: 0.15, stroke: color, strokeWidth: 3 };
  const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  // Dark source colours get a lighter outline so they still show on black.
  const line = luminance < 0.35 ? toHex(mix(rgb, 255, 0.45)) : color;
  return { fill: toHex(mix(rgb, 6, 0.84)), stroke: line, strokeWidth: 3 };
}

/** White highlight specks: solid in card look, a faint sheen in tech look. */
export const shine = () => (LOOK === "card" ? { fill: "#FFFFFF" } : { fill: "#FFFFFF", fillOpacity: 0.1 });

/**
 * Animated illustration "actors". Each draws inside a 200 x 200 viewBox.
 *  p = entrance progress (0 → 1), t = seconds since the actor appeared (for idle motion).
 */
export interface DrawProps {
  p: number;
  t: number;
  label?: string;
  accent: string;
  kind: string;
}

export interface ActorDef {
  draw: React.FC<DrawProps>;
  /** Named attachment points (viewBox units) that flows can start or end at. */
  anchors?: Record<string, [number, number]>;
  /** Fraction of the drawn size at which arrows stop short of the centre. */
  radius?: number;
  /** Molecules draw their label inside, so no label pill underneath. */
  labelInside?: boolean;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** Remaps p so a part animates only during [start, end] of the entrance. */
const part = (p: number, start: number, end = 1) => clamp01((p - start) / (end - start));

/** Writes chemical formulas with subscripts: CO2 → CO₂. */
export const Chem: React.FC<{ text: string }> = ({ text }) => {
  const pieces = text.split(/(\d+)/);
  return (
    <>
      {pieces.map((piece, i) =>
        /^\d+$/.test(piece) && i > 0 && /[A-Za-z)]$/.test(pieces[i - 1]) ? (
          <tspan key={i} fontSize="0.62em" baselineShift="sub">
            {piece}
          </tspan>
        ) : (
          <tspan key={i}>{piece}</tspan>
        ),
      )}
    </>
  );
};

const Sun: React.FC<DrawProps> = ({ p, t }) => {
  const glow = 1 + 0.06 * Math.sin(t * 3);
  return (
    <g>
      <circle cx={100} cy={100} r={94 * glow * p} {...paint(N.sunGlow)} opacity={0.35} />
      <g transform={`rotate(${t * 18} 100 100)`} opacity={part(p, 0.3)}>
        {Array.from({ length: 12 }, (_, i) => (
          <rect key={i} x={95} y={6} width={10} height={28 * part(p, 0.3)} rx={5} {...paint(N.sunDeep)} transform={`rotate(${i * 30} 100 100)`} />
        ))}
      </g>
      <circle cx={100} cy={100} r={54 * p} {...paint(N.sun)} stroke={N.sunDeep} strokeWidth={5} />
      <circle cx={84} cy={84} r={14 * p} {...shine()} opacity={0.35} />
    </g>
  );
};

const Moon: React.FC<DrawProps> = ({ p, t }) => (
  <g opacity={p} transform={`rotate(${Math.sin(t) * 4} 100 100)`}>
    <circle cx={100} cy={100} r={90} {...paint("#E0E7FF")} opacity={0.18} />
    <path d="M125 28 A 72 72 0 1 0 125 172 A 58 58 0 1 1 125 28 Z" {...paint("#F1F5F9")} stroke="#CBD5E1" strokeWidth={4} />
    <circle cx={70} cy={80} r={9} {...paint("#CBD5E1")} />
    <circle cx={82} cy={130} r={6} {...paint("#CBD5E1")} />
  </g>
);

const Earth: React.FC<DrawProps> = ({ p, t }) => {
  const id = `earth${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const shift = -((t * 18) % 200);
  const blobs = (dx: number) => (
    <g transform={`translate(${dx} 0)`} {...paint(N.land)}>
      <path d="M40 60 Q 70 40 95 60 Q 105 90 80 100 Q 55 110 45 90 Z" />
      <path d="M120 110 Q 150 100 165 125 Q 160 160 130 160 Q 110 140 120 110 Z" />
      <path d="M60 130 Q 80 125 85 145 Q 70 165 55 150 Z" />
    </g>
  );
  return (
    <g transform={`translate(100 100) scale(${p}) translate(-100 -100)`}>
      <clipPath id={id}>
        <circle cx={100} cy={100} r={80} />
      </clipPath>
      <circle cx={100} cy={100} r={92} {...paint(N.sky)} opacity={0.25} />
      <circle cx={100} cy={100} r={80} {...paint(N.ocean)} />
      <g clipPath={`url(#${id})`}>
        {blobs(shift)}
        {blobs(shift + 200)}
      </g>
      <circle cx={100} cy={100} r={80} fill="none" stroke={N.oceanDeep} strokeWidth={5} />
      <ellipse cx={75} cy={70} rx={20} ry={12} {...shine()} opacity={0.25} />
    </g>
  );
};

const cloudShape = (fill: string, shade: string) => (
  <g>
    <ellipse cx={100} cy={142} rx={78} ry={14} {...paint(shade)} />
    <circle cx={62} cy={115} r={34} {...paint(fill)} />
    <circle cx={102} cy={92} r={46} {...paint(fill)} />
    <circle cx={144} cy={114} r={34} {...paint(fill)} />
    <rect x={58} y={105} width={92} height={42} rx={21} {...paint(fill)} />
  </g>
);

const Cloud: React.FC<DrawProps> = ({ p, t }) => (
  <g opacity={p} transform={`translate(${Math.sin(t * 0.8) * 6 + (1 - p) * -40} 0)`}>
    {cloudShape(N.cloud, N.cloudShade)}
  </g>
);

const RainCloud: React.FC<DrawProps> = ({ p, t }) => (
  <g opacity={p}>
    <g transform="translate(0 -20)">{cloudShape(N.rainCloud, N.rainCloudDark)}</g>
    {[55, 80, 105, 130, 150].map((x, i) => {
      const y = 140 + ((t * 110 + i * 23) % 55);
      return <line key={i} x1={x} y1={y} x2={x - 4} y2={y + 14} stroke={N.water} strokeWidth={6} strokeLinecap="round" opacity={part(p, 0.5) * (1 - (y - 140) / 60)} />;
    })}
  </g>
);

const leafPath = "M0 0 Q 22 -24 52 -6 Q 26 14 0 0 Z";

const Plant: React.FC<DrawProps> = ({ p, t }) => {
  const grow = part(p, 0, 0.6);
  const top = 170 - 112 * grow;
  const leaves = [
    { y: 142, dir: -1 },
    { y: 122, dir: 1 },
    { y: 100, dir: -1 },
    { y: 80, dir: 1 },
  ];
  return (
    <g>
      <ellipse cx={100} cy={180} rx={80} ry={20} {...paint(N.soil)} opacity={part(p, 0, 0.2)} />
      <g fill="none" stroke={N.root} strokeWidth={4} strokeLinecap="round" opacity={part(p, 0.1, 0.4)}>
        <path d="M100 172 Q 88 184 70 194" />
        <path d="M100 172 Q 110 186 130 195" />
        <path d="M100 172 L 100 198" />
      </g>
      <g transform={`rotate(${Math.sin(t * 1.6) * 2.5} 100 172)`}>
        <line x1={100} y1={172} x2={100} y2={top} stroke={N.stem} strokeWidth={9} strokeLinecap="round" />
        {leaves.map((l, i) => {
          const s = part(p, 0.25 + i * 0.12, 0.45 + i * 0.12);
          if (l.y < top) return null;
          return (
            <g key={i} transform={`translate(100 ${l.y}) scale(${l.dir * s * 1.25} ${s * 1.25}) rotate(${-18 + Math.sin(t * 2 + i) * 4})`}>
              <path d={leafPath} {...paint(i % 2 ? N.leaf : N.leafDark)} />
              <path d="M2 0 Q 24 -8 46 -6" stroke={N.leafLight} strokeWidth={2} fill="none" />
            </g>
          );
        })}
        <g transform={`translate(100 ${top}) scale(${part(p, 0.7)})`}>
          <path d="M0 0 Q -20 -26 0 -46 Q 20 -26 0 0 Z" {...paint(N.leaf)} />
        </g>
      </g>
    </g>
  );
};

const Tree: React.FC<DrawProps> = ({ p, t }) => {
  const c = part(p, 0.3);
  return (
    <g>
      <rect x={88} y={112} width={24} height={82 * part(p, 0, 0.4)} rx={6} {...paint(N.bark)} transform={`translate(0 ${82 * (1 - part(p, 0, 0.4))})`} />
      <g transform={`rotate(${Math.sin(t * 1.3) * 2} 100 190) translate(100 110) scale(${c}) translate(-100 -110)`}>
        <circle cx={64} cy={104} r={38} {...paint(N.leafDark)} />
        <circle cx={136} cy={104} r={38} {...paint(N.leafDark)} />
        <circle cx={100} cy={76} r={56} {...paint(N.leaf)} />
        <circle cx={100} cy={46} r={36} {...paint(N.leaf)} />
        <circle cx={82} cy={60} r={12} {...paint(N.leafLight)} opacity={0.6} />
      </g>
    </g>
  );
};

const Leaf: React.FC<DrawProps> = ({ p, t }) => (
  <g transform={`translate(100 100) scale(${p}) rotate(${Math.sin(t * 1.2) * 3}) translate(-100 -100)`}>
    <path d="M30 168 Q 34 44 172 28 Q 166 152 30 168 Z" {...paint(N.leaf)} stroke={N.leafDark} strokeWidth={5} />
    <path d="M30 168 Q 96 104 172 28" stroke={N.leafDark} strokeWidth={5} fill="none" />
    {[0.3, 0.5, 0.7].map((f, i) => (
      <g key={i} stroke={N.leafDark} strokeWidth={3} fill="none">
        <path d={`M${30 + 142 * f} ${168 - 140 * f} q -30 -6 -40 -34`} />
        <path d={`M${30 + 142 * f} ${168 - 140 * f} q 30 6 40 34`} />
      </g>
    ))}
    {[0, 1, 2, 3, 4].map((i) => (
      <ellipse key={i} cx={70 + i * 20} cy={130 - i * 18} rx={7} ry={5} {...paint(N.leafLight)} opacity={0.5 + 0.5 * Math.sin(t * 4 + i)} />
    ))}
  </g>
);

const WaterDrop: React.FC<DrawProps> = ({ p, t }) => (
  <g transform={`translate(0 ${Math.sin(t * 2) * 5}) translate(100 120) scale(${p}) translate(-100 -120)`}>
    <path d="M100 18 C 100 18 44 96 44 132 A 56 56 0 0 0 156 132 C 156 96 100 18 100 18 Z" {...paint(N.water)} stroke={N.waterDark} strokeWidth={5} />
    <ellipse cx={78} cy={128} rx={10} ry={20} {...shine()} opacity={0.5} />
  </g>
);

const Flame: React.FC<DrawProps> = ({ p, t }) => {
  const f = 1 + 0.06 * Math.sin(t * 14) + 0.03 * Math.sin(t * 23);
  return (
    <g transform={`translate(100 190) scale(${p} ${p * f}) translate(-100 -190)`}>
      <path d="M100 20 C 132 70 162 96 152 142 C 146 176 122 190 100 190 C 78 190 54 176 48 142 C 40 100 74 80 100 20 Z" {...paint(N.fire)} />
      <path d="M100 80 C 118 110 134 128 128 156 C 124 176 112 186 100 186 C 88 186 76 176 72 156 C 66 128 84 112 100 80 Z" {...paint(N.fireCore)} />
    </g>
  );
};

const Person: React.FC<DrawProps> = ({ p, t }) => (
  <g opacity={p} transform={`translate(0 ${(1 - p) * 30 + Math.sin(t * 2) * 2})`}>
    <rect x={76} y={146} width={20} height={46} rx={8} {...paint(N.pants)} />
    <rect x={104} y={146} width={20} height={46} rx={8} {...paint(N.pants)} />
    <g transform={`rotate(${20 + Math.sin(t * 3) * 8} 74 96)`}>
      <rect x={66} y={92} width={16} height={56} rx={8} {...paint(N.skin)} />
    </g>
    <g transform={`rotate(${-20 - Math.sin(t * 3 + 1) * 8} 126 96)`}>
      <rect x={118} y={92} width={16} height={56} rx={8} {...paint(N.skin)} />
    </g>
    <rect x={70} y={84} width={60} height={72} rx={22} {...paint(N.shirt)} />
    <circle cx={100} cy={54} r={28} {...paint(N.skin)} />
    <path d="M72 50 Q 76 22 100 24 Q 126 22 128 50 Q 112 36 72 50 Z" {...paint("#1F2937")} />
    <circle cx={90} cy={56} r={3.5} {...paint("#1F2937")} />
    <circle cx={110} cy={56} r={3.5} {...paint("#1F2937")} />
    <path d="M90 66 Q 100 74 110 66" stroke="#1F2937" strokeWidth={3} fill="none" strokeLinecap="round" />
  </g>
);

const House: React.FC<DrawProps> = ({ p, t }) => (
  <g opacity={p} transform={`translate(100 190) scale(${0.8 + 0.2 * p}) translate(-100 -190)`}>
    <rect x={130} y={42} width={18} height={40} {...paint(N.barkDark)} />
    <rect x={40} y={96} width={120} height={94} {...paint(N.wall)} />
    <polygon points="24,102 100,34 176,102" {...paint(N.roof)} />
    <rect x={88} y={136} width={26} height={54} rx={4} {...paint(N.bark)} />
    <rect x={52} y={114} width={28} height={26} rx={3} {...paint(N.glass)} stroke={N.barkDark} strokeWidth={3} />
    <rect x={52} y={114} width={28} height={26} rx={3} {...paint(N.sun)} opacity={0.3 + 0.2 * Math.sin(t * 2)} />
  </g>
);

const Factory: React.FC<DrawProps> = ({ p, t }) => (
  <g opacity={p}>
    {[0, 1, 2, 3].map((i) => {
      const k = (t * 0.6 + i * 0.25) % 1;
      return <circle key={i} cx={141 + Math.sin(k * 6) * 6 + k * 20} cy={34 - k * 50} r={10 + k * 18} {...paint(N.cloudShade)} opacity={(1 - k) * 0.8 * part(p, 0.5)} />;
    })}
    <rect x={130} y={36} width={22} height={80} {...paint(N.metalDark)} />
    <polygon points="25,110 25,80 65,100 65,80 105,100 105,80 145,110" {...paint(N.metal)} />
    <rect x={25} y={108} width={150} height={82} {...paint(N.metal)} />
    {[45, 85, 125].map((x) => (
      <rect key={x} x={x} y={130} width={24} height={20} rx={3} {...paint(N.glass)} opacity={0.6 + 0.4 * Math.sin(t * 3 + x)} />
    ))}
  </g>
);

const Lightbulb: React.FC<DrawProps> = ({ p, t }) => (
  <g>
    <circle cx={100} cy={84} r={84} {...paint(N.sun)} opacity={(0.22 + 0.12 * Math.sin(t * 4)) * part(p, 0.4)} />
    <g opacity={p}>
      <circle cx={100} cy={84} r={52} {...paint(N.glass)} stroke={N.sunDeep} strokeWidth={5} />
      <path d="M84 98 L 90 76 L 98 96 L 106 76 L 114 98" stroke={N.sunDeep} strokeWidth={4} fill="none" strokeLinejoin="round" />
      <rect x={78} y={134} width={44} height={14} rx={4} {...paint(N.metal)} />
      <rect x={80} y={150} width={40} height={12} rx={4} {...paint(N.metalDark)} />
      <rect x={86} y={164} width={28} height={10} rx={4} {...paint(N.metal)} />
    </g>
  </g>
);

const Battery: React.FC<DrawProps> = ({ p, t }) => {
  const level = part(p, 0.2) * (0.82 + 0.06 * Math.sin(t * 3));
  return (
    <g opacity={part(p, 0, 0.3)}>
      <rect x={82} y={30} width={36} height={16} rx={4} {...paint(N.metalDark)} />
      <rect x={50} y={44} width={100} height={146} rx={16} {...shine()} stroke={N.metalDark} strokeWidth={8} />
      <rect x={62} y={56 + 122 * (1 - level)} width={76} height={122 * level} rx={8} {...paint(N.leaf)} />
      <path d="M106 70 L 84 120 L 102 120 L 92 162 L 120 104 L 102 104 Z" {...paint(N.fireCore)} stroke={N.sunDeep} strokeWidth={3} />
    </g>
  );
};

const Atom: React.FC<DrawProps> = ({ p, t }) => (
  <g transform={`translate(100 100) scale(${p}) translate(-100 -100)`}>
    {[0, 60, 120].map((rot, k) => {
      const a = t * 2.6 + k * 2.1;
      const ex = 82 * Math.cos(a);
      const ey = 30 * Math.sin(a);
      const r = (rot * Math.PI) / 180;
      return (
        <g key={k}>
          <ellipse cx={100} cy={100} rx={82} ry={30} fill="none" stroke={N.electron} strokeWidth={4} opacity={0.7} transform={`rotate(${rot} 100 100)`} />
          <circle cx={100 + ex * Math.cos(r) - ey * Math.sin(r)} cy={100 + ex * Math.sin(r) + ey * Math.cos(r)} r={9} {...paint(N.electron)} />
        </g>
      );
    })}
    <circle cx={92} cy={96} r={13} {...paint(N.proton)} />
    <circle cx={108} cy={98} r={13} {...paint(N.metal)} />
    <circle cx={100} cy={110} r={13} {...paint(N.proton)} />
  </g>
);

const MOLECULE_COLORS: Record<string, string> = { co2: "#64748B", o2: "#3B82F6", h2o: "#0EA5E9", n2: "#8B5CF6", ch4: "#F97316", h2: "#14B8A6" };

const Molecule: React.FC<DrawProps> = ({ p, t, label, accent }) => {
  const key = (label ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const color = MOLECULE_COLORS[key] ?? accent;
  const text = label ?? "";
  const size = text.length <= 3 ? 64 : text.length <= 5 ? 48 : 34;
  return (
    <g transform={`translate(0 ${Math.sin(t * 2.2) * 5}) translate(100 100) scale(${p}) translate(-100 -100)`}>
      <circle cx={100} cy={100} r={78} {...paint(color)} />
      <circle cx={76} cy={74} r={18} {...shine()} opacity={0.3} />
      <text x={100} y={100} textAnchor="middle" dominantBaseline="central" fontSize={size} fontWeight={800} fill="#FFFFFF">
        <Chem text={text} />
      </text>
    </g>
  );
};

const Cell: React.FC<DrawProps> = ({ p, t }) => {
  const w = 1 + 0.025 * Math.sin(t * 2);
  return (
    <g transform={`translate(100 100) scale(${p * w} ${p / w}) translate(-100 -100)`}>
      <ellipse cx={100} cy={100} rx={90} ry={72} {...paint(N.cellWall)} stroke={N.cellEdge} strokeWidth={6} />
      <circle cx={92} cy={96} r={26} {...paint(N.nucleus)} />
      <circle cx={88} cy={92} r={9} {...paint("#7C3AED")} />
      <ellipse cx={140} cy={80} rx={16} ry={8} {...paint(N.leaf)} transform="rotate(25 140 80)" />
      <ellipse cx={136} cy={128} rx={14} ry={7} {...paint(N.fire)} opacity={0.8} />
      <ellipse cx={55} cy={126} rx={13} ry={7} {...paint(N.leaf)} transform="rotate(-20 55 126)" />
    </g>
  );
};

const Heart: React.FC<DrawProps> = ({ p, t }) => {
  const beat = 1 + 0.08 * Math.max(0, Math.sin(t * 6));
  return (
    <g transform={`translate(100 110) scale(${p * beat}) translate(-100 -110)`}>
      <path d="M100 178 C 40 132 14 96 30 60 C 46 26 90 30 100 62 C 110 30 154 26 170 60 C 186 96 160 132 100 178 Z" {...paint(N.heart)} />
      <ellipse cx={62} cy={66} rx={14} ry={9} {...shine()} opacity={0.35} />
    </g>
  );
};

const Mountain: React.FC<DrawProps> = ({ p }) => (
  <g opacity={p} transform={`translate(0 ${(1 - p) * 40})`}>
    <polygon points="10,190 84,62 160,190" {...paint(N.rockDark)} />
    <polygon points="60,190 134,44 196,190" {...paint(N.rock)} />
    <polygon points="134,44 116,80 128,74 140,84 152,74" {...paint(N.snow)} />
    <polygon points="84,62 70,88 82,82 92,90" {...paint(N.snow)} />
  </g>
);

const Ocean: React.FC<DrawProps> = ({ p, t }) => {
  const wave = (base: number, amp: number, speed: number) => {
    let d = `M 0 ${base}`;
    for (let x = 0; x <= 200; x += 10) d += ` L ${x} ${base + amp * Math.sin(x / 18 + t * speed)}`;
    return `${d} L 200 200 L 0 200 Z`;
  };
  return (
    <g opacity={p}>
      <path d={wave(90, 8, 2)} {...paint(N.ocean)} opacity={0.6} />
      <path d={wave(115, 9, -2.4)} {...paint(N.ocean)} />
      <path d={wave(145, 7, 1.6)} {...paint(N.oceanDeep)} />
    </g>
  );
};

const Rocket: React.FC<DrawProps> = ({ p, t }) => (
  <g transform={`translate(0 ${(1 - p) * 60 + Math.sin(t * 3) * 4})`} opacity={p}>
    <path d={`M88 150 Q 100 ${190 + Math.sin(t * 20) * 8} 112 150 Z`} {...paint(N.fire)} />
    <path d="M100 18 C 132 48 134 110 124 150 L 76 150 C 66 110 68 48 100 18 Z" {...paint("#F1F5F9")} stroke={N.metalDark} strokeWidth={4} />
    <circle cx={100} cy={78} r={15} {...paint(N.water)} stroke={N.metalDark} strokeWidth={4} />
    <path d="M76 116 L 54 154 L 78 148 Z" {...paint(N.fireRed)} />
    <path d="M124 116 L 146 154 L 122 148 Z" {...paint(N.fireRed)} />
  </g>
);

const Magnet: React.FC<DrawProps> = ({ p, t }) => (
  <g opacity={p}>
    {[30, 50].map((r, i) => (
      <path key={i} d={`M ${70 - r} 34 A ${30 + r} ${30 + r} 0 0 1 ${130 + r} 34`} fill="none" stroke={N.electron} strokeWidth={3} strokeDasharray="10 8" strokeDashoffset={-t * 30} opacity={0.7 * part(p, 0.5)} />
    ))}
    <path d="M58 40 L 58 116 A 42 42 0 0 0 142 116 L 142 40" fill="none" stroke={N.heart} strokeWidth={32} />
    <rect x={42} y={34} width={32} height={22} {...paint(N.metal)} />
    <rect x={126} y={34} width={32} height={22} {...paint(N.metal)} />
  </g>
);

/** Any concept without a custom drawing becomes a Lucide icon badge. */
export const IconActor: React.FC<DrawProps> = ({ p, t, kind, accent }) => (
  <g transform={`translate(0 ${Math.sin(t * 2) * 3}) translate(100 100) scale(${p}) translate(-100 -100)`}>
    <circle cx={100} cy={100} r={84} {...paint(accent)} />
    <circle cx={100} cy={100} r={84} {...shine()} opacity={0.12} />
    <g transform="translate(46 46)">
      <Icon name={kind.replace(/^icon:/, "")} size={108} color="#FFFFFF" strokeWidth={2} />
    </g>
  </g>
);

export const ACTORS: Record<string, ActorDef> = {
  sun: { draw: Sun, radius: 0.32 },
  moon: { draw: Moon },
  earth: { draw: Earth },
  cloud: { draw: Cloud, anchors: { bottom: [100, 145] } },
  "rain-cloud": { draw: RainCloud, anchors: { bottom: [100, 190] } },
  plant: { draw: Plant, anchors: { leaves: [100, 92], roots: [100, 192], top: [100, 50], base: [100, 172] }, radius: 0.3 },
  tree: { draw: Tree, anchors: { leaves: [100, 70], roots: [100, 194], base: [100, 190] } },
  leaf: { draw: Leaf },
  "water-drop": { draw: WaterDrop },
  flame: { draw: Flame },
  person: { draw: Person, anchors: { head: [100, 52], mouth: [100, 68], hand: [140, 150] } },
  house: { draw: House, anchors: { chimney: [139, 42], door: [101, 160] } },
  factory: { draw: Factory, anchors: { chimney: [141, 30] } },
  lightbulb: { draw: Lightbulb, anchors: { base: [100, 170] } },
  battery: { draw: Battery, anchors: { top: [100, 34], bottom: [100, 190] } },
  atom: { draw: Atom },
  molecule: { draw: Molecule, labelInside: true, radius: 0.38 },
  cell: { draw: Cell },
  heart: { draw: Heart },
  mountain: { draw: Mountain, anchors: { peak: [134, 50] } },
  ocean: { draw: Ocean, anchors: { surface: [100, 100] } },
  rocket: { draw: Rocket, anchors: { flame: [100, 180] } },
  magnet: { draw: Magnet },
};

/** Words the AI might use for the same drawing. */
export const ACTOR_ALIASES: Record<string, string> = {
  sunlight: "sun",
  "solar": "sun",
  planet: "earth",
  globe: "earth",
  world: "earth",
  rain: "rain-cloud",
  raincloud: "rain-cloud",
  storm: "rain-cloud",
  sapling: "plant",
  flower: "plant",
  crop: "plant",
  seedling: "plant",
  forest: "tree",
  water: "water-drop",
  drop: "water-drop",
  droplet: "water-drop",
  fire: "flame",
  bulb: "lightbulb",
  "light-bulb": "lightbulb",
  human: "person",
  student: "person",
  boy: "person",
  girl: "person",
  man: "person",
  woman: "person",
  people: "person",
  gas: "molecule",
  bubble: "molecule",
  co2: "molecule",
  oxygen: "molecule",
  sea: "ocean",
  river: "ocean",
  lake: "ocean",
  hill: "mountain",
};

export function resolveActorKind(kind: string): { def: ActorDef; kind: string } {
  const k = kind.trim().toLowerCase();
  const key = ACTORS[k] ? k : ACTOR_ALIASES[k];
  if (key && ACTORS[key]) return { def: ACTORS[key], kind: key };
  return { def: { draw: IconActor }, kind: k.startsWith("icon:") ? k : `icon:${k}` };
}

export const ACTOR_KINDS = Object.keys(ACTORS);
