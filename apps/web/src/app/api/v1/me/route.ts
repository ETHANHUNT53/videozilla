import { apiRoute } from "@/server/api/handler";
import { toMeUser, toProfile } from "@/server/api/resources";
import { getOrCreateProfile } from "@/server/repos/profiles";

/** `GET /api/v1/me` (API Design §13.1): the signed-in user, their profile and Instagram connection. Works before the email is verified. */
export const GET = apiRoute({ auth: "session" }, async ({ user }) => {
  const profile = await getOrCreateProfile(user.id, user.name);
  return { user: toMeUser(user), profile: toProfile(profile), instagram: null };
});
