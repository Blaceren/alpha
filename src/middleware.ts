import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, PATHNAME_HEADER } from "@/lib/auth/constants";

/**
 * Authenticated route protection.
 *
 * fixture mode: pass-through (the local prototype has no login). api mode:
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

export function middleware(request: NextRequest): NextResponse {
  if (!isApiMode()) {
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATHNAME_HEADER, `${pathname}${search}`);

  const isLoginRoute = pathname === "/login" || pathname.startsWith("/login/");
  if (isLoginRoute) {
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
