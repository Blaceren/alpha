import type { ExchangeAccount } from "@prisma/client";
import { createNotification } from "@/lib/notifications";
import type { FirstDepositConfirmation } from "@/lib/exchange/first-deposit-truth";

/**
 * FDCONF-1 — the resolved confirmation is a REQUIRED ARGUMENT, not an optional
 * one, and that is the whole enforcement mechanism.
 *
 * The serializer no longer has access to an answer of its own: it cannot read
 * `account.firstDepositConfirmed` into the response because doing so is what
 * produced the drift. Making the parameter required means a call site that has
 * not consulted `resolveFirstDepositConfirmation` FAILS TO COMPILE rather than
 * silently serving the legacy column — the same "unrepresentable rather than
 * unlikely" bar the commercial owners are held to.
 */
export function serializeExchangeAccount(
  account: ExchangeAccount & {
    user?: { id: number; name: string; email: string } | null;
  },
  firstDeposit: FirstDepositConfirmation,
) {
  return {
    id: account.id,
    userId: account.userId,
    user: account.user
      ? {
          id: account.user.id,
          name: account.user.name,
          email: account.user.email,
        }
      : undefined,
    provider: account.provider,
    referralLink: account.referralLink,
    exchangeAccountId: account.exchangeAccountId,
    externalAccountId: account.externalAccountId,
    traderId: account.traderId,
    clickId: account.clickId,
    attribution: account.attribution,
    status: account.status,
    registrationStatus: account.registrationStatus,
    emailConfirmed: account.emailConfirmed,
    // FDCONF-1: the PRODUCT answer, from the canonical ledger where it has one.
    // The raw legacy column is deliberately not serialised anywhere.
    firstDepositConfirmed: firstDeposit.confirmed,
    firstDepositConfirmedSource: firstDeposit.source,
    firstDepositConfirmedAt: firstDeposit.occurredAt,
    // DEVMECH-1: `balance` is a CURRENT TRADING BALANCE and is never
    // serialised. `totalDeposits` below is historical transaction
    // accounting, which is a different fact and is intentionally kept.
    depositAmount: account.depositAmount,
    tradesCount: account.tradesCount,
    totalDeposits: account.totalDeposits,
    totalWithdrawals: account.totalWithdrawals,
    totalCommission: account.totalCommission,
    lastVerifiedAt: account.lastVerifiedAt,
    verifiedAt: account.verifiedAt,
    rejectionReason: account.rejectionReason,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export function notifyExchangeStatus(input: {
  userId: number;
  status: string;
  accountId: number;
  rejectionReason?: string | null;
  request?: Request;
}) {
  if (input.status === "connected") {
    return createNotification({
      userId: input.userId,
      type: "exchange_connected",
      title: "Биржевой аккаунт подключён",
      message: "Биржевой аккаунт успешно подключён.",
      metadata: { exchangeAccountId: input.accountId },
      request: input.request,
    });
  }

  if (input.status === "rejected") {
    return createNotification({
      userId: input.userId,
      type: "exchange_rejected",
      title: "Биржевой аккаунт отклонён",
      message: input.rejectionReason || "Биржевой аккаунт не прошёл проверку.",
      metadata: {
        exchangeAccountId: input.accountId,
        rejectionReason: input.rejectionReason ?? null,
      },
      request: input.request,
    });
  }

  if (input.status === "blocked") {
    return createNotification({
      userId: input.userId,
      type: "exchange_blocked",
      title: "Биржевой аккаунт заблокирован",
      message: input.rejectionReason || "Биржевой аккаунт заблокирован администратором.",
      metadata: {
        exchangeAccountId: input.accountId,
        rejectionReason: input.rejectionReason ?? null,
      },
      request: input.request,
    });
  }

  return null;
}
