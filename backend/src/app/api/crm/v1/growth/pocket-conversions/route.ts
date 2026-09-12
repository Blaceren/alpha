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
import {
  GROWTH_ANALYTICS_MODE,
  GROWTH_DEFAULT_COVERAGE_SCOPE,
} from "@/lib/growth/analytics/sources";
import {
  countLedgerEvents,
  countUnresolvedRedeposits,
  loadFirstDepositAmounts,
  loadRegistrationOriginCoverage,
} from "@/lib/growth/analytics/queries";
import { buildGrowthAvailability } from "@/lib/growth/analytics/availability";
import { resolveRedepositCapability } from "@/lib/growth/ingress-config";
import {
  GROWTH_COMMON_KEYS,
  assertGrowthFilterHierarchy,
  parseGrowthFilters,
  parseGrowthScope,
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
    // G4-H4. `total` by default. Pocket registrations and deposits are business
    // facts whether or not ATA can attribute the learner to a tracking link, and
    // the audited candidate made all nine of PREPROD's Pocket registrations
    // disappear by hard-coding `attributed` here.
    const scope = parseGrowthScope(params);
    const window = { start: period.startUtc ?? new Date(0), end: period.endUtc };

    const [
      pocketRegistrations,
      firstDeposits,
      confirmedRedeposits,
      unresolvedRedeposits,
      amounts,
      registrationOriginCoverage,
    ] = await Promise.all([
        countLedgerEvents(prisma, window, filters, scope, "pocket_reg"),
        countLedgerEvents(prisma, window, filters, scope, "dep"),
        countLedgerEvents(prisma, window, filters, scope, "rdep"),
        countUnresolvedRedeposits(prisma, window),
        loadFirstDepositAmounts(prisma, window, filters, scope),
        // G4-R12. See the overview route.
        loadRegistrationOriginCoverage(prisma),
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
        scope,
        defaultScope: GROWTH_DEFAULT_COVERAGE_SCOPE,
        conversions: {
          pocketRegistrations,
          firstDeposits,
          confirmedRedeposits,
        },
        // Separate object, not a sibling count, so a client cannot render it in
        // the same row as a confirmed conversion by accident.
        operational: {
          unresolvedRedeposits,
          // RDEP-AVAIL-1. This used to say redeposits were not counted "because
          // Pocket supplies no unique event identifier, so a retry cannot be told
          // apart from a genuine second deposit". ATA now derives its own
          // deterministic identity, so that is no longer why anything is
          // unresolved — what remains unresolved is a delivery whose identity
          // could not be DERIVED, a different and much smaller set.
          unresolvedRedepositsMeaning:
            "Deliveries received and validated whose canonical redeposit identity " +
            "could not be derived — typically a missing or malformed provider event " +
            "time. Kept as evidence and NOT counted as money. This is not a count " +
            "of zero redeposits.",
          // G4-M3. ProviderIngressEvent carries no acquisition linkage, so this
          // count cannot be narrowed to a campaign or a coverage scope. Saying so
          // is the honest alternative to silently reporting a platform-wide
          // number inside a filtered slice, which is what it used to do.
          unresolvedRedepositsScope: "platform_wide_not_filtered",
        },
        firstDepositAmount: amounts,
        // RDEP-AVAIL-2. This note used to say confirmed redeposits were
        // "structurally zero until a provider event-identity contract exists" —
        // a sentence that shipped in the SAME payload as a non-zero
        // confirmedRedeposits count, because ATA now derives its own
        // deterministic redeposit identity and counts them. It was the seventh
        // and last home of that superseded premise, and the one that had become
        // self-contradicting rather than merely stale. The clause about
        // quarantined and identity-unresolved deliveries was and remains true,
        // so it survives; only the false premise is removed.
        totalDepositAmountNote:
          "Covers FIRST deposits only; redeposit amounts are reported separately " +
          "and are never added to this total. Quarantined and identity-unresolved " +
          "deliveries are never included in any monetary total.",
        prohibited: {
          currentBalance: "not_collected",
          profitAndLoss: "not_collected",
          commission: "not_in_scope_for_growth_v1",
        },
        dataAvailability: buildGrowthAvailability({
          redepositCapability: resolveRedepositCapability(),
          amountAggregationAvailable: amounts.amountAggregationAvailable,
          amountUnavailableReason: amounts.unavailableReason,
          registrationOriginCoverage,
        }),
        generatedAt: now.toISOString(),
      },
      { headers },
    );
  } catch (error) {
    return analyticsErrorResponse(error, requestId, headers);
  }
}
