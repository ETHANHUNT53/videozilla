import { z } from "zod";
import { apiRoute, created, methodNotAllowed } from "@/server/api/handler";
import { pageQuery } from "@/server/api/pagination";
import { toProject } from "@/server/api/resources";
import { PROJECT_FILTERS } from "@/server/db/types";
import { getOrCreateProfile } from "@/server/repos/profiles";
import { createProject, listProjects, SEARCH_MAX_CHARS } from "@/server/repos/projects";

/**
 * `GET /api/v1/projects` (API Design §13.2): the library list.
 * `?filter=all|drafts|ready|scheduled|posted|attention` · `?q=` title search (1–80 characters) · `?limit=` / `?cursor=`
 * (§6.1) · `?exclude=attention` (with `filter=all`: leave out needs-attention projects, which the Library shows in their
 * own section).
 * Response: `{ items: ProjectSummary[], nextCursor, hasMore }`, newest change first.
 */
const listQuery = z.strictObject({
  filter: z.enum(PROJECT_FILTERS).default("all"),
  // Counted in characters (code points), like the titles: an emoji is one character, not two.
  q: z
    .string()
    .min(1)
    .refine((s) => Array.from(s).length <= SEARCH_MAX_CHARS, `Must be at most ${SEARCH_MAX_CHARS} characters`)
    .optional(),
  exclude: z.literal("attention").optional(),
  ...pageQuery,
});

export const GET = apiRoute({ query: listQuery }, async ({ user, query: { exclude, ...query } }) =>
  listProjects(user.id, { ...query, excludeAttention: exclude === "attention" }),
);

/**
 * `POST /api/v1/projects` (API Design §13.2): a new idea draft, plus its idea session in the same transaction.
 * Every field is optional; the rest comes from the user's profile defaults. Not idempotent on purpose (§9): a
 * duplicate draft is harmless and can be deleted. Response: `201 Project` with `Location`.
 */
const createBody = z.strictObject({
  title: z.string().min(1).max(80).optional(),
  language: z.enum(["en", "hi"]).optional(),
  lengthPreset: z.union([z.literal(60), z.literal(90)]).optional(),
  voiceGender: z.enum(["female", "male"]).optional(),
});

export const POST = apiRoute({ body: createBody }, async ({ user, body }) => {
  const profile = await getOrCreateProfile(user.id, user.name);
  const project = await createProject(user.id, profile, body);
  const id = project._id.toHexString();
  return created(toProject(project), `/api/v1/projects/${id}`);
});

const notAllowed = methodNotAllowed(["GET", "POST"]);
export { notAllowed as DELETE, notAllowed as PATCH, notAllowed as PUT };
