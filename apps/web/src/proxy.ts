import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { readSession } from "./server/auth";
import { needsWelcome } from "./server/onboarding";

/**
 * Fast, cookie-only routing check (no database, except the Library's onboarding check below, which reads it only until
 * a cookie remembers the answer): send signed-out visitors to sign-in. Real authorisation happens in the data access
 * layer on every page and action.
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
  if (hasSession && pathname === "/library" && request.method === "GET") return welcomeCheck(request);
  return NextResponse.next();
}

/**
 * Remembers "this session doesn't need the Welcome screen", so the check below reads the database at most until that
 * is known. Bound to the session cookie (a hash of it), so another sign-in in the same browser, or a new session, is
 * checked again. It only ever skips a redirect, and the Library page checks again itself, so a forged value can't
 * show anyone anything.
 */
const WELCOME_DONE_COOKIE = "vz_welcome_done";

async function sessionTag(sessionToken: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sessionToken));
  return Buffer.from(digest).toString("base64url").slice(0, 22);
}

/**
 * First-time users opening the Library go to the Welcome screen (F1.12) with a real HTTP redirect, before anything
 * renders (a redirect from inside the page would only come after its "Loading…" state had streamed).
 * Proxy runs on every request, prefetches included (Next hides their headers from it), so it must not hit the
 * database each time: once a session is known not to need Welcome, a cookie says so and the check is skipped. Only
 * until then does it read the session and two small documents. If anything fails, the Library page checks itself.
 */
async function welcomeCheck(request: NextRequest): Promise<NextResponse> {
  const token = getSessionCookie(request);
  if (!token) return NextResponse.next();
  const tag = await sessionTag(token);
  if (request.cookies.get(WELCOME_DONE_COOKIE)?.value === tag) return NextResponse.next();
  try {
    const session = await readSession(request.headers);
    // Signed out (stale cookie) or not verified yet: the page sends them to sign-in / verify; nothing to remember.
    if (!session?.user.emailVerified) return NextResponse.next();
    if (await needsWelcome(session.user.id)) return NextResponse.redirect(new URL("/welcome", request.nextUrl));
    const res = NextResponse.next();
    res.cookies.set(WELCOME_DONE_COOKIE, tag, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/library", maxAge: 30 * 86_400 });
    return res;
  } catch (err) {
    console.warn("[proxy] onboarding check failed; the Library page will check again:", err instanceof Error ? err.message : err);
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|webp|ico)$).*)"],
};
