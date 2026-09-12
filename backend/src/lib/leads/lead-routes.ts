/**
 * AFD-5B2B — shared plumbing for the three lead routes.
 *
 * THE AUTHORIZATION ORDER IS FIXED AND IS THE SAME ONE THE AFFILIATE NAMESPACE
 * ALREADY USES: session first (401 for anonymous), StaffProfile second (403 for
 * an authenticated learner), affiliate read permission third (403), and only
 * then anything that touches a lead. A caller who fails any step reaches no
 * database read, so no learner row is loaded on behalf of someone not entitled
 * to it — and, just as importantly, a 403 is returned identically whether or not
 * the lead they named exists.
 *
 * NEVER CACHED ACROSS CALLERS. `private, no-store` on every response including
 * errors. Two staff members hold different permissions and therefore see
 * different fields for the same lead, so one shared cache entry would be a
 * disclosure. The reveal response additionally must never be stored anywhere.
 */
import { NextResponse } from "next/server";
import { affiliateErrorResponse, requireAffiliateReader } from "@/lib/crm/affiliate-routes";
import { crmRequestId } from "@/lib/crm/session";
import { canRevealLeadPii } from "@/lib/crm/roles";
import { AffiliateInputError, AffiliateNotFoundError } from "@/lib/crm/affiliates";
import { AnalyticsTimeConfigError, resolveBusinessTimezone } from "@/lib/analytics/business-time";
import { AnalyticsPeriodError } from "@/lib/analytics/periods";
import { parseLeadId } from "@/lib/leads/lead-identity";

export function leadHeaders(requestId: string) {
  return {
    "Cache-Control": "private, no-store",
    "X-Request-Id": requestId,
  } as const;
}

export function beginLeadRequest() {
  const requestId = crmRequestId();
  return { requestId, headers: leadHeaders(requestId) };
}

/**
 * Map lead-specific failures, then defer to the affiliate envelope.
 *
 * Every failure collapses to `{code, messageKey, requestId}`. No Zod issue, no
 * Prisma error, no SQL, no stack, no cursor content and no row content ever
 * escapes, so a malformed query cannot be used to probe what exists.
 */
export function leadErrorResponse(
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
  if (error instanceof AnalyticsTimeConfigError) {
    return NextResponse.json(
      { code: "analytics_misconfigured", messageKey: "crm.analytics.timezone_invalid", requestId },
      { status: 500, headers },
    );
  }
  return affiliateErrorResponse(error, requestId, headers);
}

export type LeadRequestContext = {
  readonly timezone: string;
  /** Frozen once per request, so every field in one response shares an instant. */
  readonly now: Date;
  readonly params: URLSearchParams;
  /** Whether THIS caller additionally holds the narrow PII permission. */
  readonly canRevealPii: boolean;
};

/** Authenticate, authorise for affiliate reads, resolve the calendar, freeze the clock. */
export async function openLeadRequest(request: Request): Promise<LeadRequestContext> {
  const session = await requireAffiliateReader();

  return {
    timezone: resolveBusinessTimezone(),
    now: new Date(),
    params: new URL(request.url).searchParams,
    canRevealPii: canRevealLeadPii(session.effectivePermissions),
  };
}

/**
 * Resolve a path segment to a stored conversion `eventId`.
 *
 * A BAD REFERENCE IS A 400 AND A GOOD-BUT-UNKNOWN ONE IS A 404, and the
 * distinction leaks nothing: the shape of a reference is public information
 * (this file documents it), while whether a particular 160-bit value names a
 * lead is only learnable by already holding it. Both are reached only AFTER
 * authorization, so an unauthorised caller can distinguish neither.
 */
export function requireLeadEventId(raw: unknown): string {
  const parsed = parseLeadId(raw);
  if (parsed.kind === "valid") return parsed.eventId;

  if (parsed.reason === "unsupported_version") {
    throw new AffiliateInputError("crm.leads.lead_id_unsupported_version");
  }
  throw new AffiliateInputError("crm.leads.lead_id_invalid");
}

export function leadNotFound(): never {
  throw new AffiliateNotFoundError("crm.leads.lead_not_found");
}
