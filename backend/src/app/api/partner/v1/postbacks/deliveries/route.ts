/**
 * AFFILIATE-PLATFORM-V1 §27 — the partner's outbound delivery ledger.
 *
 * ONE ROW PER LOGICAL DELIVERY, with its attempt history attached. A partner
 * debugging their receiver needs to distinguish "we told you once and you said
 * 500 six times" from "we told you six times", and this is the surface where
 * that distinction is visible.
 *
 * `responseSnippet` IS THE ONLY REMOTE-CONTROLLED VALUE IN THE PLATFORM. It is
 * bounded to 256 characters and stripped of control characters by the writer,
 * it is returned as JSON text, and the console renders it as TEXT — never as
 * markup. A partner's own server cannot inject script into their own console
 * this way, and certainly not into anybody else's, since the row is
 * tenant-scoped.
 *
 * THE SIGNING SECRET IS NOT HERE, and neither is any ATA credential. The
 * `requestUrl` is stored and shown because it is the partner's own payload,
 * and the signature travels in a header — so a delivery URL carries nothing
 * secret by construction.
 */
import type { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withPartnerRequest, partnerJson } from "@/lib/affiliate/partner/request";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export async function GET(request: Request): Promise<NextResponse> {
  return withPartnerRequest(request, async (principal) => {
    const rows = await prisma.affiliatePostbackDelivery.findMany({
      where: { affiliatePartnerId: principal.affiliatePartnerId },
      orderBy: { id: "desc" },
      take: PAGE_SIZE,
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
        requestUrl: true,
        endpointVersion: true,
        createdAt: true,
        conversionEvent: { select: { eventId: true } },
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
    });

    return partnerJson({
      rows: rows.map((row) => ({
        deliveryId: row.publicId,
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
        requestUrl: row.requestUrl,
        endpointVersion: row.endpointVersion,
        createdAt: row.createdAt.toISOString(),
        attempts: row.attempts.map((attempt) => ({
          attemptNumber: attempt.attemptNumber,
          startedAt: attempt.startedAt.toISOString(),
          outcome: attempt.outcome,
          httpStatus: attempt.httpStatus,
          durationMs: attempt.durationMs,
          responseSnippet: attempt.responseSnippet,
        })),
      })),
    });
  });
}
