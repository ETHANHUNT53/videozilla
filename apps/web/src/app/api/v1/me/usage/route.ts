import { apiRoute, methodNotAllowed } from "@/server/api/handler";
import { getUsage } from "@/server/repos/usage";

/**
 * `GET /api/v1/me/usage` (API Design §13.1): today's usage against the daily limits (PRD §20.6), per IST day:
 * `{ date, resetsAt, counters: { storyboards: { used, limit }, revisions, builds, renders, illustrations } }`.
 */
export const GET = apiRoute({}, async ({ user }) => getUsage(user.id));

const notAllowed = methodNotAllowed(["GET"]);
export { notAllowed as DELETE, notAllowed as PATCH, notAllowed as POST, notAllowed as PUT };
