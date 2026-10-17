/**
 * Cuts `text` to at most `max` characters the way the database's `maxLength` counts them (code points), never in the
 * middle of an emoji or other character outside the BMP (String.slice would leave half a surrogate pair).
 */
export function truncateChars(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join("");
}
