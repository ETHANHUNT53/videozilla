import { apiRoute, methodNotAllowed } from "@/server/api/handler";
import { toMeUser, toProfile } from "@/server/api/resources";
import { getOrCreateProfile } from "@/server/repos/profiles";

/** `GET /api/v1/me` (API Design §13.1): the signed-in user, their profile and Instagram connection. */
export const GET = apiRoute({}, async ({ user }) => {
  const profile = await getOrCreateProfile(user.id, user.name);
  return { user: toMeUser(user), profile: toProfile(profile), instagram: null };
});

const notAllowed = methodNotAllowed(["GET"]);
export { notAllowed as DELETE, notAllowed as PATCH, notAllowed as POST, notAllowed as PUT };
