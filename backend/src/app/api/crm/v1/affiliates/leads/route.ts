import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertFilterHierarchy } from "@/lib/analytics/request";
import { serializePeriod } from "@/lib/analytics/routes";
import { encodeLeadCursor } from "@/lib/leads/lead-cursor";
import { buildLeadListRow } from "@/lib/leads/lead-dto";
import { loadLeadFacts, loadLeadKeys } from "@/lib/leads/lead-queries";
import {
  LEADS_DEFAULT_PAGE_SIZE,
  LEADS_MAX_PAGE_SIZE,
  LEAD_SORTS,
  parseLeadListQuery,
} from "@/lib/leads/lead-request";
import { beginLeadRequest, leadErrorResponse, openLeadRequest } from "@/lib/leads/lead-routes";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/crm/v1/affiliates/leads
//
// One cursor page of leads, redacted. Attributed and direct registrations
// together, filtered by affiliate dimension, journey stage, deposit state and
// either or both of the two periods.
//
// READ-ONLY BY CONSTRUCTION. This module exports only `GET`, performs no write
// and takes no body, so there is no CSRF token to validate — CSRF defends state
// change and there is none here. The absence of a `POST`, `PATCH` or `DELETE`
// export is the enforcement, not a convention.
//
// NO FULL PII, FOR ANYONE. There is no branch in this route that renders an
// address, and none that a permission could unlock: `buildLeadListRow` returns
// the redacted identity unconditionally. A bulk reveal is therefore not
// something this endpoint refuses — it is something it cannot express.

export async function GET(request: Request) {
  const { requestId, headers } = beginLeadRequest();

  try {
    const { params, timezone, now, canRevealPii } = await openLeadRequest(request);
    const query = parseLeadListQuery(params, timezone, now);

    // Existence and parentage of the named dimensions, reusing the AFD-5B1
    // owner. Archived and paused entities stay valid historical filters: a lead
    // acquired last quarter must remain findable after somebody tidied up the
    // configuration.
    await assertFilterHierarchy(query.filters);

    // TWO STATEMENTS, ALWAYS. `loadLeadKeys` decides the page, `loadLeadFacts`
    // fills it in. Neither loops, and neither issues a per-lead query — the
    // count is independent of `limit`, which is what the N+1 proof measures.
    const keys = await loadLeadKeys(prisma, query);
    const hasMore = keys.length > query.limit;
    const page = hasMore ? keys.slice(0, query.limit) : keys;
    const facts = await loadLeadFacts(
      prisma,
      page.map((key) => key.rowId),
    );

    const last = page.length === 0 ? null : page[page.length - 1];

    return NextResponse.json(
      {
        filters: {
          affiliatePartnerId:
            query.filters.affiliatePartnerId === undefined
              ? null
              : String(query.filters.affiliatePartnerId),
          affiliateCampaignId:
            query.filters.affiliateCampaignId === undefined
              ? null
              : String(query.filters.affiliateCampaignId),
          affiliateTrackingLinkId:
            query.filters.affiliateTrackingLinkId === undefined
              ? null
              : String(query.filters.affiliateTrackingLinkId),
          attributionState: query.attributionState,
          journeyStage: query.journeyStage,
          depositState: query.depositState,
        },
        periods: {
          // Echoed separately and never merged: an operator must be able to see
          // that the server applied the window they meant, to the field they
          // meant. Silently reinterpreting one as the other is the failure this
          // shape exists to make visible.
          registration:
            query.registrationPeriod === null ? null : serializePeriod(query.registrationPeriod),
          acquisition:
            query.acquisitionPeriod === null ? null : serializePeriod(query.acquisitionPeriod),
        },
        sort: query.sort,
        supportedSorts: LEAD_SORTS,
        pageSize: query.limit,
        defaultPageSize: LEADS_DEFAULT_PAGE_SIZE,
        maxPageSize: LEADS_MAX_PAGE_SIZE,
        hasMore,
        // Null on the last page rather than a cursor that returns nothing, so a
        // client stops because the server said to and not because it guessed.
        nextCursor:
          hasMore && last !== null
            ? encodeLeadCursor(
                { nullBucket: last.nullBucket, sortValue: last.sortValue, rowId: last.rowId },
                query.fingerprint,
              )
            : null,
        rows: facts.map((row) => buildLeadListRow(row, canRevealPii)),
        generatedAt: now.toISOString(),
      },
      { headers },
    );
  } catch (error) {
    return leadErrorResponse(error, requestId, headers);
  }
}
