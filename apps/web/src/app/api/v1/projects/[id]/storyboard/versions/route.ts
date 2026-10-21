import { z } from "zod";
import { ApiError } from "@/server/api/errors";
import { apiRoute, methodNotAllowed } from "@/server/api/handler";
import { projectParams as params } from "@/server/api/request";
import { KEEP_VERSIONS, listVersions } from "@/server/repos/storyboards";

/**
 * `GET /api/v1/projects/{id}/storyboard/versions` (API Design §13.4, F3.5): the storyboard's versions, newest first,
 * with which one is current (after a restore, newer versions stay listed). At most 30 are kept, so one page holds them
 * all (`nextCursor: null`).
 */
const query = z.strictObject({ limit: z.coerce.number().int().min(1).max(50).optional() });

export const GET = apiRoute({ params, query }, async ({ user, params, query }) => {
  const list = await listVersions(user.id, params.id, Math.min(query.limit ?? KEEP_VERSIONS, KEEP_VERSIONS));
  if (!list) throw new ApiError("NOT_FOUND");
  return {
    current: list.current,
    items: list.items.map((v) => ({ ...v, createdAt: v.createdAt.toISOString(), isCurrent: v.version === list.current })),
    nextCursor: null,
  };
});

const notAllowed = methodNotAllowed(["GET"]);
export { notAllowed as DELETE, notAllowed as PATCH, notAllowed as POST, notAllowed as PUT };
