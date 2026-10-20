/**
 * The brief editor's key-point list (F2.8): 1 to 5 points in teaching order. Pure helpers, so the list rules are tested
 * apart from the page.
 */

export const MIN_KEY_POINTS = 1;
export const MAX_KEY_POINTS = 5;

/** Adds an empty point at the end (up to 5). */
export function addPoint(points: string[]): string[] {
  return points.length >= MAX_KEY_POINTS ? points : [...points, ""];
}

/** Removes point `index` (never the last one left). */
export function removePoint(points: string[], index: number): string[] {
  return points.length <= MIN_KEY_POINTS ? points : points.filter((_, i) => i !== index);
}

/** Moves point `index` one place up (-1) or down (+1); nothing at the ends. */
export function movePoint(points: string[], index: number, by: -1 | 1): string[] {
  const to = index + by;
  if (to < 0 || to >= points.length) return points;
  const next = [...points];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/**
 * The edits that differ from the brief, trimmed (empty key points and "Left out" lines dropped: an added point left
 * blank isn't an error), ready for `PATCH …/idea/brief`.
 */
export function briefEdits<T extends { title: string; hook: string; angle: string; keyPoints: string[]; outOfScope: string[] }>(brief: T, draft: T) {
  const clean = {
    title: draft.title.trim(),
    hook: draft.hook.trim(),
    angle: draft.angle.trim(),
    keyPoints: draft.keyPoints.map((k) => k.trim()).filter(Boolean),
    outOfScope: draft.outOfScope.map((k) => k.trim()).filter(Boolean),
  };
  return Object.fromEntries(
    (Object.keys(clean) as (keyof typeof clean)[]).filter((k) => JSON.stringify(clean[k]) !== JSON.stringify(brief[k])).map((k) => [k, clean[k]]),
  ) as Partial<typeof clean>;
}
