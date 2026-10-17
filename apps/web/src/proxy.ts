import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { readSession } from "./server/auth";
import { needsWelcome } from "./server/onboarding";

/**
 * Fast, cookie-only routing check (no database, except the Library's onboarding check below): send signed-out visitors
 * to sign-in. Real authorisation happens in
 * the data access layer on every page and action.
 *
 * Signed-in users are NOT sent away from the auth pages here: a cookie can outlive its session (revoked by a password
 * reset or sign-out elsewhere), and redirecting on the cookie alone would loop /sign-in → /library → /sign-in.
 * The auth pages do that check against the database instead (redirectIfSignedIn).
 */
const APP_PATHS = ["/library", "/projects", "/settings", "/welcome"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));
  if (!hasSession && APP_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = new URL("/sign-in", request.nextUrl);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  // First-time users opening the Library go to the Welcome screen (F1.12) with a real HTTP redirect, before anything
  // renders. A redirect from inside the page would only happen after its "Loading…" state had streamed. The one
  // exception to "no database here": a session and two small reads, for this one page. If it fails, the Library page
  // runs the same check itself.
  if (hasSession && pathname === "/library" && request.method === "GET") {
    try {
      const session = await readSession(request.headers);
      if (session?.user.emailVerified && (await needsWelcome(session.user.id))) return NextResponse.redirect(new URL("/welcome", request.nextUrl));
    } catch (err) {
      console.warn("[proxy] onboarding check failed; the Library page will check again:", err instanceof Error ? err.message : err);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|webp|ico)$).*)"],
};
