import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolvePeriod } from "@/lib/analytics/periods";
import {
  analyticsErrorResponse,
  beginAnalyticsRequest,
  openAnalyticsRequest,
  serializePeriod,
} from "@/lib/analytics/routes";
import { assertKnownAnalyticsKeys, parsePeriodInput } from "@/lib/analytics/request";
import { loadIngressHealth } from "@/lib/growth/analytics/queries";
import { readPocketIngressSwitches } from "@/lib/growth/ingress-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const KEYS = ["preset", "startDate", "endDate"] as const;

/**
 * GET /api/crm/v1/growth/ingress-health
 *
 * What the provider integration is actually doing, before anybody turns it on.
 *
 * WHY THIS SURFACE MATTERS MOST RIGHT NOW. Every Pocket switch is off. The first
 * thing an operator will need at cutover is not a conversion chart — it is the
 * answer to "are deliveries arriving, are they authenticating, and what is being
 * refused". This is that answer, and it exists before the capability it monitors.
 *
 * COUNTS ONLY. No sanitized payload, no click id, no player id, no hash and no
 * amount leaves this route. An operator needs to know how many deliveries were
 * refused and why — not what was in them. A surface that returned payloads would
 * be a way to read provider traffic, including a learner's Pocket identifiers,
 * through the CRM.
 *
 * THE SWITCH STATE IS REPORTED AS BOOLEANS. Never the secret, never whether a
 * secret is configured, never its length. `masterEnabled` is already observable
 * from the outside — the postback route answers 503 when it is off — so
 * reporting it to an authenticated staff member discloses nothing new.
 */
export async function GET(request: Request) {
  const { requestId, headers } = beginAnalyticsRequest();

  try {
    const { params, timezone, now } = await openAnalyticsRequest(request);
    assertKnownAnalyticsKeys(params, KEYS);

    const period = resolvePeriod(parsePeriodInput(params), timezone, now);
    const window = { start: period.startUtc ?? new Date(0), end: period.endUtc };

    const [health, switches] = await Promise.all([
      loadIngressHealth(prisma, window),
      Promise.resolve(readPocketIngressSwitches()),
    ]);

    const status = health.byStatus;
    const rejection = health.byRejectionCode;

    return NextResponse.json(
      {
        period: serializePeriod(period),
        // Booleans only. See the header.
        switches: {
          masterEnabled: switches.masterEnabled,
          regIngestEnabled: switches.regEnabled,
          depIngestEnabled: switches.depEnabled,
          rdepIngestEnabled: switches.rdepEnabled,
          // RDEP-AVAIL-1. This was `redepositIdentityContract`, reporting
          // whether an operator had named a PROVIDER-issued event-id parameter.
          // ATA derives its own deterministic identity, so that contract is not
          // something an operator can be missing, and reporting it as absent
          // sent them looking for a switch that no longer exists. This reports
          // the capability that actually gates counting, with a truthful reason
          // whenever it is off.
          redepositCapability: switches.redepositCapability.kind,
          redepositCapabilityReason:
            switches.redepositCapability.kind === "unavailable"
              ? switches.redepositCapability.reason
              : null,
        },
        deliveries: {
          total: health.total,
          byGoal: health.byGoal,
          byStatus: health.byStatus,
          byRejectionCode: health.byRejectionCode,
        },
        // The operational headline, named so an operator does not have to know
        // the internal status vocabulary to read the important numbers.
        summary: {
          accepted: (status.accepted_processed ?? 0),
          duplicates: (status.accepted_duplicate ?? 0),
          pendingLinkage: (status.accepted_pending_linkage ?? 0),
          identityUnresolved: (status.identity_unresolved ?? 0),
          rejected: (status.rejected ?? 0),
          quarantined: (status.quarantined ?? 0),
          authRejected: (rejection.auth_failed ?? 0),
          schemaRejected: (rejection.schema_invalid ?? 0),
          unknownGoal: (rejection.goal_unknown ?? 0),
          disabledGoal: (rejection.goal_disabled ?? 0),
          unlinkedClick: (rejection.click_unknown ?? 0),
          playerConflict: (rejection.player_conflict ?? 0),
          orderingUnresolved: (rejection.ordering_unresolved ?? 0),
        },
        notes: {
          // RDEP-AVAIL-1. This note used to read: "Redeposit deliveries received
          // and validated, deliberately not counted as money because Pocket
          // supplies no unique event identifier." That is operator-facing text
          // stating a superseded premise — ATA now derives its own deterministic
          // redeposit identity, so Pocket supplying no identifier is not the
          // reason anything goes uncounted. Leaving it would have told an
          // operator the platform was refusing to count redeposits at the moment
          // it began counting them.
          identityUnresolved:
            "Redeposit deliveries whose canonical identity could not be derived — " +
            "typically a missing or malformed provider event time. Deliveries are " +
            "kept as evidence and are deliberately not counted as money.",
          authRejected:
            "Authentication failures are refused BEFORE any ingress row is written, " +
            "so this counter reflects only failures recorded past that boundary. " +
            "The AuditLog is the authority for authentication refusals.",
        },
        generatedAt: now.toISOString(),
      },
      { headers },
    );
  } catch (error) {
    return analyticsErrorResponse(error, requestId, headers);
  }
}
