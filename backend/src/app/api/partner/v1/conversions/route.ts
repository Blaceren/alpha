/**
 * AFFILIATE-PLATFORM-V1 §24 — the partner's own conversion history.
 *
 * REG, DEP AND RDEP ARE DISTINGUISHED TRUTHFULLY and never collapsed: they are
 * three different business facts, and a partner reading "conversion" without
 * knowing which one is reading nothing.
 *
 * WHAT IS NOT HERE IS NOT FILTERED OUT — IT IS NEVER SELECTED. No learner
 * identity, no Pocket player id, no Pocket click id, no balance, no P&L, no
 * trading volume, no internal row id and no secret. See `reporting.ts`, which
 * owns the projection.
 *
 * KEYSET PAGINATION ON THE PRIMARY KEY, and the cursor is validated as a plain
 * integer. It is not an object id a partner can substitute to reach another
 * tenant: the tenant predicate is applied independently of it, so a forged
 * cursor changes only where in THEIR OWN list the page starts.
 */
import type { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withPartnerRequest, partnerError, partnerJson } from "@/lib/affiliate/partner/request";
import { parsePartnerFilters } from "@/lib/affiliate/partner/filters";
import { listPartnerConversions } from "@/lib/affiliate/partner/reporting";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const EVENT_TYPES = new Set(["academy_registration", "first_deposit", "redeposit"]);

export async function GET(request: Request): Promise<NextResponse> {
  return withPartnerRequest(request, async (principal) => {
    const params = new URL(request.url).searchParams;
    const filters = await parsePartnerFilters(prisma, principal.affiliatePartnerId, params);
    if (!filters.ok) {
      return partnerError("invalid_request", `partner.filters.${filters.reason}`);
    }

    const rawType = params.get("eventType");
    if (rawType !== null && rawType !== "" && !EVENT_TYPES.has(rawType)) {
      return partnerError("invalid_request", "partner.filters.unknown_event_type");
    }

    const rawCursor = params.get("cursor");
    let cursor: number | undefined;
    if (rawCursor !== null && rawCursor !== "") {
      const parsed = Number(rawCursor);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return partnerError("invalid_request", "partner.filters.invalid_cursor");
      }
      cursor = parsed;
    }

    const page = await listPartnerConversions(
      prisma,
      principal.affiliatePartnerId,
      { ...filters.filters, ...(rawType ? { eventType: rawType } : {}) },
      { take: PAGE_SIZE, ...(cursor !== undefined ? { cursor } : {}) },
    );

    return partnerJson({ rows: page.rows, nextCursor: page.nextCursor });
  });
}
