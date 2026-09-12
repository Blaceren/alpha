/**
 * AFFILIATE-PLATFORM-V1 §19/§27 — staff visibility of outbound deliveries.
 *
 * READ ONLY. An operator can see what ATA tried to send, to which endpoint
 * version, how many times and with what result. They cannot re-send from here:
 * a manual re-send is a way to make a partner's conversion count depend on how
 * often somebody clicked, which §25 rules out.
 *
 * THE SIGNING SECRET IS NOT SELECTED. Neither is anything else that would let a
 * CRM reader forge a delivery.
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

export const dynamic = "force-dynamic";
export const revalidate = 0;

const LIST_KEYS = ["limit", "offset", "affiliatePartnerId", "status"] as const;

export async function GET(request: Request) {
  const requestId = crmRequestId();
  const headers = affiliateHeaders(requestId);
  try {
    await requireAffiliateReader();
    const query = parseAffiliateListQuery(new URL(request.url).searchParams, LIST_KEYS);

    const where = {
      ...(query.affiliatePartnerId ? { affiliatePartnerId: query.affiliatePartnerId } : {}),
      ...(query.status
        ? { status: query.status as "pending" | "delivered" | "failed_retryable" | "failed_terminal" }
        : {}),
    };

    const [total, rows] = await prisma.$transaction([
      prisma.affiliatePostbackDelivery.count({ where }),
      prisma.affiliatePostbackDelivery.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit,
        skip: query.offset,
        select: {
          publicId: true,
          eventType: true,
          status: true,
          attemptCount: true,
          maxAttempts: true,
          lastOutcome: true,
          lastHttpStatus: true,
          lastAttemptAt: true,
          nextAttemptAt: true,
          deliveredAt: true,
          endpointVersion: true,
          createdAt: true,
          partner: { select: { id: true, code: true } },
          conversionEvent: { select: { eventId: true, eventType: true } },
          attempts: {
            orderBy: { attemptNumber: "asc" },
            select: {
              attemptNumber: true,
              startedAt: true,
              outcome: true,
              httpStatus: true,
              durationMs: true,
              responseSnippet: true,
            },
          },
        },
      }),
    ]);

    return NextResponse.json(
      {
        items: rows.map((row) => ({
          deliveryId: row.publicId,
          partner: { id: row.partner.id, code: row.partner.code },
          conversionId: row.conversionEvent.eventId,
          eventType: row.eventType,
          status: row.status,
          attemptCount: row.attemptCount,
          maxAttempts: row.maxAttempts,
          lastOutcome: row.lastOutcome,
          lastHttpStatus: row.lastHttpStatus,
          lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
          nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
          deliveredAt: row.deliveredAt?.toISOString() ?? null,
          endpointVersion: row.endpointVersion,
          createdAt: row.createdAt.toISOString(),
          attempts: row.attempts.map((attempt) => ({
            attemptNumber: attempt.attemptNumber,
            startedAt: attempt.startedAt.toISOString(),
            outcome: attempt.outcome,
            httpStatus: attempt.httpStatus,
            durationMs: attempt.durationMs,
            // Remote-controlled text, bounded and control-character-free at the
            // writer. Rendered as text, never as markup.
            responseSnippet: attempt.responseSnippet,
          })),
        })),
        total,
        limit: query.limit,
        offset: query.offset,
      },
      { headers },
    );
  } catch (error) {
    return affiliateErrorResponse(error, requestId, headers);
  }
}
