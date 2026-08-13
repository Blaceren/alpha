/**
 * G4-GROWTH — what these Growth surfaces can and cannot answer, said out loud.
 *
 * WHY EVERY RESPONSE CARRIES THIS. An absent metric and a metric that is
 * genuinely zero look identical once they reach a chart. "0 redeposits" reads as
 * "nobody deposited twice"; the truth is that Pocket sends no event identifier,
 * so ATA cannot tell a second deposit from a redelivery of the first and
 * therefore refuses to count them at all. Publishing the reason beside the
 * absence is what stops a false negative becoming a business decision.
 *
 * NOTHING UNAVAILABLE IS EVER RENDERED AS ZERO by this API. This block is the
 * mechanism, and §60 is the rule it implements.
 */

export type GrowthAvailabilityState =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string };

const available: GrowthAvailabilityState = { available: true };
const unavailable = (reason: string): GrowthAvailabilityState => ({ available: false, reason });

export type GrowthDataAvailability = {
  readonly trafficClicks: GrowthAvailabilityState;
  readonly ataRegistrations: GrowthAvailabilityState;
  readonly enrollments: GrowthAvailabilityState;
  readonly academyActivation: GrowthAvailabilityState;
  readonly educationProgression: GrowthAvailabilityState;
  readonly mentorReviewSubmissions: GrowthAvailabilityState;
  readonly pocketRegistrations: GrowthAvailabilityState;
  readonly firstDeposits: GrowthAvailabilityState;
  readonly firstDepositAmountAggregation: GrowthAvailabilityState;
  readonly redeposits: GrowthAvailabilityState;
  readonly currentBalance: GrowthAvailabilityState;
  readonly acquisitionCreativeDimensions: GrowthAvailabilityState;
  readonly cpaAndCommission: GrowthAvailabilityState;
};

export function buildGrowthAvailability(input: {
  readonly amountAggregationAvailable: boolean;
  readonly amountUnavailableReason: string | null;
}): GrowthDataAvailability {
  return {
    trafficClicks: available,
    ataRegistrations: available,
    enrollments: available,
    academyActivation: available,

    // The gap the accepted AFD-5B1 availability block named as
    // `authoritative_product_event_catalog_not_implemented`. Migration 47 built
    // that catalog and backfilled it from the owner tables, so it is now
    // answerable for history as well as for new events.
    educationProgression: available,

    // Entering `pending_review` overwrites `lastProgressAt`, and a later action
    // overwrites it again — so for a level that has since been approved, the
    // instant the learner submitted is not recorded anywhere and was not
    // invented by the backfill. New submissions are captured exactly.
    mentorReviewSubmissions: unavailable("historical_submission_instant_not_owned"),

    pocketRegistrations: available,
    firstDeposits: available,

    firstDepositAmountAggregation: input.amountAggregationAvailable
      ? available
      : unavailable(input.amountUnavailableReason ?? "currency_unspecified_or_mixed"),

    // The G4 safety boundary. Typed ingress, evidence and amounts are all
    // implemented — what is missing is a PROVIDER contract, not ATA code. The
    // unresolved deliveries are reported as their own operational count so the
    // absence is visible rather than merely stated.
    redeposits: unavailable("provider_event_identity_contract_absent"),

    // Never collected. Pocket exposes no official balance API and
    // `ExchangeAccount.balance` carries no trading P&L.
    currentBalance: unavailable("prohibited_not_collected"),

    // The tracking-link model records partner, campaign, link and sub1..5. It
    // has no creative, angle or landing-variant columns, so those dimensions are
    // not offered — an always-"Unknown" filter would imply a capability that
    // does not exist.
    acquisitionCreativeDimensions: unavailable("dimension_not_captured"),

    // Deliberately out of scope for this phase. A deposit amount is not a
    // commission, and the ledger keeps them separable precisely so a later
    // phase can add CPA without redefining what a deposit is.
    cpaAndCommission: unavailable("not_in_scope_for_growth_v1"),
  };
}

/** The sentence a UI must show beside any ratio, carried in the payload. */
export const GROWTH_RATE_MODE_EXPLANATION =
  "Numerators and denominators are events occurring in the selected period and " +
  "may belong to different acquisition cohorts. A ratio is null, never zero, " +
  "when its denominator is zero.";

/** How the acquisition dimension relates an event to a campaign. */
export const GROWTH_ATTRIBUTION_EXPLANATION =
  "Events are sliced by the learner's FROZEN acquisition attribution, decided " +
  "once at registration under the last_eligible_affiliate_click model. A later " +
  "click never re-attributes an existing learner.";
