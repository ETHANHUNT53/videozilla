import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Fast, cookie-only routing check (no database): send signed-out visitors to sign-in. Real authorisation happens in
 * the data access layer on every page and action.
 *
 * Signed-in users are NOT sent away from the auth pages here: a cookie can outlive its session (revoked by a password
 * reset or sign-out elsewhere), and redirecting on the cookie alone would loop /sign-in → /library → /sign-in.
 * The auth pages do that check against the database instead (redirectIfSignedIn).
 */
const APP_PATHS = ["/library", "/projects", "/settings", "/welcome"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));
  if (!hasSession && APP_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = new URL("/sign-in", request.nextUrl);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|webp|ico)$).*)"],
};
