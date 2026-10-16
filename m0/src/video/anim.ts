import { interpolate, spring } from "remotion";

/** 0 → 1 spring that starts at `at` (frame). Stays 0 before it. */
export function enter(frame: number, at: number | undefined, fps: number, damping = 14): number {
  if (at === undefined) return 1;
  return spring({ frame: frame - at, fps, config: { damping, mass: 0.7, stiffness: 140 } });
}

/** Standard entrance transform: fade + rise. */
export function enterStyle(p: number, distance = 50): React.CSSProperties {
  return {
    opacity: interpolate(p, [0, 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    transform: `translateY(${(1 - p) * distance}px) scale(${0.92 + 0.08 * p})`,
  };
}

/** Whole-scene fade in and out so cuts between scenes feel smooth. */
export function sceneOpacity(frame: number, duration: number): number {
  return interpolate(frame, [0, 6, duration - 6, duration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

/** Picks a font size that keeps `text` within `maxWidthPx` on roughly `maxLines` lines. */
export function fitFontSize(text: string, maxWidthPx: number, maxLines: number, max: number, min: number): number {
  const avgCharWidth = 0.56; // em, rough average for Poppins
  for (let size = max; size >= min; size -= 2) {
    const charsPerLine = maxWidthPx / (size * avgCharWidth);
    if (Math.ceil(text.length / charsPerLine) <= maxLines) return size;
  }
  return min;
}
