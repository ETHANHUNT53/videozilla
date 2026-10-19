/**
 * Checks on pasted notes (F2.4) that need no AI call, shared by the API and the page (import from
 * `@videozilla/ai/notes`: no dependencies, so it's safe in the browser bundle). See docs/features/F2.4-notes-brief.md.
 */

/**
 * Less content than this (in code points, any script) is not something to explain. Content is letters with the marks
 * that follow them (Devanagari vowel signs such as ा ि ी are marks, so short Hindi notes need them counted), plus
 * digits. Marks without a letter don't count: emoji variation selectors (❤️, ✔️), keycaps (1️⃣) and stray accents or
 * vowel signs on their own are not content (QA, 2026-10-19).
 */
export const MIN_NOTES_CONTENT = 20;

const URL_RE = /\b(?:https?:\/\/|www\.)\S+/giu;
/** A letter and the marks attached to it, or one digit (a keycap's marks are left out). */
const CONTENT_RE = /\p{L}\p{M}*|\p{N}/gu;
const LETTER_RE = /\p{L}\p{M}*/gu;

/** Code points of content (see MIN_NOTES_CONTENT). */
const contentLength = (s: string, re: RegExp) => (s.match(re) ?? []).reduce((n, m) => n + Array.from(m).length, 0);

export type NotesProblem = "empty" | "links_only";

/** Why these notes can't become a brief, or null when they can. */
export function notesProblem(text: string): NotesProblem | null {
  const withoutLinks = text.replace(URL_RE, " ");
  if (contentLength(withoutLinks, CONTENT_RE) >= MIN_NOTES_CONTENT) return null;
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
  // Each letter with its marks, weighted by length (vowel signs belong to their letter's script).
  const letters = text.replace(URL_RE, " ").match(LETTER_RE) ?? [];
  const total = letters.reduce((n, m) => n + Array.from(m).length, 0);
  if (total < MIN_NOTES_CONTENT) return null;
  let deva = 0;
  let latin = 0;
  for (const m of letters) {
    const size = Array.from(m).length;
    if (/^\p{Script=Devanagari}/u.test(m)) deva += size;
    else if (/^\p{Script=Latin}/u.test(m)) latin += size;
  }
  if (deva / total >= 0.5) return "hi";
  if (latin / total >= 0.5) return "en";
  return "other";
}
