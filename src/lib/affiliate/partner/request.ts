/**
 * AFFILIATE-PLATFORM-V1 §18 — the one gate every partner API route passes
 * through.
 *
 * A ROUTE CANNOT FORGET TO CHECK SOMETHING IT NEVER SEES. `withPartnerRequest`
 * hands the handler a resolved `PartnerPrincipal` and nothing else that could
 * identify a tenant. There is no partner id in any partner-facing path, so a
 * handler has nothing to accidentally trust — the horizontal IDOR this phase is
 * most concerned with is not a bug to avoid but a shape that does not exist.
 *
 * REFUSALS ARE BOUNDED AND UNIFORM. `unauthorized` for both 401 and 403,
 * `unavailable` for 503, and never a message that says whether a login exists,
 * whether it was disabled, or whether some other partner owns the thing that
 * was asked for. A 404 for another tenant's resource and a 404 for a resource
 * that never existed are the same response, deliberately: the alternative is an
 * existence oracle over every id in the platform.
 */
import { NextResponse } from "next/server";
import crypto from "node:crypto";
import type { PartnerPrincipal } from "@/lib/affiliate/partner/principal";
import { resolvePartnerPrincipal } from "@/lib/affiliate/partner/principal";
import {
  PARTNER_CSRF_COOKIE_NAME,
  PARTNER_CSRF_HEADER_NAME,
  PARTNER_SESSION_COOKIE_NAME,
  partnerCsrfTokensMatch,
} from "@/lib/affiliate/partner/session";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function partnerRequestId(): string {
  return crypto.randomUUID();
}

/** Read one cookie without pulling in the whole Next cookie machinery. */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (header === null) return null;
  for (const raw of header.split(";")) {
    const item = raw.trim();
    if (item.startsWith(`${name}=`)) {
      return decodeURIComponent(item.slice(name.length + 1));
    }
  }
  return null;
}

export type PartnerErrorCode =
  | "unauthorized"
  | "unavailable"
  | "invalid_request"
  | "not_found"
  | "conflict"
  | "csrf_invalid"
  | "rate_limited";

const STATUS_BY_CODE: Record<PartnerErrorCode, number> = {
  unauthorized: 401,
  unavailable: 503,
  invalid_request: 400,
  not_found: 404,
  conflict: 409,
  csrf_invalid: 403,
  rate_limited: 429,
};

export function partnerError(
  code: PartnerErrorCode,
  messageKey: string,
  status: number = STATUS_BY_CODE[code],
): NextResponse {
  return NextResponse.json(
    { error: code, messageKey, requestId: partnerRequestId() },
    {
      status,
      headers: {
        // A partner response is per-principal by construction. Caching one at
        // any layer would be a cross-tenant disclosure with no attacker in it.
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    },
  );
}

export function partnerJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/**
 * Wrap a partner route handler.
 *
 * ORDER IS DELIBERATE: authenticate first, then CSRF. A cross-site request from
 * an unauthenticated browser is simply unauthenticated, and answering it with a
 * CSRF error would confirm that the origin is a real console. CSRF is a check
 * on an ESTABLISHED session, so it belongs after one exists.
 */
export async function withPartnerRequest(
  request: Request,
  handler: (principal: PartnerPrincipal) => Promise<NextResponse>,
): Promise<NextResponse> {
  const token = readCookie(request, PARTNER_SESSION_COOKIE_NAME) ?? undefined;
  const auth = await resolvePartnerPrincipal(token);

  if (!auth.ok) {
    if (auth.refusal.kind === "platform_unavailable") {
      return partnerError("unavailable", "partner.platform.unavailable");
    }
    if (auth.refusal.kind === "partner_not_active") {
      return partnerError("unauthorized", "partner.session.partner_not_active", 403);
    }
    return partnerError("unauthorized", "partner.session.unauthenticated");
  }

  if (!SAFE_METHODS.has(request.method)) {
    const cookieToken = readCookie(request, PARTNER_CSRF_COOKIE_NAME);
    const headerToken = request.headers.get(PARTNER_CSRF_HEADER_NAME);
    if (!partnerCsrfTokensMatch(cookieToken, headerToken)) {
      return partnerError("csrf_invalid", "partner.csrf.invalid");
    }
  }

  return handler(auth.principal);
}
