import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  effectiveAvailability,
  type AffiliateStatus,
  type TrackingLinkStatus,
} from "@/lib/crm/affiliates";
import type { BreakdownDimension } from "@/lib/analytics/affiliate-queries";
import {
  COHORT_RATE_DENOMINATORS,
  computeCohortRates,
  cohortScope,
  EMPTY_MEDIANS,
  loadCohortAmount,
  loadCohortAmountByDimension,
  loadCohortBreakdown,
  loadCohortCounts,
  NO_COHORT_DEPOSITS,
  ZERO_COHORT_COUNTS,
  type CohortCounts,
  type CohortMedians,
} from "@/lib/analytics/cohort-queries";
import {
  buildCohortAvailability,
  COHORT_MODE_EXPLANATION,
  COHORT_VERSUS_EVENT_DATE_EXPLANATION,
} from "@/lib/analytics/cohort-availability";
import { buildFollowupMetadata } from "@/lib/analytics/cohort-time";
import {
  COHORT_BASE_KEYS,
  COHORT_IDENTITY,
  resolveCohortCutoff,
  serializeCutoff,
  serializeFilters,
} from "@/lib/analytics/cohort-routes";
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

// GET /api/crm/v1/affiliates/analytics/cohorts/breakdown
//
// One row per affiliate, campaign or tracking link — NEVER one row per learner.
// Lead drilldown is AFD-5B2B and is reported as unavailable, not as an empty
// list.

const KEYS = [
  ...COHORT_BASE_KEYS,
  "dimension",
  "includeZeroActivity",
  "limit",
  "offset",
] as const;

type DimensionMeta = {
  displayName: string;
  code: string;
  status: string;
  archived: boolean;
  availability: string;
  affiliatePartnerId: string | null;
  affiliateCampaignId: string | null;
};

/**
 * The display identity of the members that have a cohort.
 *
 * Bounded by the id set the aggregation already produced, so this is ONE extra
 * query rather than one per row. ARCHIVED AND PAUSED MEMBERS ARE INCLUDED: an
 * archived partner still acquired the learners it acquired, and dropping it
 * would make history disappear the moment somebody tidied the configuration.
 * The code shown is the member's own immutable code / publicCode.
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
 * Inventory members that acquired nobody in the interval.
 *
 * Off by default and reachable only through an explicit parameter. A cohort
 * breakdown is an acquisition report, and silently padding it with every
 * configured link would bury the affiliates that actually acquired someone.
 */
async function loadZeroCohortIds(
  dimension: BreakdownDimension,
  filters: { affiliatePartnerId?: number },
  exclude: Set<number>,
): Promise<number[]> {
  const scope =
    filters.affiliatePartnerId === undefined
      ? {}
      : dimension === "affiliate"
        ? { id: filters.affiliatePartnerId }
        : { affiliatePartnerId: filters.affiliatePartnerId };

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
    const cutoff = resolveCohortCutoff(params, period, timezone, now);
    const dimension = parseDimension(params);
    const includeZeroActivity = parseBoolean(params, "includeZeroActivity");
    const { limit, offset } = parsePaging(params);
    const scope = cohortScope(period, cutoff, filters);

    const aggregated = await loadCohortBreakdown(prisma, scope, dimension);

    let ids = [...aggregated.keys()];
    if (includeZeroActivity) {
      ids = ids.concat(await loadZeroCohortIds(dimension, filters, new Set(ids)));
    }

    const [meta, amountsByDimension, totals, amount] = await Promise.all([
      loadMeta(dimension, ids),
      // ONE grouped query for every row's money, never one query per row.
      loadCohortAmountByDimension(prisma, scope, dimension),
      loadCohortCounts(prisma, scope),
      loadCohortAmount(prisma, scope),
    ]);

    // Deterministic and total: the biggest cohorts first, then a stable id
    // tie-break so two rows with identical figures never swap places between
    // pages.
    const ordered = ids
      .map((id) => {
        const row = aggregated.get(id);
        const counts: CohortCounts = row ? row.counts : { ...ZERO_COHORT_COUNTS };
        const medians: CohortMedians = row ? row.medians : { ...EMPTY_MEDIANS };
        return { id, counts, medians, lastCohortActivityAt: row?.lastCohortActivityAt ?? null };
      })
      .sort((left, right) => {
        const byDeposits = right.counts.firstDepositLearners - left.counts.firstDepositLearners;
        if (byDeposits !== 0) return byDeposits;
        const byPocket =
          right.counts.pocketRegisteredLearners - left.counts.pocketRegisteredLearners;
        if (byPocket !== 0) return byPocket;
        const byCohort = right.counts.cohortLearners - left.counts.cohortLearners;
        if (byCohort !== 0) return byCohort;
        return left.id - right.id;
      });

    // The total describes the whole result set, so paging can never change it.
    const total = ordered.length;
    const page = ordered.slice(offset, offset + limit);
    const followup = buildFollowupMetadata(period, cutoff);

    return NextResponse.json(
      {
        ...COHORT_IDENTITY,
        cohortModeExplanation: COHORT_MODE_EXPLANATION,
        cohortVersusEventDate: COHORT_VERSUS_EVENT_DATE_EXPLANATION,
        rateDenominators: COHORT_RATE_DENOMINATORS,
        cohortPeriod: serializePeriod(period),
        reportCutoff: serializeCutoff(cutoff),
        filters: serializeFilters(filters),
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
            rates: computeCohortRates(row.counts),
            medianLags: row.medians,
            // The observation window is the report's and is identical for every
            // row: the rows differ by affiliate, not by how long they were
            // watched.
            followup,
            firstDepositAmount: amountsByDimension.get(row.id) ?? NO_COHORT_DEPOSITS,
            lastCohortActivityAt:
              row.lastCohortActivityAt === null
                ? null
                : row.lastCohortActivityAt.toISOString(),
          };
        }),
        // The scope the rows partition, so a caller can check that the page they
        // received adds up to the whole under the same filters and cutoff.
        cohortTotals: {
          metrics: totals,
          rates: computeCohortRates(totals),
          followup,
        },
        firstDepositAmount: amount,
        dataAvailability: buildCohortAvailability({
          amountAggregationAvailable: amount.amountAggregationAvailable,
          amountUnavailableReason: amount.unavailableReason,
        }),
        generatedAt: now.toISOString(),
      },
      { headers },
    );
  } catch (error) {
    return analyticsErrorResponse(error, requestId, headers);
  }
}
