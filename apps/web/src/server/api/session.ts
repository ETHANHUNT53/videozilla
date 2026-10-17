import "server-only";
import { auth } from "../auth";

/** The signed-in user for an API request, straight from Better Auth (checked against the database every time). */
export async function sessionUser(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  return session?.user ?? null;
}

export type SessionUser = NonNullable<Awaited<ReturnType<typeof sessionUser>>>;
