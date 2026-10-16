import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Fast, cookie-only routing check (no database): send signed-out visitors to sign-in and signed-in users away from
 * the auth pages. Real authorisation happens in the data access layer on every page and action.
 */
const APP_PATHS = ["/library", "/projects", "/settings"];
const AUTH_PATHS = ["/sign-in", "/sign-up"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = Boolean(getSessionCookie(request));
  if (!hasSession && APP_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = new URL("/sign-in", request.nextUrl);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (hasSession && AUTH_PATHS.includes(pathname)) {
    return NextResponse.redirect(new URL("/library", request.nextUrl));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|webp|ico)$).*)"],
};
