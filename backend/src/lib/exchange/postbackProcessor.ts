import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { createAuditLog } from "@/lib/audit";
import { getExchangeProvider } from "@/lib/exchange";
import { notifyExchangeStatus } from "@/lib/exchange/account";
import {
  extractPocketAttribution,
  getPocketClickId,
  getPocketTraderId,
  normalizePocketEvent,
  pocketEventToExchangeEvent,
} from "@/lib/exchange/pocket";
import { createNotification } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { completeProgressionTaskByCode } from "@/lib/taskProgression";
import { notFoundResponse, receivePostbackSchema } from "@/lib/validation";
import type { z } from "zod";

type ReceivePostbackPayload = z.infer<typeof receivePostbackSchema>;

/** Recorded on events accepted for evidence but deliberately not applied. */
export const PROVIDER_EVENT_IDENTITY_MISSING = "provider_event_identity_missing";

/**
 * Whether this event would move money if applied.
 *
 * Deliberately broad: anything that increments a deposit total, a withdrawal
 * total, or carries a positive amount under a deposit/withdrawal shape counts.
 * Registration and email confirmation are NOT monetary and continue to work
 * without a provider event id, which is what keeps identity binding available
 * while deposit accounting stays closed.
 */
export function isMonetaryPostbackEvent(
  normalizedEventType: string,
  eventType: string,
  amount: number,
): boolean {
  const monetaryNames = new Set([
    "first_deposit",
    "redeposit",
    "successful_withdrawal",
  ]);
  if (monetaryNames.has(normalizedEventType)) return true;
  if (eventType === "deposit" || eventType === "withdrawal") return amount > 0;
  return false;
}

export function buildPostbackAccountUpdate(
  normalizedEventType: string,
  eventType: string,
  amount: number,
  message?: string,
): Prisma.ExchangeAccountUpdateInput {
  if (normalizedEventType === "registration") {
    return {
      status: "connected",
      registrationStatus: true,
      verifiedAt: new Date(),
      rejectionReason: null,
    };
  }

  if (normalizedEventType === "email_confirmation") {
    return {
      status: "connected",
      emailConfirmed: true,
      rejectionReason: null,
    };
  }

  // DEVACT-1 — `balance` is a CURRENT TRADING BALANCE and is no longer written.
  //
  // PLPD-1 removed it from every API response and from the serializer, but the
  // deposit postback path still PERSISTED it, so the column kept accumulating a
  // number the platform is forbidden to hold. A deposit is a historical
  // transaction; it is not a statement about what the learner has now (they may
  // have traded it away a second later). `depositAmount`, `totalDeposits` and
  // `firstDepositConfirmed` are historical accounting and are deliberately kept.
  if (normalizedEventType === "first_deposit") {
    return {
      status: "connected",
      firstDepositConfirmed: true,
      depositAmount: { increment: amount },
      totalDeposits: { increment: amount },
    };
  }

  if (normalizedEventType === "redeposit") {
    return {
      depositAmount: { increment: amount },
      totalDeposits: { increment: amount },
    };
  }

  if (normalizedEventType === "commission") {
    return { totalCommission: { increment: amount } };
  }

  if (eventType === "deposit") {
    return {
      depositAmount: { increment: amount },
      totalDeposits: { increment: amount },
    };
  }

  if (eventType === "trade") {
    return {
      tradesCount: { increment: 1 },
    };
  }

  if (normalizedEventType === "successful_withdrawal") {
    // Historical withdrawal accounting only. Decrementing `balance` here would
    // be maintaining the same forbidden current-balance figure from the other
    // direction, and would additionally be wrong: the platform never saw the
    // deposits and trades in between, so its running total was never real.
    return {
      totalWithdrawals: { increment: amount },
    };
  }

  if (
    normalizedEventType === "withdrawal" ||
    normalizedEventType === "new_withdrawal" ||
    normalizedEventType === "canceled_withdrawal"
  ) {
    // Withdrawal request/cancel/status events stay a financial no-op:
    // only the confirmed "Successful Withdrawal" may change account money state.
    return {};
  }

  // A provider "balance" event is the purest form of the thing this platform is
  // forbidden to hold: a current trading balance, asserted by whoever sent the
  // postback. It is accepted and recorded as an event, but it changes no
  // account state. L4 is answered by CheckpointBalanceProvider, never by a
  // number someone posted to us.
  if (eventType === "balance") {
    return {};
  }

  if (eventType === "account_rejected") {
    return {
      status: "rejected",
      rejectionReason: message ?? "Exchange postback rejected the account.",
    };
  }

  return {};
}

export type SimulatedPostbackType =
  | "Registration"
  | "Email Confirmation"
  | "First Deposit"
  | "Re-deposit"
  | "Withdrawal";

export function buildSimulatedPostbackAccountUpdate(
  postbackType: SimulatedPostbackType,
  amount: number,
): Prisma.ExchangeAccountUpdateInput {
  if (postbackType === "Registration") {
    return { registrationStatus: true };
  }

  if (postbackType === "Email Confirmation") {
    return { emailConfirmed: true };
  }

  // Simulation must mirror the real contract exactly, including what it may NOT
  // write. A simulator that produced a balance the real path cannot produce
  // would let a leak be built and pass its own tests.
  if (postbackType === "First Deposit") {
    return {
      firstDepositConfirmed: true,
      depositAmount: { increment: amount },
      totalDeposits: { increment: amount },
    };
  }

  if (postbackType === "Re-deposit") {
    return {
      depositAmount: { increment: amount },
      totalDeposits: { increment: amount },
    };
  }

  // Plain "Withdrawal" is an unconfirmed status event and stays a financial
  // no-op in simulation too, matching buildPostbackAccountUpdate semantics.
  return {};
}

type StoredEventFacts = {
  normalizedEventType: string | null;
  amount: number | null;
  currency: string | null;
};

/** Prisma's unique-constraint violation, narrowed without importing the runtime class. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * A replayed identifier must describe the same event. If an upstream reuses an
 * event id for different business facts, that is a conflict rather than a
 * duplicate: returning the original silently would hide a real mismatch, and
 * overwriting it would let a later request rewrite settled money state.
 */
function conflictsWithStoredEvent(
  stored: StoredEventFacts,
  incoming: StoredEventFacts,
): boolean {
  return (
    stored.normalizedEventType !== incoming.normalizedEventType ||
    stored.amount !== incoming.amount ||
    stored.currency !== incoming.currency
  );
}

function conflictResponse() {
  return NextResponse.json(
    { ok: false, error: "POSTBACK_CONFLICT" },
    { status: 409, headers: { "Cache-Control": "no-store" } },
  );
}

export async function processExchangePostbackPayload(
  data: ReceivePostbackPayload,
  request: Request,
) {
  const rawPayload = { ...data, ...(data.rawPayload ?? {}) } as Record<string, unknown>;
  const type = data.type;
  const amount = data.amount ?? 0;
  const normalizedEventType = normalizePocketEvent(type, data.eventType);
  const eventType = pocketEventToExchangeEvent(normalizedEventType);
  // DEVACT-1 — the provider's event identity, or nothing.
  //
  // This used to be `data.externalEventId ?? \`postback-${crypto.randomUUID()}\``.
  // A fresh UUID is unique BY CONSTRUCTION, so it defeated the very unique index
  // it was stored in: two deliveries of the same deposit produced two different
  // ids, skipped the duplicate read below entirely, and applied the accounting
  // mutation TWICE. An identifier ATA invents is not a provider event identity
  // and can never make a redelivery detectable.
  //
  // `externalEventId` is nullable, so the honest representation of "the provider
  // gave us no event identity" is NULL — not a fabricated value. Multiple NULLs
  // are permitted under the unique index, which is correct: unidentified events
  // are not claimed to be distinct from one another, and none of them is allowed
  // to move money (see the monetary guard below).
  const providerEventId = data.externalEventId ?? null;
  const payload = rawPayload as Prisma.InputJsonValue;
  const attribution = extractPocketAttribution(rawPayload);
  const traderId = getPocketTraderId(rawPayload);
  const clickId = getPocketClickId(rawPayload);
  const externalAccountLookup = data.externalAccountId ?? traderId ?? data.externalUserId;
  const accountLookupConditions: Prisma.ExchangeAccountWhereInput[] = [
    externalAccountLookup ? { externalAccountId: externalAccountLookup } : null,
    externalAccountLookup ? { exchangeAccountId: externalAccountLookup } : null,
    externalAccountLookup ? { traderId: externalAccountLookup } : null,
    clickId ? { clickId } : null,
  ].filter(Boolean) as Prisma.ExchangeAccountWhereInput[];

  const incomingFacts: StoredEventFacts = {
    normalizedEventType,
    amount,
    currency: data.currency ?? null,
  };

  // Durable replay control. PostbackEvent.externalEventId is UNIQUE, so the
  // database — not process memory — is the source of truth. This read is the
  // fast path; the unique constraint below is what actually holds under
  // concurrency.
  if (data.externalEventId) {
    const existingEvent = await prisma.postbackEvent.findUnique({
      where: { externalEventId: data.externalEventId },
    });

    if (existingEvent) {
      if (conflictsWithStoredEvent(existingEvent, incomingFacts)) {
        return conflictResponse();
      }

      return NextResponse.json({
        ok: true,
        duplicate: true,
        postback: existingEvent,
      });
    }
  }

  const exchangeAccount = data.userId
    ? await prisma.exchangeAccount.findUnique({ where: { userId: data.userId } })
    : accountLookupConditions.length > 0
      ? await prisma.exchangeAccount.findFirst({
          where: {
            OR: accountLookupConditions,
          },
        })
      : null;

  if (!exchangeAccount) {
    // A concurrent duplicate may already have written this receipt; the unique
    // constraint is authoritative and the outcome is the same rejection.
    const rejectedEvent = await prisma.postbackEvent
      .create({
        data: {
          exchangeAccountId: null,
          externalEventId: providerEventId,
          type: type ?? normalizedEventType,
          eventType,
          normalizedEventType,
          externalAccountId: externalAccountLookup,
          traderId,
          clickId,
          amount,
          currency: data.currency,
          status: "rejected",
          rawPayload: JSON.stringify(payload),
          payload,
          attribution,
          rejectionReason: "Exchange account not found",
          processedAt: new Date(),
        },
      })
      .catch((error: unknown) => {
        if (isUniqueConstraintViolation(error)) return null;
        throw error;
      });

    if (!rejectedEvent) {
      return notFoundResponse("Биржевой аккаунт не найден");
    }

    await createAuditLog({
      action: "EXCHANGE_POSTBACK_REJECTED",
      entityType: "PostbackEvent",
      entityId: rejectedEvent.id,
      metadata: {
        eventType,
        normalizedEventType,
        externalEventId: providerEventId,
        traderId,
        clickId,
        reason: "Exchange account not found",
      },
      request,
    });

    return notFoundResponse("Биржевой аккаунт не найден");
  }

  // DEVACT-1 — no provider event identity, no money movement.
  //
  // The operator-confirmed Pocket postback contract is `clickid`, `goal`,
  // `playerid`, `ow`. It documents NO transaction identifier, so for a Pocket
  // deposit there is currently nothing stable to deduplicate on. The previous
  // code papered over that twice: the route hashed
  // clickId|traderId|type|amount|dateTime into a synthetic id, and this module
  // fell back to a random UUID. Both are forbidden deduplication keys — the
  // hash collapses two legitimate same-amount deposits into one, and the UUID
  // makes every redelivery look new.
  //
  // So a monetary event that carries no provider identity is ACCEPTED,
  // VALIDATED and DURABLY RECORDED, but applies no accounting mutation and
  // triggers no progression. The ledger keeps the evidence; the totals stay
  // honest. When Pocket's transaction identifier is confirmed, supplying it is
  // the only change needed — the idempotency machinery below already works.
  if (isMonetaryPostbackEvent(normalizedEventType, eventType, amount) && !providerEventId) {
    const unidentified = await prisma.postbackEvent.create({
      data: {
        exchangeAccountId: exchangeAccount.id,
        externalEventId: null,
        type: type ?? normalizedEventType,
        eventType,
        normalizedEventType,
        externalAccountId: externalAccountLookup,
        traderId,
        clickId,
        amount,
        currency: data.currency,
        status: "not_processed",
        rawPayload: JSON.stringify(payload),
        payload,
        attribution,
        rejectionReason: PROVIDER_EVENT_IDENTITY_MISSING,
        processedAt: null,
      },
    });

    await createAuditLog({
      userId: exchangeAccount.userId,
      action: "EXCHANGE_POSTBACK_NOT_PROCESSED",
      entityType: "PostbackEvent",
      entityId: unidentified.id,
      metadata: {
        eventType,
        normalizedEventType,
        reason: PROVIDER_EVENT_IDENTITY_MISSING,
      },
      request,
    });

    return NextResponse.json(
      { ok: true, duplicate: false, processed: false, reason: PROVIDER_EVENT_IDENTITY_MISSING },
      { status: 202 },
    );
  }

  const provider = getExchangeProvider(
    exchangeAccount.provider === "real_placeholder" ? "manual" : exchangeAccount.provider,
  );
  const providerResult = await provider.processPostback({
    externalEventId: providerEventId,
    externalAccountId:
      externalAccountLookup ??
      exchangeAccount.externalAccountId ??
      exchangeAccount.exchangeAccountId,
    eventType,
    amount,
    payload,
  });

  // The receipt and the account mutation share one transaction, so a failed
  // mutation can never leave behind a receipt that marks the event processed,
  // and a committed receipt always means the mutation applied exactly once.
  // A concurrent duplicate loses the unique-constraint race here and its whole
  // transaction — including the account update — rolls back.
  const event = await prisma
    .$transaction(async (tx) => {
      const postback = await tx.postbackEvent.create({
        data: {
          exchangeAccountId: exchangeAccount.id,
          externalEventId: providerEventId,
          type: type ?? normalizedEventType,
          eventType,
          normalizedEventType,
          externalAccountId: externalAccountLookup,
          traderId,
          clickId,
          amount,
          currency: data.currency,
          status: data.status ?? "processed",
          rawPayload: JSON.stringify(payload),
          payload,
          attribution: {
            ...((exchangeAccount.attribution as Record<string, string> | null) ?? {}),
            ...(attribution as Record<string, string>),
          },
          rejectionReason: data.rejectionReason,
          processedAt: new Date(),
        },
      });

      await tx.exchangeAccount.update({
        where: { id: exchangeAccount.id },
        data: {
          ...buildPostbackAccountUpdate(
            normalizedEventType,
            eventType,
            amount,
            providerResult.message,
          ),
          traderId: traderId ?? exchangeAccount.traderId,
          clickId: clickId ?? exchangeAccount.clickId,
          attribution,
        },
      });

      return postback;
    })
    .catch((error: unknown) => {
      if (isUniqueConstraintViolation(error)) return null;
      throw error;
    });

  // Lost the race: the winning request already applied the mutation and will
  // run the progression side effects. Return the same deterministic duplicate
  // body the fast path returns, without mutating or progressing anything.
  if (!event) {
    // Only a NON-NULL provider event id can lose a unique-constraint race, so
    // this lookup is unreachable with null; the guard keeps that fact explicit
    // rather than relying on it.
    const winner = providerEventId
      ? await prisma.postbackEvent.findUnique({
          where: { externalEventId: providerEventId },
        })
      : null;

    if (winner && conflictsWithStoredEvent(winner, incomingFacts)) {
      return conflictResponse();
    }

    return NextResponse.json({
      ok: true,
      duplicate: true,
      postback: winner,
    });
  }

  if (normalizedEventType === "registration") {
    await completeProgressionTaskByCode(exchangeAccount.userId, "lvl_01_pocket_registration");
  }
  if (normalizedEventType === "first_deposit" || (eventType === "deposit" && amount > 0)) {
    await completeProgressionTaskByCode(exchangeAccount.userId, "lvl_04_any_deposit");
  }

  await createAuditLog({
    userId: exchangeAccount.userId,
    action: "POSTBACK_RECEIVED",
    entityType: "PostbackEvent",
    entityId: event.id,
    metadata: {
      type: event.type,
      eventType: event.eventType,
      normalizedEventType,
      amount: event.amount,
      externalEventId: providerEventId,
      attribution,
    },
    request,
  });

  if (eventType === "account_connected" || eventType === "account_rejected") {
    await notifyExchangeStatus({
      userId: exchangeAccount.userId,
      status: eventType === "account_connected" ? "connected" : "rejected",
      accountId: exchangeAccount.id,
      rejectionReason: providerResult.message,
      request,
    });
  } else {
    await createNotification({
      userId: exchangeAccount.userId,
      type: "postback_received",
      title: "Получено событие биржи",
      message: `Получен exchange postback: ${normalizedEventType}.`,
      metadata: {
        postbackId: event.id,
        eventType,
        normalizedEventType,
        amount: event.amount,
        externalEventId: providerEventId,
      },
      request,
    });
  }

  return NextResponse.json({
    ok: true,
    duplicate: false,
    postback: event,
  });
}
