import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";

/**
 * Data access layer (Next.js auth guide): the only way pages and actions learn who the user is.
 * The proxy only does a fast cookie check; this validates the session against the database.
 */
export const getSession = cache(async () => auth.api.getSession({ headers: await headers() }));

/** For pages and server actions that require a signed-in, verified user. */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!session.user.emailVerified) redirect("/verify-email");
  return session.user;
}
