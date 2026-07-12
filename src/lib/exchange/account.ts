import type { ExchangeAccount } from "@prisma/client";
import { createNotification } from "@/lib/notifications";

export function serializeExchangeAccount(
  account: ExchangeAccount & {
    user?: { id: number; name: string; email: string } | null;
  },
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
    firstDepositConfirmed: account.firstDepositConfirmed,
    balance: account.balance,
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
