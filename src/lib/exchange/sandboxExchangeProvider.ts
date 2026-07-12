import type {
  ExchangeEventType,
  ExchangeProvider,
  ExchangeVerificationResult,
} from "@/lib/exchange/types";

function isRejectedValue(value?: string) {
  return Boolean(value && /reject|invalid|blocked|bad/i.test(value));
}

export const sandboxExchangeProvider: ExchangeProvider = {
  id: "sandbox",

  async verifyConnection(input): Promise<ExchangeVerificationResult> {
    const externalAccountId = input.externalAccountId?.trim();
    const email = input.email?.trim();

    if (isRejectedValue(externalAccountId) || isRejectedValue(email)) {
      return {
        status: "rejected",
        externalAccountId,
        message: "Sandbox provider rejected this account identifier.",
      };
    }

    if (!externalAccountId && !email) {
      return {
        status: "rejected",
        message: "External account id or email is required.",
      };
    }

    return {
      status: "connected",
      externalAccountId: externalAccountId || `sandbox-${input.userId}`,
      balance: 500,
      depositAmount: 500,
      tradesCount: 0,
      message: "Sandbox exchange account connected.",
    };
  },

  async processPostback(input): Promise<ExchangeVerificationResult> {
    const eventType = input.eventType as ExchangeEventType;

    if (eventType === "account_rejected") {
      return {
        status: "rejected",
        externalAccountId: input.externalAccountId,
        message: "Sandbox postback rejected the account.",
      };
    }

    if (eventType === "account_connected") {
      return {
        status: "connected",
        externalAccountId: input.externalAccountId,
        message: "Sandbox postback connected the account.",
      };
    }

    return {
      status: "connected",
      externalAccountId: input.externalAccountId,
      balance: eventType === "balance" ? (input.amount ?? 0) : undefined,
      depositAmount: eventType === "deposit" ? (input.amount ?? 0) : undefined,
      tradesCount: eventType === "trade" ? 1 : undefined,
    };
  },
};
