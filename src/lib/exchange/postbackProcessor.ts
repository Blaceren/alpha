import crypto from "node:crypto";
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

function buildPostbackAccountUpdate(
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

  if (normalizedEventType === "first_deposit") {
    return {
      status: "connected",
      firstDepositConfirmed: true,
      depositAmount: { increment: amount },
      totalDeposits: { increment: amount },
      balance: { increment: amount },
    };
  }

  if (normalizedEventType === "redeposit") {
    return {
      depositAmount: { increment: amount },
      totalDeposits: { increment: amount },
      balance: { increment: amount },
    };
  }

  if (normalizedEventType === "commission") {
    return { totalCommission: { increment: amount } };
  }

  if (eventType === "deposit") {
    return {
      depositAmount: { increment: amount },
      totalDeposits: { increment: amount },
      balance: { increment: amount },
    };
  }

  if (eventType === "trade") {
    return {
      tradesCount: { increment: 1 },
    };
  }

  if (normalizedEventType === "withdrawal" || normalizedEventType === "successful_withdrawal") {
    return {
      totalWithdrawals: { increment: amount },
      balance: { decrement: amount },
    };
  }

  if (eventType === "balance") {
    return { balance: amount };
  }

  if (eventType === "account_rejected") {
    return {
      status: "rejected",
      rejectionReason: message ?? "Exchange postback rejected the account.",
    };
  }

  return {};
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
  const eventId = data.externalEventId ?? `postback-${crypto.randomUUID()}`;
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

  if (data.externalEventId) {
    const existingEvent = await prisma.postbackEvent.findUnique({
      where: { externalEventId: data.externalEventId },
    });

    if (existingEvent) {
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
    const rejectedEvent = await prisma.postbackEvent.create({
      data: {
        exchangeAccountId: null,
        externalEventId: eventId,
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
    });

    await createAuditLog({
      action: "EXCHANGE_POSTBACK_REJECTED",
      entityType: "PostbackEvent",
      entityId: rejectedEvent.id,
      metadata: {
        eventType,
        normalizedEventType,
        externalEventId: eventId,
        traderId,
        clickId,
        reason: "Exchange account not found",
      },
      request,
    });

    return notFoundResponse("Биржевой аккаунт не найден");
  }

  const provider = getExchangeProvider(
    exchangeAccount.provider === "real_placeholder" ? "manual" : exchangeAccount.provider,
  );
  const providerResult = await provider.processPostback({
    externalEventId: eventId,
    externalAccountId:
      externalAccountLookup ??
      exchangeAccount.externalAccountId ??
      exchangeAccount.exchangeAccountId,
    eventType,
    amount,
    payload,
  });

  const event = await prisma.$transaction(async (tx) => {
    const postback = await tx.postbackEvent.create({
      data: {
        exchangeAccountId: exchangeAccount.id,
        externalEventId: eventId,
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
  });

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
      externalEventId: eventId,
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
        externalEventId: eventId,
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
