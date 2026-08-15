/**
 * AFD-4 — the canonical owner of Pocket first-deposit events.
 *
 * THE ONE-SENTENCE CONTRACT. A trusted Pocket `goal=dep` callback records at
 * most one canonical first-deposit event per Pocket player, counts it as a
 * conversion only once the player's identity has been legally bound by a
 * trusted `goal=reg`, and quarantines anything that disagrees instead of
 * overwriting what was already recorded.
 *
 * WHAT THIS OWNER MAY NOT DO, EVER. It does not bind a Pocket identity, does not
 * complete a level, does not unlock a level, does not award XP and does not
 * touch a balance. `goal=reg` is the sole identity-binding owner and the sole
 * Level 1 completion owner (L1OWNER-1), and `PocketTraderIdentity.source` is
 * constrained at the database level to `registration_postback` precisely so that
 * a deposit cannot become an identity. This module reads that table and never
 * writes it.
 *
 * WHY THE KEY IS THE PLAYER. Pocket's callback carries no transaction id, no
 * event id and no occurrence time, so ATA genuinely cannot distinguish a replay
 * from a correction from a second deposit. Rather than guess, this phase owns
 * exactly the one event it CAN identify — the first deposit for a player — and
 * refuses to invent the rest. See `19_REDEPOSIT_BOUNDARY.md`.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { randomBase32Id } from "@/lib/affiliate/random-id";
import { qualifyFirstDepositSafely } from "@/lib/affiliate/cpa/qualification";
import { enqueueConversionPostbackSafely } from "@/lib/affiliate/postback/enqueue";
import { emitGrowthEvent } from "@/lib/growth/emit";
import { pocketPlayerSourceEventId } from "@/lib/growth/event-keys";
import {
  resolvePocketFirstDepositConfig,
  type PocketDepositCurrency,
} from "@/lib/exchange/pocketFirstDepositConfig";

/** The single owner name this phase writes into the conversion ledger. */
export const FIRST_DEPOSIT_SOURCE_OWNER = "pocket_first_deposit" as const;

/**
 * A ceiling on the replay counter.
 *
 * Redeliveries are transport noise, and an upstream stuck in a retry loop must
 * not be able to drive an unbounded integer. Once the ceiling is reached the
 * fact being recorded — "this has been redelivered many times" — is already
 * fully expressed, so the counter simply stops.
 */
export const MAX_REPLAY_COUNT = 10_000;

/**
 * The idempotency key for a first-deposit conversion.
 *
 * DERIVED FROM THE PROVIDER EVENT ROW ID. Not from the Pocket player id, not
 * from the click id, not from the amount and not from a received timestamp. The
 * row id is issued by ATA's own database, is never reused, and makes "one
 * first_deposit per canonical provider event" mean exactly that — while keeping
 * every Pocket identifier out of the ledger's key, exactly as
 * `pocket-registration:<identity.id>` does for Level 1 completion evidence.
 */
export function firstDepositSourceEventId(providerEventId: number): string {
  return `pocket-first-deposit:${providerEventId}`;
}

export type FirstDepositOutcome =
  /** A brand-new event whose identity already agreed. Conversion emitted. */
  | "matched"
  /** A brand-new event waiting for a trusted `goal=reg`. No conversion. */
  | "pending_identity"
  /** A pending event whose identity has now converged. Conversion emitted. */
  | "reconciled"
  /** An identical redelivery. Nothing canonical changed. */
  | "replayed"
  /** Still waiting for the registration that would name an owner. */
  | "unchanged_pending"
  /** Quarantined. Nothing canonical changed and no conversion was emitted. */
  | "conflict"
  /** The click id resolves to no learner. Deliberately leaves no row behind. */
  | "unknown_click";

export type FirstDepositResult = {
  readonly outcome: FirstDepositOutcome;
  /** Present for every outcome that has a canonical row. */
  readonly providerEventId?: number;
  readonly conflictCode?: PocketConflictCode;
  /**
   * AFFILIATE-PLATFORM-V1. The conversion row a NEWLY RECORDED first deposit
   * produced, and the only input the CPA qualifier takes.
   *
   * ABSENT ON A REPLAY, deliberately. A replayed delivery creates no conversion,
   * so there is nothing new to qualify — and the qualifier is idempotent
   * anyway, so this is a second guard rather than the only one.
   */
  readonly conversionEventId?: number;
  /**
   * What the CPA owner decided, when it was consulted. Recorded so that "this
   * deposit produced no commission" is always answerable with a reason.
   */
  readonly cpaOutcome?: string;
};

export type PocketConflictCode =
  | "click_id_mismatch"
  | "amount_mismatch"
  | "identity_owner_mismatch"
  | "click_owner_missing";

export type FirstDepositInput = {
  readonly pocketClickId: string;
  readonly pocketPlayerId: string;
  readonly normalizedAmount: string;
  readonly currency: PocketDepositCurrency;
  readonly now: Date;
};

/**
 * Is this failure the "another delivery created the canonical event first"
 * collision?
 *
 * Matched on the constraint target rather than the code alone, because the same
 * transaction also writes the conversion event's `eventId` and its source key,
 * and only the provider-event collision means "re-read and treat as a replay".
 */
function isProviderEventCollision(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; meta?: unknown };
  if (candidate.code !== "P2002") return false;
  const target = JSON.stringify(candidate.meta ?? {});
  return target.includes("pocketPlayerId") || target.includes("PocketProviderEvent");
}

type Db = PrismaClient;

/**
 * Ingest one authenticated, well-formed `goal=dep` delivery.
 *
 * THE CLICK IS RESOLVED FIRST, AND AN UNKNOWN ONE LEAVES NOTHING BEHIND. A
 * callback naming a click id ATA never issued must not create a provider event,
 * because that row would occupy the `(provider, first_deposit, player)` key and
 * permanently block the legitimate deposit for that same player from ever being
 * recorded. Refusing to write is what keeps a bad delivery from becoming a
 * denial of service against a real learner.
 */
export async function ingestPocketFirstDeposit(
  db: Db,
  input: FirstDepositInput,
): Promise<FirstDepositResult> {
  const account = await db.exchangeAccount.findFirst({
    where: { clickId: input.pocketClickId },
    select: { userId: true },
  });

  if (!account) return { outcome: "unknown_click" };

  // Bounded retry. The only recoverable failure is losing the create race to a
  // concurrent identical delivery, and the second pass takes the "already
  // exists" branch deterministically. The P2002 is caught OUTSIDE the
  // transaction on purpose: swallowing it inside would leave the transaction
  // aborted on SQLite while this code believed it had recovered.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const settled = await db.$transaction((tx) => applyDelivery(tx, input, account.userId));
      // AFFILIATE-PLATFORM-V1 — the CPA question, asked only once the deposit
      // itself is durable. See `qualifyDepositAfterCommit`.
      return await qualifyDepositAfterCommit(settled, db, input.now);
    } catch (error) {
      if (attempt === 0 && isProviderEventCollision(error)) continue;
      throw error;
    }
  }

  // Unreachable: the loop either returns or rethrows.
  throw new Error("pocket first deposit ingestion did not settle");
}

/**
 * The whole decision, inside one transaction.
 *
 * Reading the existing row and writing the outcome must be atomic, or two
 * concurrent deliveries could both read "no canonical event" and both proceed.
 */
async function applyDelivery(
  tx: Prisma.TransactionClient,
  input: FirstDepositInput,
  clickUserId: number,
): Promise<FirstDepositResult> {
  // POCKET-DEP-RDEP-1. Migration 49 replaced the compound unique index with a
  // PARTIAL one — UNIQUE(provider, pocketPlayerId) WHERE eventType =
  // 'first_deposit' — so that one player may hold many redeposits while still
  // holding exactly one first deposit. Prisma cannot express a partial index, so
  // this is a findFirst on the same three columns. The DATABASE still enforces
  // uniqueness; only the client-side lookup shape changed.
  const existing = await tx.pocketProviderEvent.findFirst({
    where: {
      provider: "pocket",
      eventType: "first_deposit",
      pocketPlayerId: input.pocketPlayerId,
    },
  });

  if (existing) {
    // The click owner is deliberately NOT consulted here. A redelivery is
    // judged against the CANONICAL click id already stored, not against
    // whichever learner this delivery's click resolves to — that is what makes
    // a changed click id a conflict rather than a reattribution.
    return redeliver(tx, existing, input);
  }

  // A brand-new canonical event. Its status is decided by whether the Pocket
  // identity has already been bound, and by whether it agrees with the click.
  const identity = await tx.pocketTraderIdentity.findUnique({
    where: { pocketUserId: input.pocketPlayerId },
    select: { userId: true },
  });

  const canonical = {
    provider: "pocket",
    eventType: "first_deposit",
    pocketClickId: input.pocketClickId,
    pocketPlayerId: input.pocketPlayerId,
    normalizedAmount: input.normalizedAmount,
    currencyCode: input.currency.code,
    currencyStatus: input.currency.status,
    firstReceivedAt: input.now,
    lastReceivedAt: input.now,
  } as const;

  // The click says one learner, the bound identity says another. Neither is
  // corrected here: the identity binding is owned by `goal=reg` and stays
  // exactly as it is, and the deposit is quarantined for an operator.
  if (identity && identity.userId !== clickUserId) {
    const created = await tx.pocketProviderEvent.create({
      data: {
        ...canonical,
        status: "conflict",
        conflictCode: "identity_owner_mismatch",
        conflictDetectedAt: input.now,
      },
      select: { id: true },
    });
    return {
      outcome: "conflict",
      providerEventId: created.id,
      conflictCode: "identity_owner_mismatch",
    };
  }

  if (!identity) {
    const created = await tx.pocketProviderEvent.create({
      data: { ...canonical, status: "pending_identity" },
      select: { id: true },
    });
    return { outcome: "pending_identity", providerEventId: created.id };
  }

  const created = await tx.pocketProviderEvent.create({
    data: {
      ...canonical,
      status: "matched",
      matchedUserId: clickUserId,
      matchedAt: input.now,
    },
    select: { id: true },
  });

  const conversion = await emitFirstDepositConversion(tx, {
    providerEventId: created.id,
    pocketPlayerId: input.pocketPlayerId,
    userId: clickUserId,
    normalizedAmount: input.normalizedAmount,
    currency: input.currency,
    occurredAt: input.now,
  });

  return {
    outcome: "matched",
    providerEventId: created.id,
    conversionEventId: conversion.conversionEventId,
  };
}

type ExistingEvent = {
  id: number;
  status: string;
  pocketClickId: string;
  normalizedAmount: string;
  replayCount: number;
  conflictCode: string | null;
};

/**
 * A second delivery naming a player that already has a canonical event.
 *
 * THE CANONICAL VALUES ARE NEVER WRITTEN OVER. Whatever this delivery claims,
 * `pocketClickId` and `normalizedAmount` keep the values the first accepted
 * delivery established. A disagreement is recorded beside them so an operator
 * can see it, and — because Pocket supplies no transaction id — it is never
 * interpreted as a second deposit.
 */
async function redeliver(
  tx: Prisma.TransactionClient,
  existing: ExistingEvent,
  input: FirstDepositInput,
): Promise<FirstDepositResult> {
  const divergence: PocketConflictCode | null =
    existing.pocketClickId !== input.pocketClickId
      ? "click_id_mismatch"
      : existing.normalizedAmount !== input.normalizedAmount
        ? "amount_mismatch"
        : null;

  if (divergence) {
    // The FIRST conflict wins. A row that is already quarantined keeps the
    // reason it was quarantined for, so an operator reads what actually went
    // wrong rather than whatever arrived most recently.
    const alreadyFlagged = existing.conflictCode !== null;

    await tx.pocketProviderEvent.update({
      where: { id: existing.id },
      data: {
        lastReceivedAt: input.now,
        // A matched event KEEPS its match: the deposit was legitimately counted
        // and its conversion is canonical and immutable. Only a still-pending
        // event is moved into quarantine, because it has nothing to preserve.
        ...(existing.status === "pending_identity" ? { status: "conflict" as const } : {}),
        ...(alreadyFlagged
          ? {}
          : { conflictCode: divergence, conflictDetectedAt: input.now }),
      },
    });

    return {
      outcome: "conflict",
      providerEventId: existing.id,
      conflictCode: (existing.conflictCode as PocketConflictCode | null) ?? divergence,
    };
  }

  // An identical redelivery. Bounded transport metadata only.
  await tx.pocketProviderEvent.update({
    where: { id: existing.id },
    data: {
      lastReceivedAt: input.now,
      ...(existing.replayCount < MAX_REPLAY_COUNT
        ? { replayCount: { increment: 1 } }
        : {}),
    },
  });

  // A redelivery is also a free chance to reconcile: the registration that was
  // missing when this deposit first arrived may have happened since. Making the
  // provider's own retry a recovery path is the same choice L1OWNER-1 made for
  // Level 1 completion, and it is idempotent.
  if (existing.status === "pending_identity") {
    const converged = await convergePendingEvent(tx, existing.id, input.currency, input.now);
    if (converged.outcome !== "unchanged_pending") return converged;
    return { outcome: "unchanged_pending", providerEventId: existing.id };
  }

  return { outcome: "replayed", providerEventId: existing.id };
}

/**
 * Try to move ONE pending event to matched.
 *
 * Re-reads every fact from durable state rather than trusting a caller's
 * context: the click is resolved again, the identity is resolved again, and the
 * two must agree on one learner before anything is counted. Idempotent by
 * construction — an event that is no longer pending is left exactly as it is.
 */
export async function convergePendingEvent(
  tx: Prisma.TransactionClient,
  providerEventId: number,
  currency: PocketDepositCurrency,
  now: Date,
): Promise<FirstDepositResult> {
  const event = await tx.pocketProviderEvent.findUnique({
    where: { id: providerEventId },
    select: {
      id: true,
      status: true,
      pocketClickId: true,
      pocketPlayerId: true,
      normalizedAmount: true,
      currencyCode: true,
      currencyStatus: true,
      // DEP-TIME-1. The deposit's OWN instant, which is the one the canonical
      // event must carry. It was not selected here at all, which is how the
      // reconciliation clock came to stand in for it.
      firstReceivedAt: true,
    },
  });

  if (!event || event.status !== "pending_identity") {
    return { outcome: "unchanged_pending", providerEventId };
  }

  const identity = await tx.pocketTraderIdentity.findUnique({
    where: { pocketUserId: event.pocketPlayerId },
    select: { userId: true },
  });

  // Still no trusted registration. This is the ordinary pending state, not an
  // error, and the event waits.
  if (!identity) return { outcome: "unchanged_pending", providerEventId };

  const account = await tx.exchangeAccount.findFirst({
    where: { clickId: event.pocketClickId },
    select: { userId: true },
  });

  // The click no longer names anybody. Quarantined rather than retried forever,
  // so it is visible to an operator instead of silently accumulating.
  if (!account) {
    await tx.pocketProviderEvent.update({
      where: { id: event.id },
      data: {
        status: "conflict",
        conflictCode: "click_owner_missing",
        conflictDetectedAt: now,
      },
    });
    return {
      outcome: "conflict",
      providerEventId: event.id,
      conflictCode: "click_owner_missing",
    };
  }

  // The registration bound this player to a DIFFERENT learner than the one the
  // deposit's click names. The identity owner is authoritative and is not
  // touched; the deposit is quarantined and counts for nobody.
  if (identity.userId !== account.userId) {
    await tx.pocketProviderEvent.update({
      where: { id: event.id },
      data: {
        status: "conflict",
        conflictCode: "identity_owner_mismatch",
        conflictDetectedAt: now,
      },
    });
    return {
      outcome: "conflict",
      providerEventId: event.id,
      conflictCode: "identity_owner_mismatch",
    };
  }

  await tx.pocketProviderEvent.update({
    where: { id: event.id },
    data: { status: "matched", matchedUserId: account.userId, matchedAt: now },
  });

  // The currency recorded on the ROW is the one captured when the deposit was
  // first received, not whatever is configured now. Re-reading configuration
  // here would let a currency change silently re-denominate an old deposit.
  //
  // DEP-TIME-1 — AND THE SAME SENTENCE APPLIES TO TIME.
  //
  // This used to pass `occurredAt: now`, the RECONCILIATION instant. On the
  // ordinary path — a deposit arriving after registration — `occurredAt` is
  // `input.now`, which is also the row's `firstReceivedAt`, so the canonical
  // event carries the moment the deposit was reported. On THIS path the deposit
  // arrived first and waited, sometimes for days, and the event was being
  // stamped with the moment the learner happened to register instead.
  //
  // That gave one event family two different meanings depending purely on
  // delivery ORDER, and it is money: `AffiliateConversionEvent.occurredAt` is
  // what a commission period is computed from, and a deposit reconciled after a
  // period boundary would be counted in the wrong period.
  //
  // `GROWTH_SOURCE_ENTITY_TYPES` declares `dep -> "PocketProviderEvent"`, so the
  // row owns the fact and the row's own `firstReceivedAt` is the instant. This
  // is the same correction `pocket_reg` has always had (`identity.boundAt`) and
  // that `ata_reg` received as LEDGER-1 (`created.createdAt`).
  //
  // `matchedAt` still records when the deposit became attributable — that is a
  // different fact and it keeps its own column.
  const conversion = await emitFirstDepositConversion(tx, {
    providerEventId: event.id,
    pocketPlayerId: event.pocketPlayerId,
    userId: account.userId,
    normalizedAmount: event.normalizedAmount,
    currency:
      event.currencyStatus === "configured" && event.currencyCode !== null
        ? { status: "configured", code: event.currencyCode }
        : { status: "unspecified", code: null },
    occurredAt: event.firstReceivedAt,
  });

  return {
    outcome: "reconciled",
    providerEventId: event.id,
    conversionEventId: conversion.conversionEventId,
  };
}

/**
 * Write the one conversion event for this deposit.
 *
 * ATTRIBUTION IS REUSED, NEVER PERFORMED. The learner's `AffiliateAttribution`
 * was frozen at registration and is read here exactly as it stands. No click is
 * selected at deposit time, no later click can win, and a learner who was
 * direct at registration stays direct forever — otherwise an affiliate could be
 * credited for a customer they did not bring, simply by being the most recent
 * touch before the money arrived.
 *
 * A DIRECT LEARNER STILL GETS A ROW, with every affiliate column null. A
 * deposit that produced no row would be indistinguishable from one the ledger
 * dropped.
 */
export async function emitFirstDepositConversion(
  tx: Prisma.TransactionClient,
  input: {
    providerEventId: number;
    /**
     * G4-GROWTH. The provider-side identity, which is the canonical growth
     * ledger's idempotency key for a first deposit. Required rather than
     * optional: a `dep` growth event keyed on anything else would not be
     * checkable against Pocket, and making it optional would let a call site
     * silently produce an unkeyed one.
     */
    pocketPlayerId: string;
    userId: number;
    normalizedAmount: string;
    currency: PocketDepositCurrency;
    occurredAt: Date;
  },
): Promise<{ conversionEventId: number }> {
  const attribution = await tx.affiliateAttribution.findUnique({
    where: { userId: input.userId },
    select: {
      id: true,
      selectedClickId: true,
      selectedClick: {
        select: {
          trackingLink: {
            select: {
              id: true,
              publicCode: true,
              affiliatePartnerId: true,
              affiliateCampaignId: true,
              partner: { select: { code: true } },
              campaign: { select: { code: true } },
            },
          },
        },
      },
    },
  });

  const link = attribution?.selectedClick.trackingLink ?? null;

  const conversion = await tx.affiliateConversionEvent.create({
    data: {
      eventId: randomBase32Id(),
      eventType: "first_deposit",
      userId: input.userId,
      attributionId: attribution?.id ?? null,
      selectedClickId: attribution?.selectedClickId ?? null,
      affiliatePartnerId: link?.affiliatePartnerId ?? null,
      affiliateCampaignId: link?.affiliateCampaignId ?? null,
      trackingLinkId: link?.id ?? null,
      affiliateCodeSnapshot: link?.partner.code ?? null,
      campaignCodeSnapshot: link?.campaign?.code ?? null,
      trackingLinkPublicCodeSnapshot: link?.publicCode ?? null,
      sourceOwner: FIRST_DEPOSIT_SOURCE_OWNER,
      sourceEventId: firstDepositSourceEventId(input.providerEventId),
      providerAmount: input.normalizedAmount,
      currencyCode: input.currency.code,
      currencyStatus: input.currency.status,
      occurredAt: input.occurredAt,
    },
    select: { id: true },
  });

  // G4-GROWTH — the canonical growth event for the same fact, in the SAME
  // transaction as the conversion row above.
  //
  // ONE FACT, TWO READERS, NO DRIFT. The affiliate conversion ledger answers
  // "what does this affiliate get paid for"; the growth ledger answers "what
  // happened in the funnel". Writing them together is what makes it impossible
  // for a deposit to appear in one and not the other — which is the failure the
  // whole G4 design exists to prevent.
  //
  // NO NEW MONEY AUTHORITY. The amount and currency are the ones the provider
  // event row already established. This is a projection, not a second decision.
  await emitGrowthEvent(tx, {
    eventType: "dep",
    occurredAt: input.occurredAt,
    sourceEventId: pocketPlayerSourceEventId(input.pocketPlayerId),
    sourceEntityId: input.providerEventId,
    userId: input.userId,
    attributionId: attribution?.id ?? null,
    acquisitionClickId: attribution?.selectedClickId ?? null,
    provider: "pocket",
    amount: input.normalizedAmount,
    currencyCode: input.currency.code,
    currencyStatus: input.currency.status,
  });

  // AFFILIATE-PLATFORM-V1. The conversion row id, handed back so the CPA owner
  // can be asked about it AFTER this transaction commits. It is deliberately
  // not qualified here: see `qualifyDepositAfterCommit`.
  return { conversionEventId: conversion.id };
}

/**
 * AFFILIATE-PLATFORM-V1 §6/§40 — ask the CPA owner about a newly recorded first
 * deposit, AFTER the deposit has committed.
 *
 * WHY IT IS NOT IN THE DEPOSIT TRANSACTION. A deposit is a fact about a
 * learner's money. A CPA qualification is a fact about ATA's contract with a
 * third party. Enrolling the second in the first's transaction would mean a
 * misconfigured campaign, an exhausted connection or a bug in commercial
 * arithmetic could roll back a real deposit — turning an accounting problem
 * into a customer-facing one. That is the same reasoning the growth projection
 * and the registration reconciler already follow.
 *
 * WHY LOSING IT IS RECOVERABLE. `qualifyFirstDeposit` re-reads every fact from
 * durable state and is keyed on UNIQUE(conversionEventId), so running it late,
 * twice, or from an operator command reaches exactly the same answer. Nothing
 * is lost by a failure here, only deferred.
 *
 * A REPLAY PASSES THROUGH UNCHANGED, because a replay produced no new
 * conversion and therefore has no `conversionEventId` to qualify.
 */
export async function qualifyDepositAfterCommit(
  result: FirstDepositResult,
  db: Db,
  now: Date = new Date(),
): Promise<FirstDepositResult> {
  if (result.conversionEventId === undefined) return result;
  const cpa = await qualifyFirstDepositSafely(result.conversionEventId, now, db);
  // AFFILIATE-PLATFORM-V1 §25 — and the partner's outbound notification, which
  // is a THIRD independent concern. It is enqueued whether or not the CPA
  // qualified: a partner is told about every attributed deposit, and whether
  // ATA owes them a commission for it is a separate question with a separate
  // owner. Its failures are swallowed for the same reason the CPA's are.
  await enqueueConversionPostbackSafely(result.conversionEventId, now, db);
  return { ...result, cpaOutcome: cpa.outcome };
}

/**
 * Reconcile every pending deposit belonging to ONE Pocket player.
 *
 * Called from the trusted `goal=reg` path immediately after an identity is
 * legally bound, and from the operator command. Deliberately scoped by player:
 * a registration knows exactly which player it just bound, and reconciling only
 * that one keeps the work a registration does bounded and unrelated to how many
 * pending deposits exist globally.
 *
 * NEVER THROWS INTO ITS CALLER'S CRITICAL PATH — see
 * `reconcileFirstDepositAfterRegistration`.
 */
export async function reconcilePendingDepositsForPlayer(
  db: Db,
  pocketPlayerId: string,
  currency: PocketDepositCurrency,
  now: Date = new Date(),
): Promise<FirstDepositResult> {
  const pending = await db.pocketProviderEvent.findFirst({
    where: {
      provider: "pocket",
      eventType: "first_deposit",
      pocketPlayerId,
      status: "pending_identity",
    },
    select: { id: true },
  });

  if (!pending) return { outcome: "unchanged_pending" };

  const settled = await db.$transaction((tx) =>
    convergePendingEvent(tx, pending.id, currency, now),
  );
  return qualifyDepositAfterCommit(settled, db, now);
}

/**
 * The reconciliation hook the trusted `goal=reg` path calls.
 *
 * IT RUNS AFTER THE IDENTITY BINDING COMMITS, NOT INSIDE IT. The binding and the
 * Level 1 completion are the registration's job and must succeed or fail on
 * their own merits. Enrolling a deposit's fate in that transaction would mean a
 * malformed, unrelated pending deposit row could roll back a legitimate
 * registration — turning a measurement problem into a customer-facing outage,
 * which is the same mistake AFD-3B2 refused to make with attribution.
 *
 * IT IS SAFE TO RUN LATE, OR TWICE, OR NEVER. `convergePendingEvent` re-reads
 * every fact from durable state and does nothing to an event that is no longer
 * pending, so the operator command reaches exactly the same answer for anything
 * this call misses. That is what makes swallowing the error here honest rather
 * than lossy: nothing is lost, only deferred.
 *
 * NOTHING IS THROWN AND NOTHING IS LOGGED FROM THE FAILURE PATH. A thrown Prisma
 * error can quote the conflicting row, and this must not become the way a Pocket
 * identifier reaches a log line.
 */
export async function reconcileFirstDepositAfterRegistration(
  db: Db,
  pocketPlayerId: string,
  now: Date = new Date(),
): Promise<FirstDepositResult> {
  // Read at call time. A deployment that has switched deposits off must not
  // start counting conversions again through the registration path.
  const resolution = resolvePocketFirstDepositConfig();
  if (resolution.kind !== "resolved" || !resolution.config.enabled) {
    return { outcome: "unchanged_pending" };
  }

  try {
    return await reconcilePendingDepositsForPlayer(
      db,
      pocketPlayerId,
      resolution.config.currency,
      now,
    );
  } catch {
    return { outcome: "unchanged_pending" };
  }
}
