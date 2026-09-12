import type { Prisma } from "@prisma/client";
import {
  POCKET_AFFILIATE_BASE_URL_KEY,
  POCKET_DYNAMIC_PARAM_NAMES,
  POCKET_LANDING_PARAM,
  POCKET_LANDING_VALUE,
  describePocketAffiliateUrlRejection,
  resolvePocketAffiliateUrl,
} from "@/lib/exchange/pocketAffiliateUrl";

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

/**
 * The validated external affiliate base URL.
 *
 * Fails closed on an absent *or* unusable value (POCKETCTA-1). Previously any
 * string `z.string().url()` accepted was handed straight to the learner, so
 * `http://`, a loopback host or an internal service port would have produced a
 * link that either stripped attribution or could not be opened at all. The
 * caller adds the learner's clickid to this base; it never edits it.
 */
export function getPocketReferralUrl() {
  const resolved = resolvePocketAffiliateUrl();

  if (resolved.kind === "absent") {
    throw new Error(`${POCKET_AFFILIATE_BASE_URL_KEY} is required`);
  }
  if (resolved.kind === "invalid") {
    throw new Error(describePocketAffiliateUrlRejection(resolved.reason, resolved.key));
  }

  return resolved.url;
}

/**
 * Build one learner's Pocket registration URL.
 *
 * Parses the configured base with the URL parser and adds ONLY the learner's
 * click-tracking parameters plus the system-owned `landing` — never by string
 * concatenation, which is what would let a `&` in configuration silently graft
 * one parameter onto another. `set` (not `append`) means each name appears
 * exactly once and the operator's own parameters, including `cid`, are left
 * untouched: none of the names written here collides with one of theirs.
 */
export function buildPocketReferralUrl(clickId: string): URL {
  const url = new URL(getPocketReferralUrl());

  for (const name of POCKET_DYNAMIC_PARAM_NAMES) {
    url.searchParams.set(name, clickId);
  }
  url.searchParams.set(POCKET_LANDING_PARAM, POCKET_LANDING_VALUE);

  return url;
}
