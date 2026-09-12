import { prisma } from "@/lib/prisma";

export type BalanceProviderId = "sandbox" | "manual" | "real_placeholder";

export type BalanceProviderResult = {
  ok: boolean;
  balance?: number;
  message?: string;
};

export interface ExchangeBalanceProvider {
  id: BalanceProviderId;
  getBalanceByTraderId(traderId: string): Promise<BalanceProviderResult>;
  parseBalanceResponse(text: string): BalanceProviderResult;
  verifyCheckpoint(userId: number, requiredBalance: number): Promise<BalanceProviderResult>;
}

function parseBalanceResponse(text: string): BalanceProviderResult {
  const match = text.replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  if (!match) {
    return { ok: false, message: "Не удалось распознать баланс" };
  }

  return { ok: true, balance: Number(match[1]) };
}

export const sandboxBalanceProvider: ExchangeBalanceProvider = {
  id: "sandbox",

  async getBalanceByTraderId(traderId) {
    const account = await prisma.exchangeAccount.findFirst({
      where: {
        OR: [
          { traderId },
          { externalAccountId: traderId },
          { exchangeAccountId: traderId },
        ],
      },
    });

    if (!account) {
      return { ok: false, message: "trader_id не найден" };
    }

    return { ok: true, balance: account.balance };
  },

  parseBalanceResponse,

  async verifyCheckpoint(userId, requiredBalance) {
    const account = await prisma.exchangeAccount.findUnique({
      where: { userId },
    });

    const traderId = account?.traderId;
    if (!traderId) {
      return { ok: false, message: "Для проверки нужен trader_id" };
    }

    const balanceResult = await this.getBalanceByTraderId(traderId);
    if (!balanceResult.ok || typeof balanceResult.balance !== "number") {
      return balanceResult;
    }

    return {
      ok: balanceResult.balance >= requiredBalance,
      balance: balanceResult.balance,
      message:
        balanceResult.balance >= requiredBalance
          ? "Контрольная точка пройдена"
          : "Восстановите баланс для продолжения",
    };
  },
};

export const realPlaceholderBalanceProvider: ExchangeBalanceProvider = {
  id: "real_placeholder",
  async getBalanceByTraderId() {
    return { ok: false, message: "Pocket Telegram bot provider is not implemented yet" };
  },
  parseBalanceResponse,
  async verifyCheckpoint() {
    return { ok: false, message: "Pocket Telegram bot provider is not implemented yet" };
  },
};

export function getBalanceProvider(id?: string | null): ExchangeBalanceProvider {
  if (id === "real_placeholder") return realPlaceholderBalanceProvider;
  return sandboxBalanceProvider;
}
