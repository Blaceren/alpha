/**
 * G4-GROWTH — the redeposit handler, and the boundary it refuses to cross.
 *
 * THE HONEST SUMMARY. Everything a redeposit needs is implemented here: the
 * typed parser, the field validation, the exact decimal amount, the provider
 * timestamp, the click and player linkage, the durable sanitized evidence, and
 * an explicit processing state. The one thing that does NOT happen is the
 * emission of a canonical `rdep` business event — because ATA cannot currently
 * tell a retried delivery from a genuinely new deposit, and pretending otherwise
 * would put invented money in a ledger a CPA calculation will later read.
 *
 * WHY THE OBVIOUS KEY IS FORBIDDEN. `UNIQUE(playerId, dateTime, amount)` looks
 * like an identity and is not one. A learner who deposits 25.00 twice in the
 * same second — a double-click on a deposit button, an automated top-up, two
 * genuine trades — produces two identical tuples. Under that key the second
 * deposit silently disappears. The inverse is just as bad: a redelivery whose
 * timestamp differs by one second becomes new money. This platform already
 * refused exactly this reasoning for first deposits, in
 * `20260731010000_pocket_first_deposit`, and refuses it again here.
 *
 * WHY THE PAYLOAD HASH IS ALSO NOT THE ANSWER. It identifies repeated BYTES. Two
 * legitimate redeposits that agree on every field produce one hash. It can say
 * "we have seen this exact message before"; it cannot say "this is the same
 * deposit", and those are different claims.
 *
 * SO WHAT WOULD BE SUFFICIENT. An identifier the PROVIDER generates, that is
 * unique per deposit, and that is STABLE ACROSS RETRIES. Pocket's documented
 * macro set — CLICK_ID, TRADER_ID, SUMDEP, DATE_TIME, CID, AC, SITE_ID,
 * SUB_ID1..5, PROMO, COUNTRY, DEVICE_TYPE, OS_VERSION, BROWSER, LINK_TYPE,
 * VISITOR_ID, COUNTRY_IP — contains no such field. When a contract supplies one,
 * an operator names the parameter in `POCKET_RDEP_EVENT_ID_PARAM` and canonical
 * emission begins with no schema change and no code change here.
 *
 * THIS IS NOT A PHASE FAILURE. It is the accepted safety boundary of §27: typed
 * ingress implemented, evidence durably captured, canonical conversion
 * fail-closed as `identity_unresolved`.
 */
import type { PrismaClient } from "@prisma/client";
import { parsePocketDepositAmount } from "@/lib/exchange/pocketDepositAmount";
import {
  resolveRedepositIdentityPolicy,
  type RedepositIdentityPolicy,
} from "@/lib/growth/ingress-config";
import { emitGrowthEvent } from "@/lib/growth/emit";
import { redepositSourceEventId } from "@/lib/growth/event-keys";
import { recordProviderIngress } from "@/lib/growth/pocket/ingress";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const POCKET_REFERRAL_CLICK_ID =
  /^tq-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const POCKET_PLAYER_ID = /^[1-9][0-9]{0,15}$/;

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

/**
 * Read the provider event identity, if and only if an operator has asserted a
 * contract that supplies one.
 *
 * A CALLER CANNOT OPT IN. If `POCKET_RDEP_EVENT_ID_PARAM` is unset, a delivery
 * carrying `event_id=whatever` is ignored entirely — the parameter is not read,
 * not stored as an identity, and cannot cause emission. This is what stops an
 * attacker who has obtained the secret from minting arbitrary "unique" deposits
 * by inventing identifiers, and it is why the policy lives in configuration
 * rather than in payload sniffing.
 */
export function readProviderEventIdentity(
  params: URLSearchParams,
  policy: RedepositIdentityPolicy,
): string | null {
  if (policy.kind !== "available") return null;

  const values = params.getAll(policy.parameterName);
  if (values.length !== 1) return null;

  const value = values[0].trim();
  if (value.length === 0 || value.length > 128) return null;
  if (CONTROL_CHARACTERS.test(value)) return null;

  return value;
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
  | { readonly kind: "emitted"; readonly ingressEventId: number; readonly growthEventId: number }
  /** A provider identity was supplied and ATA already holds that exact event. */
  | { readonly kind: "duplicate"; readonly ingressEventId: number; readonly growthEventId: number };

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

  const policy = resolveRedepositIdentityPolicy(input.env ?? process.env);
  const providerEventIdentity = readProviderEventIdentity(params, policy);

  // ---- THE SAFETY BOUNDARY ----
  //
  // No provider event identity means ATA cannot distinguish a retry from a new
  // deposit. The evidence is complete and durable, the amount is exact, the
  // linkage is recorded — and no canonical event is emitted. An operator sees
  // this in the ingress-health surface as `identity_unresolved`, and the
  // analytics layer reports redeposits as UNAVAILABLE rather than as zero.
  if (providerEventIdentity === null) {
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
      providerEventIdentity,
    });
    return { kind: "identity_unresolved", ingressEventId: evidence.id };
  }

  // A redeposit before any first deposit is an ordering ATA will not silently
  // repair: promoting it to a first deposit would fabricate the DEP that a CPA
  // conversion is computed from.
  const firstDeposit = await db.pocketProviderEvent.findUnique({
    where: {
      provider_eventType_pocketPlayerId: {
        provider: "pocket",
        eventType: "first_deposit",
        pocketPlayerId: fields.playerId,
      },
    },
    select: { id: true },
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
      providerEventIdentity,
    });
    return { kind: "rejected", reason: "ordering_unresolved", ingressEventId: evidence.id };
  }

  const currency = await resolveRedepositCurrency(db, firstDeposit.id);

  // Evidence and canonical event commit together. A canonical redeposit whose
  // evidence rolled back would be money with no provenance.
  return db.$transaction(async (tx) => {
    const evidence = await recordProviderIngress(tx, {
      goal: "redep",
      params,
      receivedAt: now,
      processingStatus: "accepted_processed",
      playerIdNormalized: fields.playerId,
      clickId: fields.clickId,
      amount: amount.normalized,
      providerEventIdentity,
    });

    const emitted = await emitGrowthEvent(tx, {
      eventType: "rdep",
      occurredAt: now,
      sourceEventId: redepositSourceEventId(providerEventIdentity),
      sourceEntityId: evidence.id,
      userId: identity.userId,
      pocketTraderIdentityId: identity.id,
      providerIngressEventId: evidence.id,
      provider: "pocket",
      amount: amount.normalized,
      currencyCode: currency.code,
      currencyStatus: currency.status,
      metadata: { ingressGoal: "redep" },
    });

    if (emitted.outcome === "failed") {
      throw new Error("growth_event_emission_failed");
    }

    await tx.providerIngressEvent.update({
      where: { id: evidence.id },
      data: {
        canonicalEventId: emitted.growthEventId,
        processingStatus: emitted.outcome === "created" ? "accepted_processed" : "accepted_duplicate",
      },
    });

    return emitted.outcome === "created"
      ? { kind: "emitted" as const, ingressEventId: evidence.id, growthEventId: emitted.growthEventId }
      : { kind: "duplicate" as const, ingressEventId: evidence.id, growthEventId: emitted.growthEventId };
  });
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
