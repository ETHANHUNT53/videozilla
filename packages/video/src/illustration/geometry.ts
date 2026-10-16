export interface Pt {
  x: number;
  y: number;
}

export interface Curve {
  a: Pt;
  c: Pt;
  b: Pt;
}

/** A gentle quadratic curve from a to b, bent sideways by `bend` (fraction of its length). */
export function makeCurve(a: Pt, b: Pt, bend: number): Curve {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { a, b, c: { x: mx - dy * bend, y: my + dx * bend } };
}

export function pointAt({ a, c, b }: Curve, t: number): Pt {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

export function tangentAngle({ a, c, b }: Curve, t: number): number {
  const dx = 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x);
  const dy = 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export function curvePath({ a, c, b }: Curve): string {
  return `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`;
}

export function curveLength(curve: Curve, steps = 24): number {
  let len = 0;
  let prev = curve.a;
  for (let i = 1; i <= steps; i++) {
    const p = pointAt(curve, i / steps);
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
  }
  return len;
}

/** Moves point `from` toward `to` by `dist` pixels (used to stop arrows at an object's edge). */
export function moveToward(from: Pt, to: Pt, dist: number): Pt {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const d = Math.min(dist, len * 0.4);
  return { x: from.x + (dx / len) * d, y: from.y + (dy / len) * d };
}
