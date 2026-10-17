import { z } from "zod";
import { apiRoute, methodNotAllowed } from "@/server/api/handler";
import { pageQuery } from "@/server/api/pagination";
import { PROJECT_FILTERS } from "@/server/db/types";
import { listProjects } from "@/server/repos/projects";

/**
 * `GET /api/v1/projects` (API Design §13.2): the library list.
 * `?filter=all|drafts|ready|scheduled|posted|attention` · `?q=` title search (1–80 chars) · `?limit=` / `?cursor=` (§6.1).
 * Response: `{ items: ProjectSummary[], nextCursor, hasMore }`, newest change first.
 */
const query = z.strictObject({
  filter: z.enum(PROJECT_FILTERS).default("all"),
  q: z.string().min(1).max(80).optional(),
  ...pageQuery,
});

export const GET = apiRoute({ query }, async ({ user, query }) => listProjects(user.id, query));

// POST /projects (create) moves here in F1.7; until then the Library uses its server action.
const notAllowed = methodNotAllowed(["GET"]);
export { notAllowed as DELETE, notAllowed as PATCH, notAllowed as POST, notAllowed as PUT };
