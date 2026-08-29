import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, PATHNAME_HEADER } from "@/lib/auth/constants";

/**
 * Authenticated route protection.
 *
 * fixture mode: pass-through (the local prototype has no login). api mode:
 *   - let anonymous auth routes through (`/login`, and `/register` from AFD-3A);
 *   - stamp the requested path into a header so the server guard can build a
 *     validated returnTo;
 *   - fast-redirect protected routes to /login when NO session cookie is present
 *     (avoids a protected-content flash). Cookie *validity* is confirmed
 *     authoritatively by the server layout guard, not here — the middleware
 *     never has the session secret.
 *
 * The matcher excludes `/api/*` (the same-origin proxy must never be guarded)
 * and framework/static assets.
 */
function isApiMode(): boolean {
  return process.env.ACADEMY_MODE?.trim() === "api";
}

/**
 * Routes an anonymous visitor must be able to reach.
 *
 * `/register` (AFD-3A) belongs here for the same reason `/login` does: it is
 * the surface an anonymous visitor uses to obtain a session in the first place.
 * Without it, every ATA invite link — `/register?ref=...` — would bounce
 * straight to `/login` and the invite would be a dead end.
 *
 * Kept as an exact-or-subpath match so a route that merely starts with the same
 * letters (`/registers-something`) is NOT exempted.
 */
const ANONYMOUS_ROUTES = ["/login", "/register"] as const;

/**
 * Public Home, and ONLY Public Home.
 *
 * UNIFIED-DESIGN-V1 makes `/` a public marketing surface, so an anonymous
 * visitor must reach it without being bounced to /login.
 *
 * IT IS MATCHED EXACTLY, AND IT IS DELIBERATELY NOT IN `ANONYMOUS_ROUTES`.
 * That list is an exact-or-subpath match, and the subpath arm of "/" is
 * `pathname.startsWith("/")` — which is true of every path there is. Adding "/"
 * to that list would silently make the ENTIRE authenticated product anonymous
 * to this middleware. Keeping it as its own exact comparison makes that
 * impossible.
 *
 * This is a middleware fast-path only. It does not grant access to anything:
 * every guarded surface still resolves its session server-side in the `(app)`
 * layout, and `/` renders no learner data at all.
 */
const PUBLIC_HOME_PATH = "/";

function isAnonymousRoute(pathname: string): boolean {
  if (pathname === PUBLIC_HOME_PATH) return true;
  return ANONYMOUS_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function middleware(request: NextRequest): NextResponse {
  if (!isApiMode()) {
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATHNAME_HEADER, `${pathname}${search}`);

  if (isAnonymousRoute(pathname)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  if (!request.cookies.has(SESSION_COOKIE_NAME)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
