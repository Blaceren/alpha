import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { AffiliateInputError } from "@/lib/crm/affiliates";
import { buildLeadDataAvailability } from "@/lib/leads/lead-availability";
import { buildLeadDetail } from "@/lib/leads/lead-dto";
import { loadLeadByEventId } from "@/lib/leads/lead-queries";
import {
  beginLeadRequest,
  leadErrorResponse,
  leadNotFound,
  openLeadRequest,
  requireLeadEventId,
} from "@/lib/leads/lead-routes";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/crm/v1/affiliates/leads/[leadId]
//
// One lead: redacted identity, frozen acquisition, journey and deposit summaries,
// the factual timeline, and an explicit statement of what is not available.
//
// REDACTED BY DEFAULT, INCLUDING FOR AN ADMINISTRATOR. There is no query
// parameter, header or permission that makes this route render an address. Full
// identity has exactly one owner and it is a POST — see `reveal/route.ts` — so
// opening a lead can never be the thing that discloses a learner.
//
// NO MUTATION LIVES HERE. Only `GET` is exported: no attribution override, no
// stage change, no conversion edit and no note. The lead's history is other
// owners' output and this route only reads it.

type RouteContext = { params: Promise<{ leadId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { requestId, headers } = beginLeadRequest();

  try {
    const { timezone, now, params, canRevealPii } = await openLeadRequest(request);

    // The detail route takes NO query parameters. Accepting and ignoring one
    // would let a caller believe they had filtered a timeline they had not.
    if ([...params.keys()].length > 0) {
      throw new AffiliateInputError("crm.leads.query_unknown");
    }

    const eventId = requireLeadEventId((await context.params).leadId);
    const facts = await loadLeadByEventId(prisma, eventId);
    if (facts === null) leadNotFound();

    const detail = buildLeadDetail(facts, timezone, canRevealPii);

    return NextResponse.json(
      {
        lead: detail,
        dataAvailability: buildLeadDataAvailability({
          attributed: detail.acquisition.attributionState === "attributed",
          pocketRegistered: detail.journey.pocketRegisteredAt !== null,
          depositState: detail.deposit.depositState,
        }),
        generatedAt: now.toISOString(),
      },
      { headers },
    );
  } catch (error) {
    return leadErrorResponse(error, requestId, headers);
  }
}
