import { NextRequest, NextResponse } from "next/server";
import {
  canAccessRoute,
  isPrivateRoute,
  type AppRole,
} from "@/lib/permissions";

type SessionPayload = {
  userId: number;
  role: AppRole;
};

const USER_ROLES: AppRole[] = ["user", "admin", "support", "mentor", "moderator", "news_editor"];
const SESSION_COOKIE_NAME = "trading_platform_session";

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

function getSessionSecret() {
  return process.env.SESSION_SECRET ?? "local-dev-session-secret";
}

function bytesToHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sign(value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));

  return bytesToHex(signature);
}

async function verifySessionToken(token?: string): Promise<SessionPayload | null> {
  if (!token) {
    return null;
  }

  const [userIdRaw, roleRaw, expiresAtRaw, signature] = token.split(".");
  const payload = `${userIdRaw}.${roleRaw}.${expiresAtRaw}`;
  const expectedSignature = await sign(payload);
  const role = USER_ROLES.find((availableRole) => availableRole === roleRaw);
  const expiresAt = Number(expiresAtRaw);
  const userId = Number(userIdRaw);

  if (
    !signature ||
    signature !== expectedSignature ||
    !role ||
    !Number.isFinite(expiresAt) ||
    expiresAt < Date.now() ||
    !Number.isInteger(userId)
  ) {
    return null;
  }

  return { userId, role };
}

async function isSessionBlocked(request: NextRequest) {
  const response = await fetch(new URL("/api/auth/session-status", request.url), {
    headers: {
      cookie: request.headers.get("cookie") ?? "",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    return false;
  }

  const status = (await response.json()) as { blocked?: boolean };

  return status.blocked === true;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isPrivateRoute(pathname)) {
    return addSecurityHeaders(NextResponse.next());
  }

  const session = await verifySessionToken(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);

    return addSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  if (await isSessionBlocked(request)) {
    return addSecurityHeaders(NextResponse.redirect(new URL("/403", request.url)));
  }

  if (!canAccessRoute(session.role, pathname)) {
    return addSecurityHeaders(NextResponse.redirect(new URL("/403", request.url)));
  }

  return addSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg).*)",
  ],
};
