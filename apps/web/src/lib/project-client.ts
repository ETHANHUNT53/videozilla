/**
 * Browser-side project edits shared by the Library cards and the project page (API Design §8, §13.2). Safe to import
 * from client components.
 */
import { ApiClientError, apiCall } from "./api-client";

/** Longest project title, in characters (code points), as the API and the database count it. */
export const TITLE_MAX_CHARS = 80;

/**
 * `PATCH /api/v1/projects/{id}` with `If-Match` set to the revision the caller last saw, so a change made in another
 * tab is never overwritten (that answers `412`; see `conflictCopy`).
 */
export async function patchProject<P extends { id: string; rev: number }>(
  project: Pick<P, "id" | "rev">,
  body: Record<string, unknown>,
): Promise<{ project: P; requiresRegeneration: boolean }> {
  const { data } = await apiCall<P & { requiresRegeneration?: boolean }>(`/api/v1/projects/${project.id}`, {
    method: "PATCH",
    body,
    headers: { "If-Match": `"${project.rev}"` },
  });
  const { requiresRegeneration = false, ...rest } = data;
  return { project: rest as unknown as P, requiresRegeneration };
}

/** The current project sent back with a `412` (it was changed in another tab), if that's what `err` is. */
export function conflictCopy<P>(err: unknown): P | undefined {
  return err instanceof ApiClientError && err.code === "PRECONDITION_FAILED" ? (err.details[0]?.current as P | undefined) : undefined;
}

/**
 * A message about a project. By default it is about one revision (e.g. "your rename wasn't saved") and is hidden once
 * any save moves the project on. A hint that stays true until the project's stage changes (e.g. "regenerate the
 * storyboard to use the new settings") sets `status` instead and is shown for as long as the project is in it.
 */
export interface RevNote<T = string> {
  value: T;
  rev: number;
  /** Keep showing while the project is in this status, whatever its revision. */
  status?: string;
}

/** The note's value while it still applies to the project (see RevNote). */
export function currentNote<T>(note: RevNote<T> | null, project: { rev: number; status: string }): T | null {
  if (!note) return null;
  if (note.status !== undefined) return note.status === project.status ? note.value : null;
  return note.rev === project.rev ? note.value : null;
}

// Control characters other than tab and new line (\r is kept: the API turns \r\n into \n). Same set the API rejects.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Drops the invisible control characters the API rejects (page breaks and the like from pasted PDFs or Word). */
export function stripControlChars(value: string): string {
  return value.replace(CONTROL, "");
}

/**
 * Keeps at most `max` characters, counted like the API (an emoji is one character). Use it in a text input's
 * onChange instead of `maxLength`, which counts UTF-16 units and stops emoji titles at half the length.
 */
export function clampChars(value: string, max = TITLE_MAX_CHARS): string {
  const chars = Array.from(value);
  return chars.length <= max ? value : chars.slice(0, max).join("");
}
