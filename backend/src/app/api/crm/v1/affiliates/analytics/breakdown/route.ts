import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  effectiveAvailability,
  type AffiliateStatus,
  type TrackingLinkStatus,
} from "@/lib/crm/affiliates";
import {
  ANALYTICS_MODE,
  RATE_MODE,
  ZERO_COUNTS,
  type MetricCounts,
} from "@/lib/analytics/affiliate-sources";
import {
  computeRatios,
  loadAmountAvailability,
  loadAmountAvailabilityByDimension,
  loadBreakdown,
  loadCounts,
  NO_DEPOSITS_AMOUNT,
  RATIO_DENOMINATORS,
  type BreakdownDimension,
} from "@/lib/analytics/affiliate-queries";
import { buildDataAvailability, RATE_MODE_EXPLANATION } from "@/lib/analytics/availability";
import { resolvePeriod } from "@/lib/analytics/periods";
import {
  analyticsErrorResponse,
  beginAnalyticsRequest,
  openAnalyticsRequest,
  serializePeriod,
} from "@/lib/analytics/routes";
import {
  assertFilterHierarchy,
  assertKnownAnalyticsKeys,
  parseBoolean,
  parseDimension,
  parseFilters,
  parsePaging,
  parsePeriodInput,
} from "@/lib/analytics/request";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/crm/v1/affiliates/analytics/breakdown
//
// One row per affiliate, campaign or tracking link. Never one row per learner:
// lead drilldown is AFD-5B2 and is reported as unavailable, not as an empty list.

const KEYS = [
  "preset",
  "startDate",
  "endDate",
  "dimension",
  "includeZeroActivity",
  "limit",
  "offset",
  "affiliatePartnerId",
  "affiliateCampaignId",
  "affiliateTrackingLinkId",
] as const;

type DimensionMeta = {
  id: number;
  displayName: string;
  code: string;
  status: string;
  archived: boolean;
  availability: string;
  affiliatePartnerId: string | null;
  affiliateCampaignId: string | null;
};

/**
 * Load the display identity of the dimension members that have data.
 *
 * Bounded by the id set the aggregation already produced, so this is one extra
 * query rather than one per row. Archived and paused entities are included:
 * history does not disappear because configuration was tidied up.
 */
async function loadMeta(
  dimension: BreakdownDimension,
  ids: number[],
): Promise<Map<number, DimensionMeta>> {
  const meta = new Map<number, DimensionMeta>();
  if (ids.length === 0) return meta;

  if (dimension === "affiliate") {
    const rows = await prisma.affiliatePartner.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, displayName: true, status: true, archivedAt: true },
    });
    for (const row of rows) {
      meta.set(row.id, {
        id: row.id,
        code: row.code,
        displayName: row.displayName,
        status: row.status,
        archived: row.archivedAt !== null,
        availability: effectiveAvailability(row.status as AffiliateStatus, []),
        affiliatePartnerId: String(row.id),
        affiliateCampaignId: null,
      });
    }
    return meta;
  }

  if (dimension === "campaign") {
    const rows = await prisma.affiliateCampaign.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        code: true,
        displayName: true,
        status: true,
        archivedAt: true,
        affiliatePartnerId: true,
        partner: { select: { status: true } },
      },
    });
    for (const row of rows) {
      meta.set(row.id, {
        id: row.id,
        code: row.code,
        displayName: row.displayName,
        status: row.status,
        archived: row.archivedAt !== null,
        availability: effectiveAvailability(row.status as AffiliateStatus, [
          row.partner.status as AffiliateStatus,
        ]),
        affiliatePartnerId: String(row.affiliatePartnerId),
        affiliateCampaignId: String(row.id),
      });
    }
    return meta;
  }

  const rows = await prisma.affiliateTrackingLink.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      publicCode: true,
      displayName: true,
      status: true,
      archivedAt: true,
      affiliatePartnerId: true,
      affiliateCampaignId: true,
      partner: { select: { status: true } },
      campaign: { select: { status: true } },
    },
  });
  for (const row of rows) {
    const parents: AffiliateStatus[] = [row.partner.status as AffiliateStatus];
    if (row.campaign) parents.push(row.campaign.status as AffiliateStatus);
    meta.set(row.id, {
      id: row.id,
      code: row.publicCode,
      displayName: row.displayName,
      status: row.status,
      archived: row.archivedAt !== null,
      availability: effectiveAvailability(row.status as TrackingLinkStatus, parents),
      affiliatePartnerId: String(row.affiliatePartnerId),
      affiliateCampaignId:
        row.affiliateCampaignId === null ? null : String(row.affiliateCampaignId),
    });
  }
  return meta;
}

/**
 * Inventory members that recorded no activity at all.
 *
 * Off by default and reachable only through an explicit parameter. A breakdown
 * is a traffic report, and silently padding it with every configured link would
 * bury the affiliates that actually did something.
 */
async function loadZeroActivityIds(
  dimension: BreakdownDimension,
  filters: { affiliatePartnerId?: number; affiliateCampaignId?: number },
  exclude: Set<number>,
): Promise<number[]> {
  const scope = {
    ...(filters.affiliatePartnerId === undefined
      ? {}
      : dimension === "affiliate"
        ? { id: filters.affiliatePartnerId }
        : { affiliatePartnerId: filters.affiliatePartnerId }),
  };

  const rows =
    dimension === "affiliate"
      ? await prisma.affiliatePartner.findMany({ where: scope, select: { id: true }, take: 500 })
      : dimension === "campaign"
        ? await prisma.affiliateCampaign.findMany({ where: scope, select: { id: true }, take: 500 })
        : await prisma.affiliateTrackingLink.findMany({
            where: scope,
            select: { id: true },
            take: 500,
          });

  return rows.map((row) => row.id).filter((id) => !exclude.has(id));
}

export async function GET(request: Request) {
  const { requestId, headers } = beginAnalyticsRequest();

  try {
    const { params, timezone, now } = await openAnalyticsRequest(request);
    assertKnownAnalyticsKeys(params, KEYS);

    const filters = parseFilters(params);
    await assertFilterHierarchy(filters);
    const period = resolvePeriod(parsePeriodInput(params), timezone, now);
    const dimension = parseDimension(params);
    const includeZeroActivity = parseBoolean(params, "includeZeroActivity");
    const { limit, offset } = parsePaging(params);

    const aggregated = await loadBreakdown(prisma, period, filters, dimension);

    let ids = [...aggregated.keys()];
    if (includeZeroActivity) {
      ids = ids.concat(await loadZeroActivityIds(dimension, filters, new Set(ids)));
    }

    const meta = await loadMeta(dimension, ids);

    // Deterministic and total: the busiest first, then a stable id tie-break so
    // two rows with identical traffic never swap places between pages.
    const ordered = ids
      .map((id) => {
        const row = aggregated.get(id);
        const counts: MetricCounts = row ? row.counts : { ...ZERO_COUNTS };
        return { id, counts, lastActivityAt: row?.lastActivityAt ?? null };
      })
      .sort((left, right) => {
        const byDeposits = right.counts.confirmedFirstDeposits - left.counts.confirmedFirstDeposits;
        if (byDeposits !== 0) return byDeposits;
        const byRegistrations = right.counts.academyRegistrations - left.counts.academyRegistrations;
        if (byRegistrations !== 0) return byRegistrations;
        const byClicks = right.counts.qualifiedClicks - left.counts.qualifiedClicks;
        if (byClicks !== 0) return byClicks;
        return left.id - right.id;
      });

    // The total describes the whole result set, so paging can never change it.
    const total = ordered.length;
    const page = ordered.slice(offset, offset + limit);

    // One grouped query for every row's money, never one query per row.
    const [amountsByDimension, attributedTotals, amounts] = await Promise.all([
      loadAmountAvailabilityByDimension(prisma, period, filters, dimension),
      loadCounts(prisma, period, filters, "attributed"),
      loadAmountAvailability(prisma, period, filters, "attributed"),
    ]);

    return NextResponse.json(
      {
        mode: ANALYTICS_MODE,
        rateMode: RATE_MODE,
        rateModeExplanation: RATE_MODE_EXPLANATION,
        ratioDenominators: RATIO_DENOMINATORS,
        period: serializePeriod(period),
        dimension,
        includeZeroActivity,
        total,
        limit,
        offset,
        rows: page.map((row) => {
          const info = meta.get(row.id);
          return {
            id: String(row.id),
            code: info?.code ?? null,
            displayName: info?.displayName ?? null,
            status: info?.status ?? null,
            availability: info?.availability ?? null,
            archived: info?.archived ?? false,
            affiliatePartnerId: info?.affiliatePartnerId ?? null,
            affiliateCampaignId: info?.affiliateCampaignId ?? null,
            metrics: row.counts,
            ratios: computeRatios(row.counts),
            firstDepositAmount: amountsByDimension.get(row.id) ?? NO_DEPOSITS_AMOUNT,
            lastActivityAt: row.lastActivityAt === null ? null : row.lastActivityAt.toISOString(),
          };
        }),
        // The attributed scope the rows partition, so a caller can check that
        // the page they received adds up to the whole under the same filters.
        attributedTotals,
        firstDepositAmount: amounts,
        dataAvailability: buildDataAvailability({
          amountAggregationAvailable: amounts.amountAggregationAvailable,
          amountUnavailableReason: amounts.unavailableReason,
        }),
        generatedAt: now.toISOString(),
      },
      { headers },
    );
  } catch (error) {
    return analyticsErrorResponse(error, requestId, headers);
  }
}
