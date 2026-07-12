import type { Prisma } from "@prisma/client";

export const pocketPostbackTypes = [
  "Registration",
  "Email Confirmation",
  "First Deposit",
  "Re-deposit",
  "Withdrawal",
  "Commission",
  "New Withdrawal",
  "Canceled Withdrawal",
  "Successful Withdrawal",
] as const;

export type PocketPostbackType = (typeof pocketPostbackTypes)[number];

const attributionKeys = [
  "click_id",
  "site_id",
  "trader_id",
  "cid",
  "ac",
  "sub_id1",
  "sub_id2",
  "sub_id3",
  "sub_id4",
  "sub_id5",
  "country",
  "promo",
  "device_type",
  "os_version",
  "browser",
  "link_type",
  "date_time",
  "visitor_id",
  "country_ip",
] as const;

export function normalizePocketEvent(type?: string, eventType?: string) {
  if (eventType) return eventType;
  if (type === "Registration") return "registration";
  if (type === "Email Confirmation") return "email_confirmation";
  if (type === "First Deposit") return "first_deposit";
  if (type === "Re-deposit") return "redeposit";
  if (type === "Commission") return "commission";
  if (type === "Withdrawal") return "withdrawal";
  if (type === "New Withdrawal") return "new_withdrawal";
  if (type === "Canceled Withdrawal") return "canceled_withdrawal";
  if (type === "Successful Withdrawal") return "successful_withdrawal";
  return "unknown";
}

export function pocketEventToExchangeEvent(normalizedEventType: string) {
  if (
    normalizedEventType === "deposit" ||
    normalizedEventType === "trade" ||
    normalizedEventType === "balance" ||
    normalizedEventType === "account_connected" ||
    normalizedEventType === "account_rejected"
  ) {
    return normalizedEventType;
  }

  if (normalizedEventType === "registration" || normalizedEventType === "email_confirmation") {
    return "account_connected";
  }

  if (normalizedEventType === "first_deposit" || normalizedEventType === "redeposit" || normalizedEventType === "commission") {
    return "deposit";
  }

  if (
    normalizedEventType === "withdrawal" ||
    normalizedEventType === "new_withdrawal" ||
    normalizedEventType === "canceled_withdrawal" ||
    normalizedEventType === "successful_withdrawal"
  ) {
    return "balance";
  }

  return "account_rejected";
}

export function extractPocketAttribution(payload: Record<string, unknown>) {
  const attribution: Record<string, string> = {};

  for (const key of attributionKeys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      attribution[key] = value.trim();
    }
  }

  return attribution as Prisma.InputJsonObject;
}

export function getPocketTraderId(payload: Record<string, unknown>) {
  const traderId = payload.trader_id ?? payload.traderId ?? payload.externalAccountId ?? payload.externalUserId;
  return typeof traderId === "string" ? traderId : undefined;
}

export function getPocketClickId(payload: Record<string, unknown>) {
  const clickId = payload.click_id ?? payload.clickId;
  return typeof clickId === "string" ? clickId : undefined;
}

export function getPocketReferralUrl() {
  const referralUrl = process.env.POCKET_AFFILIATE_BASE_URL ?? process.env.POCKET_REFERRAL_URL;

  if (!referralUrl) {
    throw new Error("POCKET_AFFILIATE_BASE_URL is required");
  }

  return referralUrl;
}
