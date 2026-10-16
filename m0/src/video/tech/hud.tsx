import { Easing, interpolate } from "remotion";
import { techMono, techSans } from "../fonts";
import type { VideoStyle } from "../styles";

/** Blur-in entrance used across the tech look (0 → 1). */
export function blurIn(frame: number, at: number | undefined, frames = 14): { p: number; style: React.CSSProperties } {
  const p = at === undefined ? 1 : interpolate(frame, [at, at + frames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return {
    p,
    style: { opacity: p, filter: p < 1 ? `blur(${(1 - p) * 14}px)` : undefined, transform: `translateY(${(1 - p) * 18}px) scale(${0.96 + 0.04 * p})` },
  };
}

export const glow = (color: string, strength = 1) => `0 0 ${18 * strength}px ${color}66, 0 0 ${42 * strength}px ${color}33`;

/** Monospace status chip with a glowing dot, like "● online 50 / 500". */
export const Chip: React.FC<{ color: string; style: VideoStyle; children: React.ReactNode; size?: number; dot?: boolean; css?: React.CSSProperties }> = ({
  color,
  style,
  children,
  size = 30,
  dot = true,
  css,
}) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 14,
      padding: `${size * 0.35}px ${size * 0.7}px`,
      borderRadius: 12,
      background: "rgba(255,255,255,0.035)",
      border: "1.5px solid rgba(255,255,255,0.10)",
      fontFamily: techMono,
      fontSize: size,
      color: style.colors.text,
      whiteSpace: "nowrap",
      ...css,
    }}
  >
    {dot ? <span style={{ width: size * 0.32, height: size * 0.32, borderRadius: "50%", background: color, boxShadow: glow(color, 0.6), flex: "0 0 auto" }} /> : null}
    {children}
  </div>
);

/** Glowing "system box" with a dotted border and monospace caps, like the reel's PRICING ENGINE node. */
export const NodeBox: React.FC<{ color: string; style: VideoStyle; children: React.ReactNode; size?: number; css?: React.CSSProperties }> = ({
  color,
  style,
  children,
  size = 34,
  css,
}) => (
  <div
    style={{
      padding: `${size * 0.7}px ${size * 1.3}px`,
      borderRadius: 26,
      border: `3px dotted ${color}`,
      background: "rgba(8,10,18,0.92)",
      boxShadow: `${glow(color)}, inset 0 0 22px ${color}22`,
      fontFamily: techMono,
      fontWeight: 600,
      fontSize: size,
      letterSpacing: 3,
      textTransform: "uppercase",
      color: style.colors.text,
      textAlign: "center",
      ...css,
    }}
  >
    {children}
  </div>
);

/** Large clean sans text for scene content. */
export const Big: React.FC<{ size: number; color: string; children: React.ReactNode; css?: React.CSSProperties }> = ({ size, color, children, css }) => (
  <div style={{ fontFamily: techSans, fontWeight: 600, fontSize: size, lineHeight: 1.15, color, letterSpacing: -0.5, textWrap: "balance", ...css }}>{children}</div>
);

/** Cycles the semantic accents so neighbouring items differ. */
export const accentAt = (style: VideoStyle, i: number) => [style.accents.cyan, style.accents.orange, style.accents.violet, style.accents.green][i % 4];
