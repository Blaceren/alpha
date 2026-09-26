/**
 * AFFILIATE-PLATFORM-V1 §19 — the staff view of CPA qualifications, commissions
 * and outbound deliveries.
 *
 * READ ONLY, AND DELIBERATELY SO. There is no route in this file that creates,
 * edits, reverses or deletes a qualification or a commission. §19 forbids staff
 * casually mutating canonical financial truth as arbitrary form fields, and the
 * cheapest way to honour that is not to build the verb.
 *
 * WHAT AN OPERATOR CAN ANSWER FROM THIS ONE RESPONSE — the §14 questions, in
 * full: why did this conversion qualify, for which partner, under which
 * campaign, at which terms VERSION, at what rate, from which source deposit,
 * and when. Plus the delivery record: what ATA tried to tell the partner and
 * what happened.
 *
 * THE THREE MONEY FIGURES ARE NAMED SEPARATELY — the provider deposit amount,
 * the CPA snapshot, and the commission — because §51 forbids presenting one as
 * another and a single ambiguous "amount" column is how that happens.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  affiliateErrorResponse,
  affiliateHeaders,
  requireAffiliateReader,
} from "@/lib/crm/affiliate-routes";
import { crmRequestId } from "@/lib/crm/session";
import { parseAffiliateListQuery } from "@/lib/crm/affiliates";
import { groupAmountsByCurrency } from "@/lib/affiliate/partner/reporting";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const LIST_KEYS = ["limit", "offset", "affiliatePartnerId"] as const;

export async function GET(request: Request) {
  const requestId = crmRequestId();
  const headers = affiliateHeaders(requestId);
  try {
    await requireAffiliateReader();
    const query = parseAffiliateListQuery(new URL(request.url).searchParams, LIST_KEYS);
    const where = query.affiliatePartnerId
      ? { affiliatePartnerId: query.affiliatePartnerId }
      : {};

    const [total, rows, totals] = await prisma.$transaction([
      prisma.affiliateCpaQualification.count({ where }),
      prisma.affiliateCpaQualification.findMany({
        where,
        orderBy: [{ qualifiedAt: "desc" }, { id: "desc" }],
        take: query.limit,
        skip: query.offset,
        select: {
          publicId: true,
          qualifiedAt: true,
          affiliateCodeSnapshot: true,
          campaignCodeSnapshot: true,
          termsVersionSnapshot: true,
          cpaAmountSnapshot: true,
          cpaCurrencySnapshot: true,
          attributionId: true,
          terms: { select: { publicId: true, status: true } },
          partner: { select: { id: true, code: true, displayName: true } },
          conversionEvent: {
            select: {
              eventId: true,
              eventType: true,
              occurredAt: true,
              providerAmount: true,
              currencyCode: true,
              currencyStatus: true,
              userId: true,
            },
          },
          commission: { select: { publicId: true, amount: true, currencyCode: true, createdAt: true } },
        },
      }),
      prisma.affiliateCommission.findMany({
        where,
        select: { amount: true, currencyCode: true },
      }),
    ]);

    return NextResponse.json(
      {
        items: rows.map((row) => ({
          qualificationId: row.publicId,
          qualifiedAt: row.qualifiedAt.toISOString(),
          partner: {
            id: row.partner.id,
            code: row.partner.code,
            displayName: row.partner.displayName,
            codeAtQualification: row.affiliateCodeSnapshot,
          },
          campaignCodeAtQualification: row.campaignCodeSnapshot,
          // WHICH PRICE APPLIED, by version and by value, and whether that
          // version is still the live one. An operator seeing `superseded` here
          // is seeing §11 working, not a defect.
          terms: {
            termsId: row.terms.publicId,
            version: row.termsVersionSnapshot,
            cpaAmount: row.cpaAmountSnapshot,
            cpaCurrency: row.cpaCurrencySnapshot,
            currentStatus: row.terms.status,
          },
          attributionId: row.attributionId,
          // THE SOURCE DEPOSIT. A different number from the CPA above, and
          // labelled as the provider's amount so no surface can print it as
          // what ATA owes.
          sourceConversion: {
            conversionId: row.conversionEvent.eventId,
            eventType: row.conversionEvent.eventType,
            occurredAt: row.conversionEvent.occurredAt.toISOString(),
            providerAmount: row.conversionEvent.providerAmount,
            providerCurrency: row.conversionEvent.currencyCode,
            providerCurrencyStatus: row.conversionEvent.currencyStatus,
            userId: row.conversionEvent.userId,
          },
          commission:
            row.commission === null
              ? null
              : {
                  commissionId: row.commission.publicId,
                  amount: row.commission.amount,
                  currency: row.commission.currencyCode,
                  createdAt: row.commission.createdAt.toISOString(),
                },
        })),
        total,
        limit: query.limit,
        offset: query.offset,
        commissionTotals: groupAmountsByCurrency(
          totals.map((row) => ({ amount: row.amount, currency: row.currencyCode })),
        ),
      },
      { headers },
    );
  } catch (error) {
    return affiliateErrorResponse(error, requestId, headers);
  }
}
