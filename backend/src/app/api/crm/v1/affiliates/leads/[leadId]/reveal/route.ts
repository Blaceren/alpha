import { NextResponse } from "next/server";
import { createAuditLogStrict } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { AffiliateForbiddenError, AffiliateInputError } from "@/lib/crm/affiliates";
import {
  requireAffiliateCsrf,
  requireAffiliateReader,
  resolveAffiliateActorUserId,
} from "@/lib/crm/affiliate-routes";
import { canRevealLeadPii } from "@/lib/crm/roles";
import { revealedIdentity, toLeadId } from "@/lib/leads/lead-identity";
import { loadLeadByEventId } from "@/lib/leads/lead-queries";
import {
  beginLeadRequest,
  leadErrorResponse,
  leadNotFound,
  requireLeadEventId,
} from "@/lib/leads/lead-routes";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// POST /api/crm/v1/affiliates/leads/[leadId]/reveal
//
// The ONLY route in this platform that returns an affiliate lead's full
// identity, and it returns exactly one lead's.
//
// WHY POST AND NOT GET, FOR AN OPERATION THAT WRITES NO BUSINESS DATA. It
// creates a security audit event, and a GET is the one method the world assumes
// it may repeat for free: a browser prefetch, a link preview, a crawler, a
// bookmark sync or an over-eager client retry would each mint an audit row
// claiming an operator looked at a learner they never opened. Requiring POST
// also brings CSRF into scope, so a third-party page cannot cause a logged-in
// administrator's browser to perform a reveal in the background.
//
// WHY THERE IS NO PARALLEL OWNER. The CRM user detail already renders a full
// address to a holder of `view_identity_full_email`, but it does so as a FIELD
// PROJECTION on a different resource keyed by a different identifier, with no
// audit event of its own. It is not an audited sensitive-read owner, so there
// was nothing to reuse; this route does not duplicate it, and it deliberately
// does not become a second way to read a CRM user.
//
// WHAT IS STRUCTURALLY IMPOSSIBLE HERE. There is no id array, no wildcard, no
// filter, no page size, no export format and no persistent reveal token. One
// path segment names one lead. A caller who wants a thousand identities must
// perform a thousand audited reveals, each attributable — which is the point.

type RouteContext = { params: Promise<{ leadId: string }> };

/** A hard bound applied before parsing, so an oversized body is never materialised. */
const MAX_BODY_BYTES = 2;

export async function POST(request: Request, context: RouteContext) {
  const { requestId, headers } = beginLeadRequest();

  try {
    // ORDER: session (401) → StaffProfile (403) → affiliate read (403) → PII
    // (403) → CSRF → lookup. The lead is not read until every gate has passed,
    // so a denial cannot be timed or diffed to learn whether it exists.
    const session = await requireAffiliateReader();

    if (!canRevealLeadPii(session.effectivePermissions)) {
      // The SAME refusal for a lead that exists and one that does not, because
      // nothing has been looked up yet. An analyst probing lead references
      // learns only that they may not reveal.
      throw new AffiliateForbiddenError("crm.leads.pii_forbidden");
    }

    await requireAffiliateCsrf(request);

    // The body carries nothing. Refusing anything but an empty one keeps the
    // "single lead, named in the path" contract from acquiring a second,
    // batchable input later by accident.
    const raw = await request.text().catch(() => "");
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES || raw.trim().replace(/^\{\}$/, "") !== "") {
      throw new AffiliateInputError("crm.leads.reveal_body_not_allowed");
    }

    const eventId = requireLeadEventId((await context.params).leadId);
    const facts = await loadLeadByEventId(prisma, eventId);
    if (facts === null) leadNotFound();

    const leadId = toLeadId(facts.eventId);

    // ONE bounded audit row per successful reveal, written BEFORE the response
    // so a reveal that was served is a reveal that was recorded.
    //
    // The metadata names the OPAQUE lead reference and nothing else. No email,
    // no display name, no User id, no Pocket identifier, no click id, no
    // response body. An audit trail that quoted the identity it was protecting
    // would simply relocate the disclosure into a table more people can read.
    // `session.employeeId` is the StaffProfile cuid, NOT a User id — the two
    // axes are deliberately separate — so the actor's User id is read back from
    // the signed session rather than derived from the employee id.
    const actorUserId = await resolveAffiliateActorUserId();

    // STRICT, not the best-effort `createAuditLog` every other route uses. A
    // reveal that was served must be a reveal that was recorded — so a
    // persistence failure here has to abort the reveal, not be logged and
    // ignored. The rejection propagates out of this try block to the catch
    // below, which returns the same safe, PII-free envelope as any other
    // failure: there is no code path from here that still returns `identity`
    // once this call has thrown.
    await createAuditLogStrict({
      userId: actorUserId,
      action: "AFFILIATE_LEAD_PII_REVEALED",
      entityType: "AFFILIATE_LEAD",
      entityId: leadId,
      metadata: {
        leadId,
        employeeId: session.employeeId,
        surface: "crm_affiliate_lead_drilldown",
      },
      request,
    });

    return NextResponse.json(
      {
        // The closed field list from `lead-identity.ts`. No phone, no address,
        // no IP, no User-Agent, no session data, no password metadata, no
        // Pocket identifier, no click id, no callback data and no balance.
        identity: revealedIdentity(leadId, facts.email, facts.displayName),
        revealedAt: new Date().toISOString(),
      },
      { headers },
    );
  } catch (error) {
    return leadErrorResponse(error, requestId, headers);
  }
}
