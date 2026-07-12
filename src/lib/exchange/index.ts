import { sandboxExchangeProvider } from "@/lib/exchange/sandboxExchangeProvider";
import type {
  ExchangeConnectionStatus,
  ExchangeEventType,
  ExchangeProvider,
  ExchangeProviderId,
} from "@/lib/exchange/types";

const providers: Record<ExchangeProviderId, ExchangeProvider | null> = {
  sandbox: sandboxExchangeProvider,
  manual: sandboxExchangeProvider,
  real_placeholder: null,
};

export function getExchangeProvider(providerId: string | null | undefined) {
  const id = parseExchangeProviderId(providerId);
  const provider = providers[id];

  if (!provider) {
    throw new Error(`Exchange provider ${id} is not implemented yet`);
  }

  return provider;
}

export function parseExchangeProviderId(value?: string | null): ExchangeProviderId {
  if (value === "manual" || value === "real_placeholder" || value === "sandbox") {
    return value;
  }

  return "sandbox";
}

export function isExchangeStatus(value: string): value is ExchangeConnectionStatus {
  return [
    "not_connected",
    "pending",
    "connected",
    "rejected",
    "blocked",
  ].includes(value);
}

export function isExchangeEventType(value: string): value is ExchangeEventType {
  return [
    "deposit",
    "trade",
    "balance",
    "account_connected",
    "account_rejected",
  ].includes(value);
}

export type {
  ExchangeConnectionStatus,
  ExchangeEventType,
  ExchangePostbackStatus,
  ExchangeProvider,
  ExchangeProviderId,
  ExchangeVerificationResult,
} from "@/lib/exchange/types";
