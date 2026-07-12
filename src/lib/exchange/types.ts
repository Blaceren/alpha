export type ExchangeProviderId = "sandbox" | "manual" | "real_placeholder";

export type ExchangeConnectionStatus =
  | "not_connected"
  | "pending"
  | "connected"
  | "rejected"
  | "blocked";

export type ExchangePostbackStatus =
  | "received"
  | "processed"
  | "duplicate"
  | "rejected";

export type ExchangeEventType =
  | "deposit"
  | "trade"
  | "balance"
  | "account_connected"
  | "account_rejected";

export type ExchangeVerificationResult = {
  status: ExchangeConnectionStatus;
  externalAccountId?: string;
  balance?: number;
  depositAmount?: number;
  tradesCount?: number;
  message?: string;
};

export interface ExchangeProvider {
  id: ExchangeProviderId;
  verifyConnection(input: {
    userId: string;
    externalAccountId?: string;
    email?: string;
  }): Promise<ExchangeVerificationResult>;

  processPostback(input: {
    externalEventId: string;
    externalAccountId: string;
    eventType: string;
    amount?: number;
    payload: unknown;
  }): Promise<ExchangeVerificationResult>;
}
