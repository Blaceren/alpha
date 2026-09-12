import { NextResponse, type NextRequest } from "next/server";
import { PATHNAME_HEADER, hasAnySessionCookie } from "@/lib/auth/constants";

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

  /* PRESENCE, NOT PROOF. This decides whether to render a shell or send the
     visitor to /login; it authenticates nothing. Every authenticated read
     forwards the cookie to the Backend, which is the only authority on whether
     the session is real. Either name counts, so the cutover order between the
     two releases cannot produce a redirect loop. */
  if (!hasAnySessionCookie((name) => request.cookies.has(name))) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

/**
 * `fonts/` and `brand/` join the exclusion list because they are STATIC BRAND
 * ASSETS served from `public/`, and the matcher does not otherwise exempt
 * anything under `public/` — only Next's own `_next/static` output and the two
 * named icons.
 *
 * MEASURED, NOT ASSUMED. Without them, a request for
 * `/fonts/ata/manrope/…​.woff2` from a visitor with no session cookie was
 * answered `307 → /login?next=%2Ffonts%2F…`, while the same request WITH a
 * cookie returned `200 font/woff2`. The effect was that Public Home — the one
 * surface whose whole audience is signed out — rendered in fallback system
 * fonts, so the brand implementation was invisible to exactly the people it was
 * built for.
 *
 * It grants nothing. These are static files in `public/`: they contain no
 * learner data, they are identical for every visitor, and they were already
 * being served to anyone who happened to hold any cookie at all.
 *
 * The `public/showcase/` gap that used to be recorded here is gone with the
 * route: H-STALE-2 removed the QA board and its media rather than restyling a
 * board nobody ships, so there is no longer an anonymous surface under
 * `public/showcase/` for the matcher to miss.
 */
export const config = {
  /* `icon.svg` used to be exempted here for a file-based icon that does not
     exist: there is no src/app/icon.svg and no public/icon.svg, `/icon.svg`
     answers 404, and the only icon authority is `/brand/favicon.svg`, which is
     exempted separately by the `brand/` prefix. An exemption for a path nothing
     serves is a hole nobody is watching, so it is gone.

     `favicon.ico` stays. It does not exist either, but browsers request it
     unprompted on every visit, and letting that run the auth middleware would
     turn a cheap 404 into a redirect on a path no one asked for. */
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|fonts/|brand/).*)",
  ],
};
