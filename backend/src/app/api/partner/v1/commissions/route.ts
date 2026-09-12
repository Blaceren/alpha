/**
 * AFFILIATE-PLATFORM-V1 §13/§51 — what ATA owes this partner.
 *
 * THREE NUMBERS ARE KEPT APART, AND THIS ROUTE NAMES ALL THREE. A row carries
 * the COMMISSION amount (what ATA owes), the CPA TERMS it was computed from
 * (the agreed rate and its version), and the PROVIDER DEPOSIT amount that
 * qualified it. §51 forbids presenting any of them as another, so all three are
 * distinct fields with distinct names rather than one figure a reader has to
 * interpret.
 *
 * THERE IS NO STATUS, NO PAYOUT AND NO SETTLEMENT, because no owner in this
 * product has authority over any of them. A row here means: this was earned.
 * What happens next is out of scope and is not implied by anything returned.
 */
import type { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withPartnerRequest, partnerJson } from "@/lib/affiliate/partner/request";
import { groupAmountsByCurrency } from "@/lib/affiliate/partner/reporting";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export async function GET(request: Request): Promise<NextResponse> {
  return withPartnerRequest(request, async (principal) => {
    const rows = await prisma.affiliateCommission.findMany({
      where: { affiliatePartnerId: principal.affiliatePartnerId },
      orderBy: { id: "desc" },
      take: PAGE_SIZE,
      select: {
        publicId: true,
        amount: true,
        currencyCode: true,
        createdAt: true,
        qualification: {
          select: {
            qualifiedAt: true,
            campaignCodeSnapshot: true,
            termsVersionSnapshot: true,
            cpaAmountSnapshot: true,
            cpaCurrencySnapshot: true,
            conversionEvent: {
              select: { eventId: true, providerAmount: true, currencyCode: true, occurredAt: true },
            },
          },
        },
      },
    });

    const totals = await prisma.affiliateCommission.findMany({
      where: { affiliatePartnerId: principal.affiliatePartnerId },
      select: { amount: true, currencyCode: true },
    });

    return partnerJson({
      totals: groupAmountsByCurrency(
        totals.map((row) => ({ amount: row.amount, currency: row.currencyCode })),
      ),
      rows: rows.map((row) => ({
        commissionId: row.publicId,
        // WHAT ATA OWES.
        amount: row.amount,
        currency: row.currencyCode,
        createdAt: row.createdAt.toISOString(),
        qualifiedAt: row.qualification.qualifiedAt.toISOString(),
        campaignCode: row.qualification.campaignCodeSnapshot,
        // THE AGREED RATE IT WAS COMPUTED FROM, and the version, so a partner
        // can see that a later price change did not touch this row.
        cpaTerms: {
          version: row.qualification.termsVersionSnapshot,
          amount: row.qualification.cpaAmountSnapshot,
          currency: row.qualification.cpaCurrencySnapshot,
        },
        // THE DEPOSIT THAT QUALIFIED IT. A DIFFERENT NUMBER, labelled as such.
        qualifyingDeposit: {
          conversionId: row.qualification.conversionEvent.eventId,
          amount: row.qualification.conversionEvent.providerAmount,
          currency: row.qualification.conversionEvent.currencyCode,
          occurredAt: row.qualification.conversionEvent.occurredAt.toISOString(),
        },
      })),
    });
  });
}
