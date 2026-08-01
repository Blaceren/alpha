/**
 * AFD-5B1 — shared plumbing for the four read-only analytics routes.
 *
 * READ-ONLY BY CONSTRUCTION. Every route in this namespace exports only `GET`,
 * performs no write and takes no body, so there is no CSRF token to validate —
 * CSRF defends state change, and there is none here. The absence of a `POST`,
 * `PATCH` or `DELETE` export is the enforcement, not a convention.
 *
 * NEVER CACHED ACROSS CALLERS. `private, no-store` is set on every response
 * including errors. Two staff members can hold different permissions and
 * therefore see different rows, so a shared cache entry would be a disclosure.
 */
import { NextResponse } from "next/server";
import { affiliateErrorResponse, requireAffiliateReader } from "@/lib/crm/affiliate-routes";
import { crmRequestId } from "@/lib/crm/session";
import { AnalyticsTimeConfigError, resolveBusinessTimezone } from "@/lib/analytics/business-time";
import { AnalyticsPeriodError } from "@/lib/analytics/periods";

/**
 * `private` as well as `no-store`, and `X-Request-Id` for support correlation.
 *
 * The request id is generated per response and identifies nothing about the
 * caller or the rows returned.
 */
export function analyticsHeaders(requestId: string) {
  return {
    "Cache-Control": "private, no-store",
    "X-Request-Id": requestId,
  } as const;
}

/**
 * Map analytics-specific failures, then defer to the affiliate envelope.
 *
 * The shape is the namespace's existing `{code, messageKey, requestId}`: no Zod
 * issue, no SQL, no Prisma error, no stack and no row content ever escapes, so a
 * malformed query cannot be used to probe what exists.
 */
export function analyticsErrorResponse(
  error: unknown,
  requestId: string,
  headers: Record<string, string>,
) {
  if (error instanceof AnalyticsPeriodError) {
    return NextResponse.json(
      { code: "invalid_period", messageKey: error.messageKey, requestId },
      { status: 400, headers },
    );
  }

  // Configuration is wrong, not the request. A 500 is correct: no caller can fix
  // it, and answering 400 would send an operator hunting through their query.
  if (error instanceof AnalyticsTimeConfigError) {
    return NextResponse.json(
      { code: "analytics_misconfigured", messageKey: "crm.analytics.timezone_invalid", requestId },
      { status: 500, headers },
    );
  }

  return affiliateErrorResponse(error, requestId, headers);
}

export type AnalyticsRequestContext = {
  readonly timezone: string;
  /** Frozen once per request, so every metric in one response shares an instant. */
  readonly now: Date;
  readonly params: URLSearchParams;
};

/** The per-response identity, created BEFORE anything that can throw. */
export function beginAnalyticsRequest() {
  const requestId = crmRequestId();
  return { requestId, headers: analyticsHeaders(requestId) };
}

/**
 * Authenticate, authorise, resolve the calendar, and freeze the clock.
 *
 * ORDER MATTERS AND MIRRORS THE EXISTING AFFILIATE ROUTES. `requireAffiliateReader`
 * answers 401 for an anonymous caller and 403 for an authenticated learner with
 * no StaffProfile, and only then is `view_affiliate_analytics` (or
 * `manage_settings`) consulted. A caller who fails either step reaches no
 * database read, so no affiliate data is touched on behalf of someone not
 * entitled to it.
 *
 * THE CLOCK IS READ EXACTLY ONCE. Two metrics resolved a tick apart could
 * disagree about whether an event fell inside "today", and the resolved instant
 * is echoed to the caller as `generatedAt`.
 */
export async function openAnalyticsRequest(request: Request): Promise<AnalyticsRequestContext> {
  await requireAffiliateReader();

  return {
    timezone: resolveBusinessTimezone(),
    now: new Date(),
    params: new URL(request.url).searchParams,
  };
}

/** The resolved period, rendered for the wire. */
export function serializePeriod(period: {
  resolvedPreset: string;
  timezone: string;
  startUtc: Date | null;
  endUtc: Date;
  startLocal: string | null;
  endLocal: string;
  intervalConvention: string;
}) {
  return {
    resolvedPreset: period.resolvedPreset,
    timezone: period.timezone,
    weekStart: "monday",
    startUtc: period.startUtc === null ? null : period.startUtc.toISOString(),
    endUtc: period.endUtc.toISOString(),
    startLocal: period.startLocal,
    endLocal: period.endLocal,
    intervalConvention: period.intervalConvention,
  };
}
