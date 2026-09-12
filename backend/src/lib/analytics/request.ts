/**
 * AFD-5B1 — query-string parsing and filter-hierarchy validation.
 *
 * WHAT THIS REFUSES, AND WHY IT IS A CLOSED LIST. Every accepted key is named
 * here; anything else is a 400 rather than being ignored. A silently dropped
 * parameter is the failure mode where an operator filters a payout report by
 * something the server never applied and never learns the number was wrong.
 *
 * NO FILTER EXISTS for email, password, Pocket player id, Pocket click id, an
 * external affiliate click id, an ataClickId, a visitor id or a raw column name.
 * They are absent from the union below, so no request can reach them.
 */
import { prisma } from "@/lib/prisma";
import { AffiliateInputError, AffiliateNotFoundError } from "@/lib/crm/affiliates";
import {
  AnalyticsPeriodError,
  BUCKET_GROUPS,
  DATE_PRESETS,
  type BucketGroup,
  type DatePreset,
  type PeriodInput,
} from "@/lib/analytics/periods";
import type { AnalyticsFilters } from "@/lib/analytics/affiliate-sources";
import type { BreakdownDimension } from "@/lib/analytics/affiliate-queries";

export const ANALYTICS_MAX_LIMIT = 100;
export const ANALYTICS_DEFAULT_LIMIT = 50;

/**
 * Reject unknown and repeated keys before anything is read.
 *
 * Duplicates are refused rather than last-wins: `?preset=today&preset=all_time`
 * has no defensible meaning and silently choosing one of them is how two callers
 * get different answers from the same URL.
 */
export function assertKnownAnalyticsKeys(
  params: URLSearchParams,
  known: readonly string[],
): void {
  for (const key of new Set(params.keys())) {
    if (!known.includes(key)) throw new AffiliateInputError("crm.analytics.query_unknown");
    if (params.getAll(key).length > 1) {
      throw new AffiliateInputError("crm.analytics.query_duplicated");
    }
  }
}

export function parsePeriodInput(params: URLSearchParams): PeriodInput {
  const raw = params.get("preset");
  // A missing preset is an explicit default, not an open-ended query: without
  // one, an omitted parameter would silently mean "all of history".
  const preset = (raw === null ? "last_30_days" : raw) as DatePreset;
  if (!DATE_PRESETS.includes(preset)) {
    throw new AnalyticsPeriodError("crm.analytics.preset_invalid");
  }

  const startDate = params.get("startDate");
  const endDate = params.get("endDate");

  if (preset !== "custom" && (startDate !== null || endDate !== null)) {
    // Accepting dates alongside a named preset would leave it ambiguous which
    // one won, and the answer would be invisible in the response.
    throw new AnalyticsPeriodError("crm.analytics.dates_not_allowed");
  }

  return {
    preset,
    ...(startDate !== null ? { startDate } : {}),
    ...(endDate !== null ? { endDate } : {}),
  };
}

export function parseGroup(params: URLSearchParams): BucketGroup {
  const raw = params.get("group");
  if (raw === null) return "day";
  const group = raw as BucketGroup;
  if (!BUCKET_GROUPS.includes(group)) {
    throw new AffiliateInputError("crm.analytics.group_invalid");
  }
  return group;
}

const DIMENSIONS: readonly BreakdownDimension[] = ["affiliate", "campaign", "tracking_link"];

export function parseDimension(params: URLSearchParams): BreakdownDimension {
  const raw = params.get("dimension");
  if (raw === null) return "affiliate";
  const dimension = raw as BreakdownDimension;
  if (!DIMENSIONS.includes(dimension)) {
    throw new AffiliateInputError("crm.analytics.dimension_invalid");
  }
  return dimension;
}

function parseId(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null) return undefined;
  const text = raw.trim();
  if (!/^\d{1,9}$/.test(text)) throw new AffiliateInputError("crm.analytics.filter_invalid");
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1) {
    throw new AffiliateInputError("crm.analytics.filter_invalid");
  }
  return value;
}

export function parseFilters(params: URLSearchParams): AnalyticsFilters {
  return {
    ...(parseId(params, "affiliatePartnerId") !== undefined
      ? { affiliatePartnerId: parseId(params, "affiliatePartnerId") }
      : {}),
    ...(parseId(params, "affiliateCampaignId") !== undefined
      ? { affiliateCampaignId: parseId(params, "affiliateCampaignId") }
      : {}),
    ...(parseId(params, "affiliateTrackingLinkId") !== undefined
      ? { affiliateTrackingLinkId: parseId(params, "affiliateTrackingLinkId") }
      : {}),
  };
}

export function parsePaging(params: URLSearchParams): { limit: number; offset: number } {
  let limit = ANALYTICS_DEFAULT_LIMIT;
  const rawLimit = params.get("limit");
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit.trim())) throw new AffiliateInputError("crm.analytics.limit_invalid");
    const value = Number(rawLimit.trim());
    if (!Number.isInteger(value) || value < 1 || value > ANALYTICS_MAX_LIMIT) {
      throw new AffiliateInputError("crm.analytics.limit_invalid");
    }
    limit = value;
  }

  let offset = 0;
  const rawOffset = params.get("offset");
  if (rawOffset !== null) {
    if (!/^\d+$/.test(rawOffset.trim())) {
      throw new AffiliateInputError("crm.analytics.offset_invalid");
    }
    const value = Number(rawOffset.trim());
    if (!Number.isInteger(value) || value < 0 || value > 100_000) {
      throw new AffiliateInputError("crm.analytics.offset_invalid");
    }
    offset = value;
  }

  return { limit, offset };
}

export function parseBoolean(params: URLSearchParams, key: string): boolean {
  const raw = params.get(key);
  if (raw === null) return false;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new AffiliateInputError("crm.analytics.flag_invalid");
}

/**
 * Prove every named entity exists and that the three form a consistent chain.
 *
 * ARCHIVED AND PAUSED ENTITIES ARE VALID HISTORICAL FILTERS. A report about last
 * month must still be able to name the affiliate that ran it, and requiring
 * `status = active` here would make history disappear the moment somebody tidied
 * up the configuration. Only EXISTENCE and PARENTAGE are checked.
 */
export async function assertFilterHierarchy(filters: AnalyticsFilters): Promise<void> {
  const { affiliatePartnerId, affiliateCampaignId, affiliateTrackingLinkId } = filters;

  if (affiliatePartnerId !== undefined) {
    const partner = await prisma.affiliatePartner.findUnique({
      where: { id: affiliatePartnerId },
      select: { id: true },
    });
    if (!partner) throw new AffiliateNotFoundError("crm.analytics.partner_not_found");
  }

  if (affiliateCampaignId !== undefined) {
    const campaign = await prisma.affiliateCampaign.findUnique({
      where: { id: affiliateCampaignId },
      select: { id: true, affiliatePartnerId: true },
    });
    if (!campaign) throw new AffiliateNotFoundError("crm.analytics.campaign_not_found");
    if (
      affiliatePartnerId !== undefined &&
      campaign.affiliatePartnerId !== affiliatePartnerId
    ) {
      // A mismatch is bad input rather than a missing row: both entities exist,
      // the caller's combination of them does not.
      throw new AffiliateInputError("crm.analytics.filter_hierarchy_mismatch");
    }
  }

  if (affiliateTrackingLinkId !== undefined) {
    const link = await prisma.affiliateTrackingLink.findUnique({
      where: { id: affiliateTrackingLinkId },
      select: { id: true, affiliatePartnerId: true, affiliateCampaignId: true },
    });
    if (!link) throw new AffiliateNotFoundError("crm.analytics.tracking_link_not_found");
    if (affiliatePartnerId !== undefined && link.affiliatePartnerId !== affiliatePartnerId) {
      throw new AffiliateInputError("crm.analytics.filter_hierarchy_mismatch");
    }
    if (
      affiliateCampaignId !== undefined &&
      link.affiliateCampaignId !== affiliateCampaignId
    ) {
      throw new AffiliateInputError("crm.analytics.filter_hierarchy_mismatch");
    }
  }
}

/** True when the request named no affiliate dimension at all. */
export function isUnfiltered(filters: AnalyticsFilters): boolean {
  return (
    filters.affiliatePartnerId === undefined &&
    filters.affiliateCampaignId === undefined &&
    filters.affiliateTrackingLinkId === undefined
  );
}
