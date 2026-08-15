/**
 * AFFILIATE-PLATFORM-V1 §9/§20 — the commercial campaigns THIS partner may use.
 *
 * ELIGIBILITY IS THE FOREIGN KEY, NOT A RULE. `AffiliateCampaign` is scoped to
 * one partner by `@@unique([affiliatePartnerId, code])`, so "campaigns
 * available to me" is a filter on the tenant and needs no assignment table and
 * no permission check of its own.
 *
 * THE CPA IS SHOWN, AND IT IS THE ACTIVE VERSION. A partner is a commercial
 * counterparty and is entitled to see the rate they are working under. What
 * they are NOT shown is the version history: a superseded price is ATA's
 * internal record of a negotiation, and §19 keeps commercial configuration a
 * staff-owned surface.
 *
 * A CAMPAIGN WITH NO ACTIVE TERMS REPORTS `cpa: null`, truthfully. That is a
 * campaign whose commercial terms have not been agreed, and a deposit
 * attributed to it produces no qualification — see the qualifier's fourth
 * precondition. Showing `0.00` here would imply an agreed price of nothing.
 */
import type { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withPartnerRequest, partnerJson } from "@/lib/affiliate/partner/request";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  return withPartnerRequest(request, async (principal) => {
    const campaigns = await prisma.affiliateCampaign.findMany({
      where: { affiliatePartnerId: principal.affiliatePartnerId, status: { not: "archived" } },
      orderBy: { createdAt: "desc" },
      select: {
        code: true,
        displayName: true,
        status: true,
        commercialTerms: {
          where: { status: "active" },
          select: { cpaAmount: true, cpaCurrency: true, version: true, effectiveFrom: true },
        },
      },
    });

    return partnerJson({
      rows: campaigns.map((campaign) => {
        const terms = campaign.commercialTerms[0] ?? null;
        return {
          code: campaign.code,
          displayName: campaign.displayName,
          status: campaign.status,
          cpa:
            terms === null
              ? null
              : {
                  amount: terms.cpaAmount,
                  currency: terms.cpaCurrency,
                  version: terms.version,
                  effectiveFrom: terms.effectiveFrom.toISOString(),
                },
        };
      }),
    });
  });
}
