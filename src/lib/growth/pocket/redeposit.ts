/**
 * POCKET-DEP-RDEP-1 — the redeposit handler.
 *
 * A valid authenticated `goal=redep` callback is authoritative evidence that a
 * redeposit occurred. Pocket issues no per-deposit event identifier and is not
 * required to: ATA derives its OWN deterministic business identity from the
 * authenticated provider attributes and counts the event.
 *
 *     v1:pocket:redeposit:<playerId>:<canonical provider-local time>:<amount>
 *
 * WHAT THIS FILE USED TO SAY, AND WHY IT CHANGED. It previously refused to emit
 * any canonical `rdep` event at all, on the reasoning that ATA "cannot tell a
 * retried delivery from a genuinely new deposit" without a provider-issued id,
 * and that emission would begin only once an operator named such a parameter in
 * `POCKET_RDEP_EVENT_ID_PARAM`. That gate is gone, together with the parameter,
 * because the premise was rejected: waiting for an identifier the provider does
 * not publish meant redeposits were never counted at all.
 *
 * THE COST IS NAMED, NOT HIDDEN — BUSINESS_ACCEPTED_COLLISION_BEHAVIOUR. The old
 * objection to `(player, time, amount)` was real and still is: two conceptually
 * distinct redeposits by the same player, for the same exact amount, inside the
 * same DATE_TIME second, collapse into ONE canonical ATA redeposit. That is an
 * ACCEPTED BUSINESS ASSUMPTION and an ATA-DERIVED identity — it is NOT
 * provider-guaranteed uniqueness, and it must never be described as such. The
 * same property is what makes retries safe: a redelivery reproduces the same key
 * and is recognised instead of double-counted.
 *
 * `clickid` is deliberately EXCLUDED from the key. It identifies the acquisition
 * journey, not the deposit, so including it would split one redeposit into
 * several whenever the click context differed. It is not the fix for a collision.
 *
 * A REDEPOSIT NEVER BECOMES A FIRST DEPOSIT. Promoting one would fabricate the
 * DEP a CPA calculation will later read; the two families are separated by
 * partial unique indexes in migration 49 and by an explicit refusal below.
 */import type { PrismaClient } from "@prisma/client";
import { parsePocketDepositAmount } from "@/lib/exchange/pocketDepositAmount";
import { emitGrowthEvent } from "@/lib/growth/emit";
import { redepositSourceEventId } from "@/lib/growth/event-keys";
import { recordProviderIngress } from "@/lib/growth/pocket/ingress";
import { createAuditLog } from "@/lib/audit";
import {
  deriveRedepositEventKey,
  resolveRedepositTemporal,
} from "@/lib/growth/pocket/redeposit-identity";
import { readProviderEventTimeRaw } from "@/lib/growth/pocket/ingress-payload";
import { emitRedepositConversion } from "@/lib/affiliate/redeposit-conversion";
import { enqueueConversionPostbackSafely } from "@/lib/affiliate/postback/enqueue";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const POCKET_REFERRAL_CLICK_ID =
  /^tq-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const POCKET_PLAYER_ID = /^[1-9][0-9]{0,15}$/;

/** Bounded so a retry storm cannot grow the counter without limit. */
const MAX_REDELIVERY_COUNT = 1000;

export type RedepositFieldRejection =
  | "ambiguous_param"
  | "missing_click_id"
  | "invalid_click_id"
  | "missing_player_id"
  | "invalid_player_id"
  | "missing_sum";

export type RedepositFields =
  | { readonly ok: true; readonly clickId: string; readonly playerId: string; readonly sum: string }
  | { readonly ok: false; readonly reason: RedepositFieldRejection };

/**
 * Parse the redeposit fields, refusing ambiguity before anything else.
 *
 * Deliberately its own function rather than a reuse of the deposit parser. The
 * two contracts happen to agree today, and a shared parser would mean a future
 * change to one silently changing the other — which for two different money
 * events is precisely the coupling to avoid.
 */
export function parseRedepositFields(params: URLSearchParams): RedepositFields {
  const clickIds = [...params.getAll("clickid"), ...params.getAll("click_id")];
  const playerIds = params.getAll("playerid");
  const sums = params.getAll("sum");

  if (clickIds.length > 1 || playerIds.length > 1 || sums.length > 1) {
    return { ok: false, reason: "ambiguous_param" };
  }
  if (clickIds.length === 0) return { ok: false, reason: "missing_click_id" };
  if (playerIds.length === 0) return { ok: false, reason: "missing_player_id" };
  if (sums.length === 0) return { ok: false, reason: "missing_sum" };

  if (
    CONTROL_CHARACTERS.test(clickIds[0]) ||
    CONTROL_CHARACTERS.test(playerIds[0]) ||
    CONTROL_CHARACTERS.test(sums[0])
  ) {
    return { ok: false, reason: "ambiguous_param" };
  }

  if (!POCKET_REFERRAL_CLICK_ID.test(clickIds[0])) {
    return { ok: false, reason: "invalid_click_id" };
  }
  if (!POCKET_PLAYER_ID.test(playerIds[0]) || !Number.isSafeInteger(Number(playerIds[0]))) {
    return { ok: false, reason: "invalid_player_id" };
  }

  return { ok: true, clickId: clickIds[0], playerId: playerIds[0], sum: sums[0] };
}


export type RedepositOutcome =
  /** Fields, amount or shape were wrong. Nothing was linked. */
  | { readonly kind: "rejected"; readonly reason: string; readonly ingressEventId: number | null }
  /**
   * Evidence stored, canonical event deliberately NOT emitted because the
   * provider supplied no event identity. The expected outcome today.
   */
  | { readonly kind: "identity_unresolved"; readonly ingressEventId: number | null }
  /** A provider identity was supplied and this is the first delivery of it. */
  | {
      readonly kind: "emitted";
      readonly ingressEventId: number;
      readonly growthEventId: number;
      /**
       * AFFILIATE-PLATFORM-V1 §41. The affiliate conversion this redeposit
       * produced, so the partner's outbound notification can be enqueued after
       * the transaction commits. NULL on a redelivery, which created none.
       */
      readonly conversionEventId?: number | null;
    }
  /** A provider identity was supplied and ATA already holds that exact event. */
  | {
      readonly kind: "duplicate";
      readonly ingressEventId: number;
      readonly growthEventId: number;
      readonly conversionEventId?: number | null;
    };

/**
 * Ingest one redeposit delivery.
 *
 * Runs entirely PAST the route's authenticated boundary and past the
 * `POCKET_RDEP_INGEST_ENABLED` gate — this function does not re-check either,
 * and its callers must not invoke it speculatively.
 */
export async function ingestPocketRedeposit(
  db: PrismaClient,
  input: {
    readonly params: URLSearchParams;
    readonly now: Date;
    readonly env?: NodeJS.ProcessEnv;
  },
): Promise<RedepositOutcome> {
  const { params, now } = input;
  const fields = parseRedepositFields(params);

  if (!fields.ok) {
    const evidence = await recordProviderIngress(db, {
      goal: "redep",
      params,
      receivedAt: now,
      processingStatus: "rejected",
      rejectionCode: "schema_invalid",
    });
    return { kind: "rejected", reason: fields.reason, ingressEventId: evidence.id };
  }

  const amount = parsePocketDepositAmount(fields.sum);

  if (!amount.ok) {
    const evidence = await recordProviderIngress(db, {
      goal: "redep",
      params,
      receivedAt: now,
      processingStatus: "rejected",
      rejectionCode: "amount_invalid",
      playerIdNormalized: fields.playerId,
      clickId: fields.clickId,
    });
    return { kind: "rejected", reason: "amount_invalid", ingressEventId: evidence.id };
  }

  // ---- THE IDENTITY BOUNDARY, UNDER THE ACCEPTED BUSINESS CONTRACT ----
  //
  // WHAT CHANGED HERE. This used to require an operator to name a
  // provider-issued unique event parameter, and to record every delivery as
  // `identity_unresolved` until one existed. The product owner has decided
  // otherwise: an authenticated `goal=redep` delivery is authoritative evidence
  // that a redeposit occurred, and ATA derives its OWN deterministic identity
  // from the authenticated attributes. See
  // BUSINESS_ACCEPTED_RDEP_DEDUP_ASSUMPTION in redeposit-identity.ts for the
  // residual collision risk, which is accepted rather than argued away.
  //
  // DATE_TIME IS REQUIRED. Without it there is no derivable identity, and a
  // receive time, now(), firstReceivedAt or a payload hash must NEVER be
  // substituted — each of those makes a retry look like new money. So a missing
  // or malformed event time is a fail-closed terminal state with durable
  // evidence, exactly as the old missing-parameter case was.
  const rawEventTime = readProviderEventTimeRaw(params);
  const derived = deriveRedepositEventKey({
    pocketPlayerId: fields.playerId,
    rawEventTime,
    rawAmount: fields.sum,
  });

  if (!derived.ok) {
    const evidence = await recordProviderIngress(db, {
      goal: "redep",
      params,
      receivedAt: now,
      processingStatus: "identity_unresolved",
      rejectionCode: "provider_event_identity_missing",
      playerIdNormalized: fields.playerId,
      clickId: fields.clickId,
      amount: amount.normalized,
    });
    return { kind: "identity_unresolved", ingressEventId: evidence.id };
  }

  const providerEventIdentity = derived.key;

  // THE ABSOLUTE INSTANT IS A SEPARATE QUESTION FROM THE IDENTITY, AND AN
  // UNKNOWN ONE IS NOT A REJECTION.
  //
  // Pocket renders DATE_TIME in a zone that varies by user, account and
  // registration GEO, so there is no single zone ATA could apply without
  // fabricating one. The provider still told us four authoritative things —
  // provider, player, exact amount, provider-local wall clock — and those
  // identify and describe the redeposit completely. An unknown zone makes none
  // of them untrue.
  //
  // So the event is created either way, and the temporal record says exactly
  // what is known: raw bytes, normalised local wall clock, and an absolute
  // instant ONLY when the delivery stated its own offset.
  const temporal = resolveRedepositTemporal(derived.eventTime);

  // ---- past the boundary: an operator has asserted a provider contract ----

  // The learner this redeposit belongs to, resolved the same way every other
  // Pocket event resolves it — through the referral click, never through a
  // caller-supplied user id.
  const identity = await db.pocketTraderIdentity.findUnique({
    where: { pocketUserId: fields.playerId },
    select: { id: true, userId: true },
  });

  // A redeposit for a player ATA has never seen registered cannot be attributed
  // to anybody. It is kept as evidence, not counted.
  if (identity === null) {
    const evidence = await recordProviderIngress(db, {
      goal: "redep",
      params,
      receivedAt: now,
      processingStatus: "accepted_pending_linkage",
      playerIdNormalized: fields.playerId,
      clickId: fields.clickId,
      amount: amount.normalized,
      // DELIBERATELY NOT providerEventIdentity. That column means "the
      // PROVIDER's own unique event id", and it carries
      // UNIQUE(provider, goal, providerEventIdentity) — one identity, one
      // delivery. ATA's derived key is the opposite by design: STABLE ACROSS
      // RETRIES, so writing it there would make the second delivery of one
      // redeposit collide and be refused as evidence. §11 requires the opposite
      // — evidence per delivery, never deduplicated away. The derived key lives
      // on PocketProviderEvent.providerEventKey, which is the canonical row.
    });
    return { kind: "identity_unresolved", ingressEventId: evidence.id };
  }

  // A redeposit before any first deposit is an ordering ATA will not silently
  // repair: promoting it to a first deposit would fabricate the DEP that a CPA
  // conversion is computed from.
  // findFirst, not findUnique: migration 49 made first-deposit uniqueness a
  // PARTIAL index so redeposits are not capped at one per player. The database
  // still guarantees at most one row matches.
  const firstDeposit = await db.pocketProviderEvent.findFirst({
    where: {
      provider: "pocket",
      eventType: "first_deposit",
      pocketPlayerId: fields.playerId,
    },
    select: { id: true, currencyCode: true, currencyStatus: true, matchedUserId: true },
  });

  if (firstDeposit === null) {
    const evidence = await recordProviderIngress(db, {
      goal: "redep",
      params,
      receivedAt: now,
      processingStatus: "quarantined",
      rejectionCode: "ordering_unresolved",
      playerIdNormalized: fields.playerId,
      clickId: fields.clickId,
      amount: amount.normalized,
      // DELIBERATELY NOT providerEventIdentity. That column means "the
      // PROVIDER's own unique event id", and it carries
      // UNIQUE(provider, goal, providerEventIdentity) — one identity, one
      // delivery. ATA's derived key is the opposite by design: STABLE ACROSS
      // RETRIES, so writing it there would make the second delivery of one
      // redeposit collide and be refused as evidence. §11 requires the opposite
      // — evidence per delivery, never deduplicated away. The derived key lives
      // on PocketProviderEvent.providerEventKey, which is the canonical row.
    });
    return { kind: "rejected", reason: "ordering_unresolved", ingressEventId: evidence.id };
  }

  const currency = await resolveRedepositCurrency(db, firstDeposit.id);

  // Evidence and canonical event commit together. A canonical redeposit whose
  // evidence rolled back would be money with no provenance.
  //
  // DELIVERY EVIDENCE IS NOT THE BUSINESS EVENT. One canonical redeposit may
  // have many ProviderIngressEvent rows behind it — one per delivery, including
  // retries — and that is deliberate. The canonical row is PocketProviderEvent,
  // deduplicated on the derived key by a partial UNIQUE index in migration 49.
  const settled = await db.$transaction(async (tx) => {
    const evidence = await recordProviderIngress(tx, {
      goal: "redep",
      params,
      receivedAt: now,
      processingStatus: "accepted_processed",
      playerIdNormalized: fields.playerId,
      clickId: fields.clickId,
      amount: amount.normalized,
      // DELIBERATELY NOT providerEventIdentity. That column means "the
      // PROVIDER's own unique event id", and it carries
      // UNIQUE(provider, goal, providerEventIdentity) — one identity, one
      // delivery. ATA's derived key is the opposite by design: STABLE ACROSS
      // RETRIES, so writing it there would make the second delivery of one
      // redeposit collide and be refused as evidence. §11 requires the opposite
      // — evidence per delivery, never deduplicated away. The derived key lives
      // on PocketProviderEvent.providerEventKey, which is the canonical row.
    });

    // THE CANONICAL FINANCIAL ROW.
    //
    // A redeposit lands in the same table as a first deposit, because they are
    // the same KIND of fact — money a provider reported — and a second financial
    // ledger is exactly what the accepted design forbids. The two families are
    // kept apart by their identity, not by living in different tables:
    // a first deposit is unique per player, a redeposit is unique per derived
    // key, and migration 49 enforces both with separate partial indexes.
    //
    // `providerEventAt` is the provider's own instant. `firstReceivedAt` is when
    // ATA saw it. They are different facts and both are kept.
    let canonical: { id: number } | null = null;
    let alreadyExisted = false;

    try {
      canonical = await tx.pocketProviderEvent.create({
        data: {
          provider: "pocket",
          eventType: "redeposit",
          pocketClickId: fields.clickId,
          pocketPlayerId: fields.playerId,
          matchedUserId: identity.userId,
          matchedAt: now,
          status: "matched",
          normalizedAmount: amount.normalized,
          currencyCode: currency.code,
          currencyStatus: currency.status,
          providerEventKey: providerEventIdentity,
          // The three temporal facts, kept apart because they ARE different
          // facts. `providerEventLocal` is what Pocket's clock read;
          // `providerEventAt` is a real instant and stays NULL unless the
          // delivery stated its own offset; `providerEventAtStatus` says which
          // of those is true so a reader can never mistake one for the other.
          providerEventLocal: temporal.local,
          providerEventAt: temporal.absolute,
          providerEventAtRaw: temporal.raw,
          providerEventAtStatus: temporal.authority,
          firstReceivedAt: now,
          lastReceivedAt: now,
        },
        select: { id: true },
      });
    } catch (error) {
      // A duplicate derived key is the RETRY case, and it is the whole point of
      // the key. Re-read the canonical row and record the delivery against it
      // rather than creating a second one.
      if (!isRedepositKeyCollision(error)) throw error;
      alreadyExisted = true;
      canonical = await tx.pocketProviderEvent.findFirst({
        where: { provider: "pocket", eventType: "redeposit", providerEventKey: providerEventIdentity },
        select: { id: true },
      });
      if (canonical === null) throw error;
      const existing = await tx.pocketProviderEvent.findUnique({
        where: { id: canonical.id },
        select: { replayCount: true },
      });
      await tx.pocketProviderEvent.update({
        where: { id: canonical.id },
        data: {
          lastReceivedAt: now,
          // Bounded transport metadata, mirroring the first-deposit contract.
          // It never implies more than one redeposit.
          ...((existing?.replayCount ?? 0) < MAX_REDELIVERY_COUNT
            ? { replayCount: { increment: 1 } }
            : {}),
        },
      });
    }

    const emitted = await emitGrowthEvent(tx, {
      eventType: "rdep",
      // THE NARROWEST TRUTHFUL ORDERING TIMESTAMP.
      //
      // GrowthEvent.occurredAt is a real absolute instant used for ordering and
      // period filtering, so it cannot hold a zone-less wall clock. When the
      // provider's own instant IS authoritative — the delivery stated its offset
      // — that is what goes here. When it is not, converting the local wall
      // clock with a guessed zone would put a fabricated instant into the ledger
      // a CPA calculation reads, so the fallback is ATA's own receipt time,
      // which is a fact ATA can actually vouch for.
      //
      // THE FALLBACK IS LABELLED, NOT HIDDEN. `occurredAtAuthority` records
      // whether this is the provider's instant or ATA's receipt, so no surface
      // can present receipt time as Pocket's event time. The provider's original
      // local reading is preserved on PocketProviderEvent either way and is
      // never overwritten by this choice.
      occurredAt: temporal.absolute ?? now,
      metadata: {
        ingressGoal: "redep",
        occurredAtAuthority:
          temporal.absolute === null ? "ata_receipt_time" : "provider_event_instant",
      },
      sourceEventId: redepositSourceEventId(providerEventIdentity),
      sourceEntityId: canonical.id,
      userId: identity.userId,
      pocketTraderIdentityId: identity.id,
      providerIngressEventId: evidence.id,
      provider: "pocket",
      amount: amount.normalized,
      currencyCode: currency.code,
      currencyStatus: currency.status,
    });

    if (emitted.outcome === "failed") {
      throw new Error("growth_event_emission_failed");
    }

    // AFFILIATE-PLATFORM-V1 §25/§41 — the affiliate ledger's view of the same
    // fact, in the SAME TRANSACTION as the canonical financial row and the
    // growth event above.
    //
    // ONLY WHEN THE CANONICAL ROW IS NEW. `alreadyExisted` means this delivery
    // was a redelivery of a redeposit ATA has already counted, so its
    // conversion already exists. The emitter also refuses the duplicate on its
    // own unique key, so this guard is the fast path and not the guarantee.
    //
    // IT CREATES NO CPA AND NO COMMISSION, and cannot: the qualification owner
    // accepts `first_deposit` and nothing else. §41 in one line.
    let redepositConversionId: number | null = null;
    if (!alreadyExisted) {
      const conversion = await emitRedepositConversion(tx, {
        providerEventId: canonical.id,
        userId: identity.userId,
        normalizedAmount: amount.normalized,
        currency:
          currency.status === "configured" && currency.code !== null
            ? { status: "configured", code: currency.code }
            : { status: "unspecified", code: null },
        // The instant the growth event uses, for the reason stated there: a
        // conversion whose time disagreed with the event it projects would put
        // the same money in two reporting periods.
        occurredAt: temporal.absolute ?? now,
      });
      redepositConversionId = conversion.conversionEventId;
    }

    await tx.providerIngressEvent.update({
      where: { id: evidence.id },
      data: {
        canonicalEventId: emitted.growthEventId,
        processingStatus: emitted.outcome === "created" ? "accepted_processed" : "accepted_duplicate",
      },
    });

    return emitted.outcome === "created"
      ? {
          kind: "emitted" as const,
          ingressEventId: evidence.id,
          growthEventId: emitted.growthEventId,
          conversionEventId: redepositConversionId,
        }
      : {
          kind: "duplicate" as const,
          ingressEventId: evidence.id,
          growthEventId: emitted.growthEventId,
          conversionEventId: redepositConversionId,
        };
  });

  // AFFILIATE-PLATFORM-V1 §25/§28 — the partner's outbound notification, AFTER
  // the financial transaction has committed and never inside it. A partner
  // endpoint that is slow, wrong or hostile must not be able to roll back a
  // recorded redeposit, and enqueueing is idempotent so nothing is lost if this
  // never runs.
  if (settled.conversionEventId != null) {
    await enqueueConversionPostbackSafely(settled.conversionEventId, now, db);
  }

  return settled;
}

/**
 * A redeposit is denominated in whatever the player's FIRST deposit was.
 *
 * Read from the stored first-deposit row rather than from configuration, so a
 * currency an operator changes later cannot retroactively redenominate money
 * that was already recorded under the old one.
 */
async function resolveRedepositCurrency(
  db: Pick<PrismaClient, "pocketProviderEvent">,
  firstDepositId: number,
): Promise<{ code: string | null; status: "unspecified" | "configured" }> {
  const row = await db.pocketProviderEvent.findUnique({
    where: { id: firstDepositId },
    select: { currencyCode: true, currencyStatus: true },
  });

  if (!row || row.currencyStatus !== "configured" || row.currencyCode === null) {
    return { code: null, status: "unspecified" };
  }

  return { code: row.currencyCode, status: "configured" };
}


/**
 * Is this the "another delivery created this redeposit first" collision?
 *
 * Matched on the constraint target rather than the code alone, so an unrelated
 * uniqueness failure in the same transaction is not mistaken for a retry.
 */
function isRedepositKeyCollision(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; meta?: unknown };
  if (candidate.code !== "P2002") return false;
  const target = JSON.stringify(candidate.meta ?? {});
  return target.includes("providerEventKey") || target.includes("PocketProviderEvent");
}
