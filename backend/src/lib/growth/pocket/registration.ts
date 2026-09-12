/**
 * G4-GROWTH — the canonical `pocket_reg` event for a bound Pocket identity.
 *
 * WHY THIS IS NOT INSIDE THE IDENTITY BINDER. `bindPocketTraderIdentity` is an
 * accepted component with a proven single caller and its own regression suite
 * asserting that. It uses `create` and never `upsert`, and its narrow database
 * type is part of what makes that provable. Reaching into it to also write a
 * ledger row would widen a component whose narrowness is the guarantee.
 *
 * SO THE EMISSION IS SEPARATE, AND IDEMPOTENT BY THE SAME KEY THE PROVIDER USES.
 * The key is the Pocket PLAYER. Calling this twice, a hundred times, or once per
 * retry produces exactly one event, because the second attempt collides with
 * `UNIQUE(eventType, sourceOwner, sourceEventId)` and returns the existing row.
 * That is what makes calling it after the binding — rather than inside its
 * transaction — safe: if the process dies between the two, Pocket's retry
 * reconciles, and so does the operator reconciliation command.
 *
 * WHAT IT DOES NOT DO. It does not bind, rebind or validate an identity, it does
 * not complete a level, it does not award XP and it does not touch money. It
 * reads a binding that already exists and records that it exists.
 */
import type { PrismaClient } from "@prisma/client";
import { emitGrowthEventDetached, type GrowthEmitResult } from "@/lib/growth/emit";
import { pocketPlayerSourceEventId } from "@/lib/growth/event-keys";

export type PocketRegGrowthResult =
  | { readonly kind: "emitted"; readonly growthEventId: number }
  | { readonly kind: "duplicate"; readonly growthEventId: number }
  /** No binding exists for that player — nothing to record, and nothing invented. */
  | { readonly kind: "no_identity" }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * Record the `pocket_reg` growth event for one Pocket player.
 *
 * `occurredAt` is the binding's OWN `boundAt`, never `now()`. A retry three days
 * later must not move the registration into a later reporting period — that is
 * how a month's numbers change after the month has closed.
 */
export async function recordPocketRegistrationGrowthEvent(
  db: PrismaClient,
  pocketUserId: string,
  ingressEventId?: number | null,
): Promise<PocketRegGrowthResult> {
  const identity = await db.pocketTraderIdentity.findUnique({
    where: { pocketUserId },
    select: { id: true, userId: true, boundAt: true },
  });

  if (identity === null) return { kind: "no_identity" };

  // The frozen acquisition answer for this learner, reused exactly as it stands.
  // No click is selected here: attribution was decided at registration and a
  // Pocket event is not allowed to revisit it.
  const attribution = await db.affiliateAttribution.findUnique({
    where: { userId: identity.userId },
    select: { id: true, selectedClickId: true },
  });

  const enrollment = await db.userCurriculumEnrollment.findFirst({
    where: { userId: identity.userId },
    orderBy: { enrolledAt: "asc" },
    select: { id: true },
  });

  const result: GrowthEmitResult = await emitGrowthEventDetached(db, {
    eventType: "pocket_reg",
    occurredAt: identity.boundAt,
    sourceEventId: pocketPlayerSourceEventId(pocketUserId),
    sourceEntityId: identity.id,
    userId: identity.userId,
    enrollmentId: enrollment?.id ?? null,
    pocketTraderIdentityId: identity.id,
    attributionId: attribution?.id ?? null,
    acquisitionClickId: attribution?.selectedClickId ?? null,
    providerIngressEventId: ingressEventId ?? null,
    provider: "pocket",
    metadata: { ingressGoal: "reg" },
  });

  if (result.outcome === "failed") return { kind: "failed", reason: result.reason };

  return result.outcome === "created"
    ? { kind: "emitted", growthEventId: result.growthEventId }
    : { kind: "duplicate", growthEventId: result.growthEventId };
}
