/**
 * G4-GROWTH — durable provider ingress evidence, written for every delivery.
 *
 * WHY EVIDENCE IS SEPARATE FROM THE CANONICAL LEDGER. A GrowthEvent asserts that
 * a business fact is true. A row here asserts only that a request arrived and
 * what it carried. Most operational questions — did Pocket ever send this, why
 * was it refused, is the integration healthy right now — are questions about
 * deliveries. Answering them from the canonical ledger would mean writing rows
 * into it that are not facts, and a ledger containing non-facts is not one.
 *
 * EVIDENCE IS RECORDED FOR REFUSALS TOO, AND THAT IS THE POINT. A rejected
 * delivery that leaves no trace is indistinguishable from a delivery that never
 * happened. The ingress-health surface exists to tell those apart before anybody
 * turns a provider capability on.
 *
 * EVIDENCE IS NEVER RECORDED BEFORE AUTHENTICATION. Every caller in this module
 * runs past the route's authenticated boundary. An unauthenticated request must
 * not be able to write a row at all, or the table becomes a free, unbounded
 * write primitive for anyone who can reach the URL.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  captureProviderFields,
  hashSanitizedPayload,
  parseProviderEventTime,
  readProviderEventTimeRaw,
  sanitizeProviderQuery,
} from "@/lib/growth/pocket/ingress-payload";
import type { GrowthV1Goal } from "@/lib/growth/pocket/goal-allowlist";

export type IngressProcessingStatus =
  | "accepted_processed"
  | "accepted_duplicate"
  | "accepted_pending_linkage"
  | "identity_unresolved"
  | "rejected"
  | "quarantined";

export type IngressRejectionCode =
  | "auth_failed"
  | "goal_unknown"
  | "goal_disabled"
  | "schema_invalid"
  | "amount_invalid"
  | "click_unknown"
  | "player_conflict"
  | "identity_owner_mismatch"
  | "provider_event_identity_missing"
  | "ordering_unresolved";

export type RecordIngressInput = {
  readonly goal: GrowthV1Goal;
  readonly params: URLSearchParams;
  readonly receivedAt: Date;
  readonly processingStatus: IngressProcessingStatus;
  readonly rejectionCode?: IngressRejectionCode | null;
  readonly playerIdNormalized?: string | null;
  readonly clickId?: string | null;
  /** Canonical decimal TEXT only. Never a number, never a raw provider string. */
  readonly amount?: string | null;
  readonly providerEventIdentity?: string | null;
  readonly canonicalEventId?: number | null;
};

type IngressWriter = Pick<Prisma.TransactionClient, "providerIngressEvent">;

/**
 * Write one ingress evidence row.
 *
 * The sanitizer runs here rather than at the call sites so that no caller can
 * forget it — the raw `URLSearchParams` goes in, and only a redacted, bounded
 * structure reaches the database.
 */
export async function recordProviderIngress(
  db: IngressWriter,
  input: RecordIngressInput,
): Promise<{ id: number; rawPayloadHash: string }> {
  const sanitized = sanitizeProviderQuery(input.params);
  const rawPayloadHash = hashSanitizedPayload(sanitized);
  const captured = captureProviderFields(sanitized);
  const eventTime = parseProviderEventTime(readProviderEventTimeRaw(input.params));

  const created = await db.providerIngressEvent.create({
    data: {
      provider: "pocket",
      goal: input.goal,
      receivedAt: input.receivedAt,
      providerEventAt: eventTime.status === "parsed" ? eventTime.at : null,
      providerEventAtRaw: eventTime.status === "unparseable" ? eventTime.raw : null,
      providerEventAtStatus: eventTime.status,
      playerIdNormalized: input.playerIdNormalized ?? null,
      clickId: input.clickId ?? null,
      amount: input.amount ?? null,
      campaignId: captured.campaignId,
      campaignName: captured.campaignName,
      sub1: captured.sub1,
      sub2: captured.sub2,
      sub3: captured.sub3,
      sub4: captured.sub4,
      sub5: captured.sub5,
      country: captured.country,
      deviceType: captured.deviceType,
      sanitizedPayload: sanitized,
      rawPayloadHash,
      providerEventIdentity: input.providerEventIdentity ?? null,
      processingStatus: input.processingStatus,
      rejectionCode: input.rejectionCode ?? null,
      canonicalEventId: input.canonicalEventId ?? null,
      schemaVersion: 1,
    },
    select: { id: true },
  });

  return { id: created.id, rawPayloadHash };
}

/**
 * Record evidence without ever failing the caller.
 *
 * Evidence is a measurement. A deposit that was correctly accepted must not be
 * refused because the row describing its arrival could not be written — that
 * would trade a real event for a record of it.
 */
export async function recordProviderIngressSafely(
  db: PrismaClient,
  input: RecordIngressInput,
): Promise<{ id: number } | null> {
  try {
    return await recordProviderIngress(db, input);
  } catch {
    return null;
  }
}

/**
 * How many byte-identical deliveries of this payload already exist.
 *
 * ONLY EVER USED TO DESCRIBE TRANSPORT. A caller may use this to report "we have
 * seen these exact bytes before"; it must NOT use it to decide whether a deposit
 * already happened. Two legitimate redeposits with the same player, amount and
 * second are byte-identical, so a positive answer here does not mean a replay.
 * The redeposit handler deliberately does not branch on it.
 */
export async function countIdenticalDeliveries(
  db: Pick<PrismaClient, "providerIngressEvent">,
  rawPayloadHash: string,
): Promise<number> {
  return db.providerIngressEvent.count({ where: { rawPayloadHash } });
}
