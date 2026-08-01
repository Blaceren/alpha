import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  COHORT_RATE_DENOMINATORS,
  computeCohortRates,
  cohortScope,
  loadCohortAmount,
  loadCohortCounts,
  loadCohortIntegrity,
  loadCohortMedians,
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
  parseFilters,
  parsePeriodInput,
} from "@/lib/analytics/request";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/crm/v1/affiliates/analytics/cohorts/summary
//
// Registered attributed learners selected by their frozen selected acquisition
// click, and their Pocket-registration and first-deposit conversion observed
// through an explicit cutoff. No learner rows, no identifiers, no PII.

export async function GET(request: Request) {
  const { requestId, headers } = beginAnalyticsRequest();

  try {
    const { params, timezone, now } = await openAnalyticsRequest(request);
    assertKnownAnalyticsKeys(params, COHORT_BASE_KEYS);

    const filters = parseFilters(params);
    await assertFilterHierarchy(filters);

    // The cohort interval reuses AFD-5B1's preset contract unchanged; only the
    // thing it selects is different — clicks, not events.
    const period = resolvePeriod(parsePeriodInput(params), timezone, now);
    const cutoff = resolveCohortCutoff(params, period, timezone, now);
    const scope = cohortScope(period, cutoff, filters);

    const [counts, medians, amount, integrity] = await Promise.all([
      loadCohortCounts(prisma, scope),
      loadCohortMedians(prisma, scope),
      loadCohortAmount(prisma, scope),
      loadCohortIntegrity(prisma, scope),
    ]);

    return NextResponse.json(
      {
        ...COHORT_IDENTITY,
        cohortModeExplanation: COHORT_MODE_EXPLANATION,
        cohortVersusEventDate: COHORT_VERSUS_EVENT_DATE_EXPLANATION,
        rateDenominators: COHORT_RATE_DENOMINATORS,
        cohortPeriod: serializePeriod(period),
        reportCutoff: serializeCutoff(cutoff),
        filters: serializeFilters(filters),
        metrics: counts,
        rates: computeCohortRates(counts),
        medianLags: medians,
        followup: buildFollowupMetadata(period, cutoff),
        firstDepositAmount: amount,
        integrityWarnings: integrity,
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
