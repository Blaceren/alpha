/**
 * AFFILIATE-PLATFORM-V1 §22/§23 — the partner dashboard's headline numbers.
 *
 * THE TENANT COMES FROM THE SESSION. There is no partner id in this path, in
 * this query string or in any body, so there is nothing here to substitute.
 *
 * NOTHING IS FABRICATED. A conversion rate with a zero denominator is `null`,
 * not `0`. Amounts are grouped by currency and a bucket whose currency the
 * provider never stated is labelled as such rather than being folded into a
 * total. See `reporting.ts`.
 */
import type { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withPartnerRequest, partnerError, partnerJson } from "@/lib/affiliate/partner/request";
import { parsePartnerFilters } from "@/lib/affiliate/partner/filters";
import { getPartnerOverview } from "@/lib/affiliate/partner/reporting";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  return withPartnerRequest(request, async (principal) => {
    const params = new URL(request.url).searchParams;
    const filters = await parsePartnerFilters(prisma, principal.affiliatePartnerId, params);
    if (!filters.ok) {
      return partnerError("invalid_request", `partner.filters.${filters.reason}`);
    }

    const overview = await getPartnerOverview(
      prisma,
      principal.affiliatePartnerId,
      filters.filters,
    );

    return partnerJson({
      clicks: overview.clicks,
      reg: overview.reg,
      dep: overview.dep,
      rdep: overview.rdep,
      clickToRegRate: overview.clickToRegRate,
      regToDepRate: overview.regToDepRate,
      depAmounts: overview.depAmounts,
      rdepAmounts: overview.rdepAmounts,
      cpaQualifications: overview.cpaQualifications,
      commissionTotals: overview.commissionTotals,
    });
  });
}
