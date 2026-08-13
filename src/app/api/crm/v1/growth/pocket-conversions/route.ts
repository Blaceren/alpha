import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolvePeriod } from "@/lib/analytics/periods";
import {
  analyticsErrorResponse,
  beginAnalyticsRequest,
  openAnalyticsRequest,
  serializePeriod,
} from "@/lib/analytics/routes";
import { assertKnownAnalyticsKeys, parsePeriodInput } from "@/lib/analytics/request";
import { GROWTH_ANALYTICS_MODE } from "@/lib/growth/analytics/sources";
import {
  countLedgerEvents,
  countUnresolvedRedeposits,
  loadFirstDepositAmounts,
} from "@/lib/growth/analytics/queries";
import { buildGrowthAvailability } from "@/lib/growth/analytics/availability";
import {
  GROWTH_COMMON_KEYS,
  assertGrowthFilterHierarchy,
  parseGrowthFilters,
} from "@/lib/growth/analytics/request";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/crm/v1/growth/pocket-conversions
 *
 * The Pocket money surface, with the four states kept visually and structurally
 * apart (§42).
 *
 * `pocketRegistrations` — a trusted provider confirmation that the learner
 *     registered with Pocket. Carries no money and never will.
 * `firstDeposits`       — the FIRST confirmed deposit for a Pocket player, one
 *     per player, with the provider's actual amount.
 * `confirmedRedeposits` — a later deposit that ATA can PROVE is not a redelivery.
 *     Structurally zero today, and the block below says why rather than letting
 *     the number speak for itself.
 * `unresolvedRedeposits` — deliveries ATA received, validated and deliberately
 *     did not count. AN OPERATIONAL COUNT, NEVER A MONETARY ONE.
 *
 * DEP AND RDEP ARE NEVER SUMMED HERE. `totalDepositAmount` covers first deposits
 * only, and says so in its own field name and in the accompanying note. The
 * moment a redeposit contract exists, adding it is a deliberate change to this
 * file rather than something that silently starts happening.
 *
 * NO BALANCE, NO P&L, NO COMMISSION. None of the three exists in this platform's
 * data, and a surface that displayed any of them would be displaying a guess.
 */
export async function GET(request: Request) {
  const { requestId, headers } = beginAnalyticsRequest();

  try {
    const { params, timezone, now } = await openAnalyticsRequest(request);
    assertKnownAnalyticsKeys(params, GROWTH_COMMON_KEYS);

    const filters = parseGrowthFilters(params);
    await assertGrowthFilterHierarchy(filters);
    const period = resolvePeriod(parsePeriodInput(params), timezone, now);
    const window = { start: period.startUtc ?? new Date(0), end: period.endUtc };

    const [pocketRegistrations, firstDeposits, confirmedRedeposits, unresolvedRedeposits, amounts] =
      await Promise.all([
        countLedgerEvents(prisma, window, filters, "attributed", "pocket_reg"),
        countLedgerEvents(prisma, window, filters, "attributed", "dep"),
        countLedgerEvents(prisma, window, filters, "attributed", "rdep"),
        countUnresolvedRedeposits(prisma, window),
        loadFirstDepositAmounts(prisma, window, filters, "attributed"),
      ]);

    return NextResponse.json(
      {
        mode: GROWTH_ANALYTICS_MODE,
        period: serializePeriod(period),
        filters: {
          affiliatePartnerId: filters.affiliatePartnerId ?? null,
          affiliateCampaignId: filters.affiliateCampaignId ?? null,
          trackingLinkId: filters.trackingLinkId ?? null,
        },
        conversions: {
          pocketRegistrations,
          firstDeposits,
          confirmedRedeposits,
        },
        // Separate object, not a sibling count, so a client cannot render it in
        // the same row as a confirmed conversion by accident.
        operational: {
          unresolvedRedeposits,
          unresolvedRedepositsMeaning:
            "Deliveries received and validated. NOT counted as money because Pocket " +
            "supplies no unique event identifier, so a retry cannot be told apart " +
            "from a genuine second deposit. This is not a count of zero redeposits.",
        },
        firstDepositAmount: amounts,
        totalDepositAmountNote:
          "Covers FIRST deposits only. Confirmed redeposits are structurally zero " +
          "until a provider event-identity contract exists, and quarantined or " +
          "identity-unresolved deliveries are never included in any monetary total.",
        prohibited: {
          currentBalance: "not_collected",
          profitAndLoss: "not_collected",
          commission: "not_in_scope_for_growth_v1",
        },
        dataAvailability: buildGrowthAvailability({
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
