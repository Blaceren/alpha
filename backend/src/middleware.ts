import { NextRequest, NextResponse } from "next/server";
import {
  canAccessRoute,
  isPrivateRoute,
  type AppRole,
} from "@/lib/permissions";

const USER_ROLES: AppRole[] = ["user", "admin", "support", "mentor", "moderator", "news_editor"];
/* The cookie name is deliberately NOT repeated here any more. The middleware
   no longer reads the session itself — it forwards whatever cookies arrived to
   /api/auth/session-status and uses that answer — so a second copy of the name
   would be a second thing to keep in step for no benefit (H-7). */

function addSecurityHeaders(response: NextResponse) {
  const isDev = process.env.NODE_ENV !== "production";
  const csp = isDev
    ? [
        "default-src 'self'",
        "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "media-src 'self' blob: https:",
        "font-src 'self' data:",
        "connect-src 'self' ws: wss:",
        "frame-ancestors 'none'",
      ].join("; ")
    : [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "media-src 'self' https:",
        "font-src 'self'",
        "connect-src 'self'",
        "frame-ancestors 'none'",
      ].join("; ");

  // MVP CSP: dev needs HMR/devtools, production Next App Router still emits inline bootstrap/RSC scripts.
  // A future hardening pass can replace unsafe-inline with nonces or hashes.
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  );
  response.headers.set("X-DNS-Prefetch-Control", "off");

  return response;
}

/**
 * The session, as the Backend itself resolves it (H-7).
 *
 * This used to be `isSessionBlocked` and the middleware verified identity
 * separately with its own copy of the HMAC. The token is opaque now, so the
 * only thing that can resolve it is the database — and this call was already
 * being made on every private route. It answers the whole question now.
 *
 * FAIL CLOSED. A non-OK response, a malformed body or a transport error all
 * resolve to "not authenticated": the middleware refuses rather than guesses.
 */
type MiddlewareSession = { authenticated: boolean; blocked: boolean; role: string | null };

async function resolveSession(request: NextRequest): Promise<MiddlewareSession> {
  try {
    const response = await fetch(new URL("/api/auth/session-status", request.url), {
      headers: { cookie: request.headers.get("cookie") ?? "" },
      cache: "no-store",
    });
    if (!response.ok) return { authenticated: false, blocked: false, role: null };
    const body = (await response.json()) as Partial<MiddlewareSession>;
    return {
      authenticated: body.authenticated === true,
      blocked: body.blocked === true,
      role: typeof body.role === "string" ? body.role : null,
    };
  } catch {
    return { authenticated: false, blocked: false, role: null };
  }
}

/**
 * AFD-3B2 — the public acquisition route sets its OWN privacy headers.
 *
 * `addSecurityHeaders` sends `Referrer-Policy: strict-origin-when-cross-origin`,
 * which is right for pages and wrong here: the referrer of a `/go` hop is the
 * affiliate's own URL, carrying their click id, and it must not travel onward to
 * /register. Middleware headers are applied to the final response, so leaving
 * this to the route handler alone would risk the middleware's value winning.
 * The path is matched here and the acquisition headers are applied instead.
 */
const ACQUISITION_PATH_PREFIX = "/go/";

function isAcquisitionRoute(pathname: string) {
  return pathname === "/go" || pathname.startsWith(ACQUISITION_PATH_PREFIX);
}

function addAcquisitionHeaders(response: NextResponse) {
  addSecurityHeaders(response);
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Checked before the private-route test: `/go` is deliberately reachable
  // without a session, and a visitor arriving from an affiliate must never be
  // bounced to /login.
  if (isAcquisitionRoute(pathname)) {
    return addAcquisitionHeaders(NextResponse.next());
  }

  if (!isPrivateRoute(pathname)) {
    return addSecurityHeaders(NextResponse.next());
  }

  const session = await resolveSession(request);

  if (!session.authenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);

    return addSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  if (session.blocked) {
    return addSecurityHeaders(NextResponse.redirect(new URL("/403", request.url)));
  }

  /* The role comes from the User row this request just resolved, not from
     anything the browser sent — which is what makes a demotion take effect on
     the next request rather than at the next login. */
  const role = USER_ROLES.find((known) => known === session.role);
  if (!role || !canAccessRoute(role, pathname)) {
    return addSecurityHeaders(NextResponse.redirect(new URL("/403", request.url)));
  }

  return addSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg).*)",
  ],
};
