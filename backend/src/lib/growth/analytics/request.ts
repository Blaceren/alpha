/**
 * G4-GROWTH — shared request handling for the five Growth routes.
 *
 * DELIBERATELY THIN, BECAUSE THE HARD PARTS ALREADY EXIST. Authentication,
 * authorization, the bounded error envelope, `private, no-store`, the request
 * id, the business calendar and the frozen clock are all the accepted AFD-5B1
 * plumbing, reused unchanged. §57 asks for consistency with current conventions
 * rather than a parallel API architecture, and the surest way to be consistent
 * with an authorization boundary is to call it rather than to reimplement it.
 *
 * WHAT THIS ADDS. The Growth-specific filter vocabulary and its validation, and
 * nothing else.
 */
import { AffiliateInputError } from "@/lib/crm/affiliates";
import { prisma } from "@/lib/prisma";
import type { GrowthFilters } from "@/lib/growth/analytics/queries";
import {
  GROWTH_COVERAGE_SCOPES,
  GROWTH_DEFAULT_COVERAGE_SCOPE,
  type GrowthCoverageScope,
} from "@/lib/growth/analytics/sources";

export const GROWTH_MAX_LIMIT = 100;
export const GROWTH_DEFAULT_LIMIT = 25;

/** Query keys every Growth route accepts. Anything else is a 400. */
export const GROWTH_COMMON_KEYS = [
  "preset",
  "startDate",
  "endDate",
  "affiliatePartnerId",
  "affiliateCampaignId",
  "trackingLinkId",
  "scope",
] as const;

/**
 * G4-H4 — the acquisition coverage the caller is asking about.
 *
 * A CLOSED ENUM WITH A BUSINESS DEFAULT. `total` when absent, because the
 * question a staff surface answers by default is "what is happening in the
 * business", not "what did tracked traffic do". The audited candidate hard-coded
 * `attributed` on the funnel and Pocket surfaces, so on a dataset with real
 * learners and no attribution coverage they reported zero — indistinguishable
 * from a platform with no customers.
 *
 * An unknown value is a 400, never a silent fallback: a caller that asked for a
 * population this API does not have must not be handed a different one.
 */
export function parseGrowthScope(params: URLSearchParams): GrowthCoverageScope {
  const values = params.getAll("scope");
  if (values.length === 0) return GROWTH_DEFAULT_COVERAGE_SCOPE;
  if (values.length > 1) throw new AffiliateInputError("crm.analytics.query_duplicated");

  const raw = values[0];
  if (!(GROWTH_COVERAGE_SCOPES as readonly string[]).includes(raw)) {
    throw new AffiliateInputError("crm.analytics.scope_invalid");
  }
  return raw as GrowthCoverageScope;
}

function parseId(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null) return undefined;

  const trimmed = raw.trim();
  // Digits only. `+1`, `1e3`, ` 1 ` and `0x1` are refused rather than coerced:
  // a filter that silently reinterprets its input is how a caller ends up
  // reading a different affiliate's numbers than the one they asked for.
  if (!/^\d+$/.test(trimmed)) throw new AffiliateInputError("crm.analytics.filter_invalid");

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AffiliateInputError("crm.analytics.filter_invalid");
  }
  return value;
}

export function parseGrowthFilters(params: URLSearchParams): GrowthFilters {
  const affiliatePartnerId = parseId(params, "affiliatePartnerId");
  const affiliateCampaignId = parseId(params, "affiliateCampaignId");
  const trackingLinkId = parseId(params, "trackingLinkId");

  return {
    ...(affiliatePartnerId !== undefined ? { affiliatePartnerId } : {}),
    ...(affiliateCampaignId !== undefined ? { affiliateCampaignId } : {}),
    ...(trackingLinkId !== undefined ? { trackingLinkId } : {}),
  };
}

export function isUnfiltered(filters: GrowthFilters): boolean {
  return (
    filters.affiliatePartnerId === undefined &&
    filters.affiliateCampaignId === undefined &&
    filters.trackingLinkId === undefined
  );
}

/**
 * Prove that every referenced entity exists and that the pair is consistent.
 *
 * WHY EXISTENCE IS CHECKED AT ALL. Without it, a filter naming a campaign that
 * does not exist returns zeroes — and zeroes are indistinguishable from a real
 * campaign that produced nothing. An operator would read a typo as a failed
 * campaign.
 *
 * WHY THE HIERARCHY IS CHECKED. `?affiliatePartnerId=1&affiliateCampaignId=9`
 * where campaign 9 belongs to partner 2 is a question with no answer. Silently
 * intersecting them returns zero, which again reads as "this campaign did
 * nothing".
 */
export async function assertGrowthFilterHierarchy(filters: GrowthFilters): Promise<void> {
  if (filters.affiliatePartnerId !== undefined) {
    const partner = await prisma.affiliatePartner.findUnique({
      where: { id: filters.affiliatePartnerId },
      select: { id: true },
    });
    if (!partner) throw new AffiliateInputError("crm.analytics.filter_unknown");
  }

  if (filters.affiliateCampaignId !== undefined) {
    const campaign = await prisma.affiliateCampaign.findUnique({
      where: { id: filters.affiliateCampaignId },
      select: { id: true, affiliatePartnerId: true },
    });
    if (!campaign) throw new AffiliateInputError("crm.analytics.filter_unknown");
    if (
      filters.affiliatePartnerId !== undefined &&
      campaign.affiliatePartnerId !== filters.affiliatePartnerId
    ) {
      throw new AffiliateInputError("crm.analytics.filter_inconsistent");
    }
  }

  if (filters.trackingLinkId !== undefined) {
    const link = await prisma.affiliateTrackingLink.findUnique({
      where: { id: filters.trackingLinkId },
      select: { id: true, affiliatePartnerId: true, affiliateCampaignId: true },
    });
    if (!link) throw new AffiliateInputError("crm.analytics.filter_unknown");
    if (
      filters.affiliatePartnerId !== undefined &&
      link.affiliatePartnerId !== filters.affiliatePartnerId
    ) {
      throw new AffiliateInputError("crm.analytics.filter_inconsistent");
    }
    if (
      filters.affiliateCampaignId !== undefined &&
      link.affiliateCampaignId !== filters.affiliateCampaignId
    ) {
      throw new AffiliateInputError("crm.analytics.filter_inconsistent");
    }
  }
}

export function parseGrowthLimit(params: URLSearchParams): number {
  const raw = params.get("limit");
  if (raw === null) return GROWTH_DEFAULT_LIMIT;

  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) throw new AffiliateInputError("crm.analytics.limit_invalid");

  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 1 || value > GROWTH_MAX_LIMIT) {
    throw new AffiliateInputError("crm.analytics.limit_invalid");
  }
  return value;
}

/**
 * The level ceiling a funnel may ask for.
 *
 * Bounded so a caller cannot request an unbounded per-level result set. The
 * published curriculum has 100 levels, and a funnel wider than that describes
 * levels that do not exist.
 */
export const GROWTH_MAX_FUNNEL_LEVEL = 100;

export function parseFunnelMaxLevel(params: URLSearchParams): number {
  const raw = params.get("maxLevel");
  if (raw === null) return 15;

  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) throw new AffiliateInputError("crm.analytics.filter_invalid");

  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 1 || value > GROWTH_MAX_FUNNEL_LEVEL) {
    throw new AffiliateInputError("crm.analytics.filter_invalid");
  }
  return value;
}
