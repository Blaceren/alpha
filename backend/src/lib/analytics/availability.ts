/**
 * AFD-5B1 — what this deployment can and cannot answer, said out loud.
 *
 * WHY EVERY RESPONSE CARRIES THIS. An absent metric and a metric that is
 * genuinely zero look identical once they reach a chart. "0 redeposits" would be
 * read as "nobody deposited twice"; the truth is that Pocket sends no
 * transaction identifier, so ATA cannot tell a second deposit from a redelivery
 * of the first and therefore does not count redeposits at all. Publishing the
 * reason next to the absence is what stops a false negative becoming a business
 * conclusion.
 *
 * NOTHING UNAVAILABLE IS EVER RENDERED AS ZERO by this API.
 */

export type AvailabilityState =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

const available: AvailabilityState = { available: true };
const unavailable = (reason: string): AvailabilityState => ({ available: false, reason });

export type DataAvailability = {
  readonly trafficClicks: AvailabilityState;
  readonly academyRegistrations: AvailabilityState;
  readonly pocketRegistrations: AvailabilityState;
  readonly firstDeposits: AvailabilityState;
  readonly firstDepositAmountAggregation: AvailabilityState;
  readonly redeposits: AvailabilityState;
  readonly currentBalance: AvailabilityState;
  readonly educationQuality: AvailabilityState;
  readonly acquisitionCohortMode: AvailabilityState;
  readonly leadDrilldown: AvailabilityState;
};

/**
 * Build the availability block for one response.
 *
 * The first four are `available` because AFD-3B2, AFD-4 and the L4PA-1 identity
 * binding each shipped a proven authoritative owner — see affiliate-sources.ts,
 * which names the exact table and column for every one of them.
 */
export function buildDataAvailability(input: {
  readonly amountAggregationAvailable: boolean;
  readonly amountUnavailableReason: string | null;
}): DataAvailability {
  return {
    trafficClicks: available,
    academyRegistrations: available,

    // Proven in AFD-5B1: PocketTraderIdentity.boundAt, written once by the
    // trusted goal=reg binder, with `source` constrained by the database.
    pocketRegistrations: available,

    // AFD-4 shipped the first_deposit conversion source.
    firstDeposits: available,

    firstDepositAmountAggregation: input.amountAggregationAvailable
      ? available
      : unavailable(input.amountUnavailableReason ?? "currency_unspecified_or_mixed"),

    // Pocket's deposit callback carries no transaction id, no event id and no
    // occurrence time, so a second deposit is indistinguishable from a redelivery
    // of the first. AFD-4 refused to invent the distinction and so does this.
    redeposits: unavailable("provider_transaction_identifier_missing"),

    // Never collected. PVA-1 established Pocket exposes no official balance API,
    // and ExchangeAccount.balance carries no trading P&L.
    currentBalance: unavailable("prohibited_not_collected"),

    educationQuality: unavailable("authoritative_product_event_catalog_not_implemented"),

    // AFD-5B2A shipped it. An event-date response still says so, because a
    // client reading only this block must be able to discover that the cohort
    // question is answerable elsewhere — and because leaving a stale
    // "deferred" here would be this file publishing a claim it knows is false.
    // The cohort routes have their own availability block; this one only
    // reports that the MODE exists.
    acquisitionCohortMode: available,

    // AFD-5B2B shipped it, for exactly the reason stated above: a stale
    // "deferred_to_afd5b2b" would be this file publishing a claim it knows is
    // false, and a client reading only this block must be able to discover that
    // per-lead questions are answerable at /api/crm/v1/affiliates/leads.
    leadDrilldown: available,
  };
}

/**
 * The sentence a UI should show beside any ratio, carried in the payload so the
 * caveat cannot be lost when someone builds a second client.
 */
export const RATE_MODE_EXPLANATION =
  "Numerators and denominators are events occurring in the selected period and " +
  "may belong to different acquisition cohorts.";

/** Why period uniques are not the sum of bucket uniques. */
export const UNIQUE_VISITOR_EXPLANATION =
  "periodUniqueVisitors is computed once across the whole period. Bucket " +
  "uniqueVisitors values are per-bucket distinct counts and do not sum to it, " +
  "because one visitor may click in several buckets.";
