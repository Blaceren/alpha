/**
 * AFD-5B2A — shared plumbing for the three read-only cohort routes.
 *
 * READ-ONLY BY CONSTRUCTION, exactly as in AFD-5B1: every route in this
 * namespace exports only `GET`, performs no write and takes no body, so there is
 * no CSRF token to validate — CSRF defends state change, and there is none here.
 * The absence of a `POST`, `PATCH` or `DELETE` export is the enforcement.
 *
 * AUTHENTICATION AND AUTHORISATION ARE AFD-5B1'S, REUSED UNCHANGED. There is no
 * second permission owner: `openAnalyticsRequest` answers 401 for an anonymous
 * caller, 403 for an authenticated learner with no StaffProfile, and only then
 * consults `view_affiliate_analytics`. Nothing here authorises from
 * `User.role`.
 */
import { resolveCutoff, type ResolvedCutoff } from "@/lib/analytics/cohort-time";
import {
  COHORT_ANCHOR,
  COHORT_MODE,
  COHORT_POPULATION,
} from "@/lib/analytics/cohort-sources";
import type { AnalyticsFilters } from "@/lib/analytics/affiliate-sources";
import type { ResolvedPeriod } from "@/lib/analytics/periods";

/** The query keys every cohort route accepts, plus its own. */
export const COHORT_BASE_KEYS = [
  "preset",
  "startDate",
  "endDate",
  "cutoffDate",
  "affiliatePartnerId",
  "affiliateCampaignId",
  "affiliateTrackingLinkId",
] as const;

/**
 * Resolve the observation cutoff from the query string.
 *
 * Deliberately NOT a second date parser: the value goes straight to the cohort
 * time owner, which applies the same strict `YYYY-MM-DD` grammar and the same
 * Europe/Moscow calendar as every other date in this namespace.
 */
export function resolveCohortCutoff(
  params: URLSearchParams,
  period: ResolvedPeriod,
  timezone: string,
  now: Date,
): ResolvedCutoff {
  const raw = params.get("cutoffDate");
  return resolveCutoff(raw === null ? {} : { cutoffDate: raw }, period, timezone, now);
}

/** The mode identity every cohort response leads with. */
export const COHORT_IDENTITY = {
  mode: COHORT_MODE,
  cohortPopulation: COHORT_POPULATION,
  cohortAnchor: COHORT_ANCHOR,
} as const;

/** The resolved cutoff, rendered for the wire. */
export function serializeCutoff(cutoff: ResolvedCutoff) {
  return {
    cutoffUtc: cutoff.cutoffUtc.toISOString(),
    cutoffLocal: cutoff.cutoffLocal,
    cutoffDateLocal: cutoff.cutoffDateLocal,
    source: cutoff.source,
    clampedToReportClock: cutoff.clampedToReportClock,
    intervalConvention: "cutoff_exclusive",
  };
}

/** Filters echoed as strings, so a JavaScript client cannot lose precision. */
export function serializeFilters(filters: AnalyticsFilters) {
  return {
    affiliatePartnerId:
      filters.affiliatePartnerId === undefined ? null : String(filters.affiliatePartnerId),
    affiliateCampaignId:
      filters.affiliateCampaignId === undefined ? null : String(filters.affiliateCampaignId),
    affiliateTrackingLinkId:
      filters.affiliateTrackingLinkId === undefined
        ? null
        : String(filters.affiliateTrackingLinkId),
  };
}
