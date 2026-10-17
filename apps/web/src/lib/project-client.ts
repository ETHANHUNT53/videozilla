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
 * Keeps at most `max` characters, counted like the API (an emoji is one character). Use it in a text input's
 * onChange instead of `maxLength`, which counts UTF-16 units and stops emoji titles at half the length.
 */
export function clampChars(value: string, max = TITLE_MAX_CHARS): string {
  const chars = Array.from(value);
  return chars.length <= max ? value : chars.slice(0, max).join("");
}
