/**
 * Checks on pasted notes (F2.4) that need no AI call, shared by the API and the page (import from
 * `@videozilla/ai/notes`: no dependencies, so it's safe in the browser bundle). See docs/features/F2.4-notes-brief.md.
 */

/**
 * Fewer letters, marks or digits than this (in any script) is not something to explain. Marks count: Devanagari vowel
 * signs (ा ि ी े ो ं …) are `\p{M}`, not letters, so counting letters alone rejected short Hindi notes.
 */
export const MIN_NOTES_CONTENT = 20;

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/giu;
const CONTENT_RE = /[\p{L}\p{M}\p{N}]/gu;

export type NotesProblem = "empty" | "links_only";

/** Why these notes can't become a brief, or null when they can. */
export function notesProblem(text: string): NotesProblem | null {
  const content = (s: string) => (s.match(CONTENT_RE) ?? []).length;
  const withoutLinks = text.replace(URL_RE, " ");
  if (content(withoutLinks) >= MIN_NOTES_CONTENT) return null;
  // Only links (with maybe a word or two around them): say links aren't supported, not "paste something".
  return withoutLinks !== text ? "links_only" : "empty";
}

/** What to tell the user (the API's message and the page's hint). */
export const NOTES_PROBLEM_TEXT: Record<NotesProblem, string> = {
  empty: "Paste some text with content to explain.",
  links_only: "Paste the text content — links aren't supported yet.",
};

/**
 * The notes' language, guessed from the script of their letters (no AI): mostly Devanagari is Hindi, mostly Latin is
 * English (so Hinglish in Latin letters counts as English), otherwise another language. Null with too few letters.
 * Only a hint for the "your notes are in X" note.
 */
export function notesLanguage(text: string): "hi" | "en" | "other" | null {
  // Letters and marks (vowel signs belong to their script too).
  const letters = text.replace(URL_RE, " ").match(/[\p{L}\p{M}]/gu) ?? [];
  if (letters.length < MIN_NOTES_CONTENT) return null;
  let deva = 0;
  let latin = 0;
  for (const ch of letters) {
    if (/\p{Script=Devanagari}/u.test(ch)) deva++;
    else if (/\p{Script=Latin}/u.test(ch)) latin++;
  }
  if (deva / letters.length >= 0.5) return "hi";
  if (latin / letters.length >= 0.5) return "en";
  return "other";
}
