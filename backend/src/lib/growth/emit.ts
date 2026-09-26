/**
 * G4-GROWTH — the only writer of the canonical growth ledger.
 *
 * THE ONE RULE THIS MODULE ENFORCES. A GrowthEvent may only be written for a
 * fact that is ALREADY TRUE in an owner row, and the caller must say which row.
 * That is why `sourceEntityId` is required and not optional: an event with no
 * traceable origin would be a claim this ledger invented, and the whole design
 * rests on it never doing that.
 *
 * APPEND-ONLY IS ENFORCED BY OMISSION. There is no update function here, no
 * delete function, and no upsert. The only escape from "insert or collide" is
 * the duplicate branch, which returns the existing row untouched.
 *
 * THE OUTBOX IS WRITTEN IN THE SAME TRANSACTION AS THE EVENT. If the two could
 * commit separately, a conversion could exist that no consumer will ever hear
 * about, or a consumer could be told about a conversion that rolled back. Both
 * are silent, and both are unrecoverable without a reconciliation job nobody has
 * written. One transaction makes them one fact.
 *
 * EMISSION NEVER FAILS ITS CALLER. `emitGrowthEventSafely` swallows its own
 * failures, because a growth event is a MEASUREMENT: a registration, a level
 * completion or a deposit must not be rolled back because the thing that
 * counts it had a bad day. The strict `emitGrowthEvent` is used where the caller
 * genuinely wants the transaction to fail with it — today, nowhere, and it is
 * exported so a future CPA-bearing consumer can make that choice explicitly
 * rather than by accident.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { randomBase32Id } from "@/lib/affiliate/random-id";
import {
  GROWTH_SOURCE_ENTITY_TYPES,
  GROWTH_SOURCE_OWNER_BY_TYPE,
  type GrowthEventType,
} from "@/lib/growth/event-keys";

/**
 * The bounded metadata vocabulary.
 *
 * AN ALLOWLIST, NOT A VALIDATOR. Anything not named here is dropped before the
 * write rather than rejected, so a caller that learns a new fact cannot quietly
 * turn this column into an unbounded sink for request data. There is
 * deliberately no key for an email, a name, an IP address, a user agent, a raw
 * payload or a query string.
 */
const ALLOWED_METADATA_KEYS = [
  "attemptNumber",
  "passed",
  "classification",
  "completionMethod",
  "levelStableCode",
  "moduleId",
  "reviewDecision",
  "ingressGoal",
  // POCKET-DEP-RDEP-1. Which clock `occurredAt` came from, for events whose
  // provider does not always supply an absolute instant. Added to the CLOSED
  // vocabulary deliberately: without it a surface could present ATA's receipt
  // time as the provider's event time, and nothing in the row would contradict
  // it. Carries no learner data — it names a clock, not a person.
  "occurredAtAuthority",
] as const;

const MAX_METADATA_STRING_LENGTH = 128;

export type GrowthEventMetadata = Partial<
  Record<(typeof ALLOWED_METADATA_KEYS)[number], string | number | boolean>
>;

/**
 * Keep only allowlisted keys, and bound what survives.
 *
 * Strings are truncated rather than rejected: metadata is decoration on an event
 * whose business meaning lives in typed columns, and losing an event because a
 * level code was long would be a bad trade.
 */
export function sanitizeMetadata(
  metadata: GrowthEventMetadata | undefined,
): Prisma.InputJsonValue | undefined {
  if (!metadata) return undefined;

  const out: Record<string, string | number | boolean> = {};

  for (const key of ALLOWED_METADATA_KEYS) {
    const value = metadata[key];
    if (value === undefined || value === null) continue;

    if (typeof value === "string") {
      if (value.length === 0) continue;
      out[key] = value.slice(0, MAX_METADATA_STRING_LENGTH);
    } else if (typeof value === "number") {
      if (!Number.isFinite(value)) continue;
      out[key] = value;
    } else {
      out[key] = value;
    }
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

export type GrowthEventInput = {
  readonly eventType: GrowthEventType;
  /** When the fact happened, from the owner row's own occurrence column. */
  readonly occurredAt: Date;
  /** The owner's idempotency key — build it with `event-keys.ts`, never inline. */
  readonly sourceEventId: string;
  /** The owner ROW this event was derived from. */
  readonly sourceEntityId: number | string;

  readonly userId?: number | null;
  readonly enrollmentId?: number | null;
  readonly acquisitionClickId?: number | null;
  readonly attributionId?: number | null;
  readonly pocketTraderIdentityId?: number | null;
  readonly providerIngressEventId?: number | null;
  readonly provider?: "pocket" | null;
  readonly levelDefinitionId?: number | null;
  readonly levelNumber?: number | null;

  /** Canonical decimal TEXT, already normalised by the owner. Never a number. */
  readonly amount?: string | null;
  readonly currencyCode?: string | null;
  readonly currencyStatus?: "unspecified" | "configured" | null;

  readonly metadata?: GrowthEventMetadata;
};

export type GrowthEmitResult =
  | { readonly outcome: "created"; readonly growthEventId: number; readonly eventId: string }
  | { readonly outcome: "duplicate"; readonly growthEventId: number; readonly eventId: string }
  | { readonly outcome: "failed"; readonly reason: string };

type GrowthWriter = Pick<Prisma.TransactionClient, "growthEvent" | "growthEventOutbox">;

/** Is this the "an event for that owner key already exists" collision? */
function isDuplicateKey(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown };
  return candidate.code === "P2002";
}

/**
 * Write one growth event and its outbox item.
 *
 * Throws on a genuine failure. A DUPLICATE IS NOT A FAILURE: it returns the
 * existing row, because "this already happened" is the correct answer to a
 * replayed emitter and forcing every call site to catch it would guarantee that
 * one of them eventually does not.
 */
export async function emitGrowthEvent(
  tx: GrowthWriter,
  input: GrowthEventInput,
): Promise<GrowthEmitResult> {
  const sourceOwner = GROWTH_SOURCE_OWNER_BY_TYPE[input.eventType];
  const sourceEntityType = GROWTH_SOURCE_ENTITY_TYPES[input.eventType];
  const eventId = randomBase32Id();

  try {
    const created = await tx.growthEvent.create({
      data: {
        eventId,
        eventType: input.eventType,
        occurredAt: input.occurredAt,
        origin: "runtime",
        schemaVersion: 1,
        userId: input.userId ?? null,
        enrollmentId: input.enrollmentId ?? null,
        acquisitionClickId: input.acquisitionClickId ?? null,
        attributionId: input.attributionId ?? null,
        pocketTraderIdentityId: input.pocketTraderIdentityId ?? null,
        providerIngressEventId: input.providerIngressEventId ?? null,
        provider: input.provider ?? null,
        levelDefinitionId: input.levelDefinitionId ?? null,
        levelNumber: input.levelNumber ?? null,
        amount: input.amount ?? null,
        currencyCode: input.currencyCode ?? null,
        currencyStatus: input.currencyStatus ?? null,
        sourceOwner,
        sourceEntityType,
        sourceEntityId: String(input.sourceEntityId),
        sourceEventId: input.sourceEventId,
        metadata: sanitizeMetadata(input.metadata),
      },
      select: { id: true, eventId: true },
    });

    // Same transaction, deliberately. See the module header.
    await tx.growthEventOutbox.create({
      data: {
        growthEventId: created.id,
        eventType: input.eventType,
        availableAt: new Date(),
      },
      select: { id: true },
    });

    return { outcome: "created", growthEventId: created.id, eventId: created.eventId };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;

    // The collision proves a row exists. Reading it back rather than returning a
    // bare "duplicate" lets a caller link its ingress evidence to the canonical
    // event even when it lost the race to create it.
    const existing = await tx.growthEvent.findUnique({
      where: {
        eventType_sourceOwner_sourceEventId: {
          eventType: input.eventType,
          sourceOwner,
          sourceEventId: input.sourceEventId,
        },
      },
      select: { id: true, eventId: true },
    });

    if (!existing) throw error;

    return { outcome: "duplicate", growthEventId: existing.id, eventId: existing.eventId };
  }
}

/**
 * Emit, and never let the attempt harm the caller.
 *
 * Use this from every product path — registration, level completion, report
 * approval. A measurement that can refuse a customer is a defect, and the same
 * reasoning the accepted attribution owner applies to registration applies here
 * to every event family.
 *
 * The failure is returned rather than thrown so a caller that wants to audit it
 * can, and so a caller that does not is not silently misled into believing an
 * event was written.
 */
export async function emitGrowthEventSafely(
  tx: GrowthWriter,
  input: GrowthEventInput,
): Promise<GrowthEmitResult> {
  try {
    return await emitGrowthEvent(tx, input);
  } catch (error) {
    // A bounded reason only. A Prisma error message can name a column and a
    // value, and this string reaches an audit row.
    const reason =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "unknown_error";
    return { outcome: "failed", reason };
  }
}

/**
 * Emit outside any caller-supplied transaction, opening one of our own.
 *
 * For emitters that run AFTER their owner has committed — a Pocket deposit
 * reconciled long after the deposit arrived, for instance — where joining the
 * owner's transaction is impossible because it is already closed.
 */
export async function emitGrowthEventDetached(
  db: PrismaClient,
  input: GrowthEventInput,
): Promise<GrowthEmitResult> {
  try {
    return await db.$transaction((tx) => emitGrowthEvent(tx, input));
  } catch (error) {
    const reason =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "unknown_error";
    return { outcome: "failed", reason };
  }
}
