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

/**
 * G4-R12 — the scope an AVAILABLE metric was computed over.
 *
 * A third state, added ADDITIVELY. `{available:true}` and
 * `{available:false,reason}` keep their exact meanings and their exact shapes,
 * so every existing reader keeps working and no consumer has to learn a new
 * contract to stay correct. What this adds is the case the block could not
 * express before: a metric that IS measured, exactly, over a population smaller
 * than the reader assumes.
 *
 * DELIBERATELY NOT `available:false`. Filing a canonical, exact metric under
 * "what the platform does not measure" would be a worse lie than saying nothing
 * — it measures it, and the number is right.
 */
export type GrowthAvailabilityScope = {
  /** Rows the metric can prove. */
  readonly provable: number;
  /** Rows that exist in the owner population. */
  readonly population: number;
  /** Unprovable rows a staff profile explains. */
  readonly unprovableStaff: number;
  /** Unprovable rows with no explanation — origin is genuinely unknown. */
  readonly unprovableOther: number;
  /** How provability was decided. Named, not described, so it cannot drift. */
  readonly basis: "positive_registration_authority";
};

import type { RedepositCapability } from "@/lib/growth/ingress-config";

export type GrowthAvailabilityState =
  | { readonly available: true }
  | { readonly available: true; readonly scope: GrowthAvailabilityScope }
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
  /**
   * G4-R12. Optional so a surface that has not loaded it still emits the exact
   * shape it emitted before — the field is additive, not required.
   */
  readonly registrationOriginCoverage?: {
    readonly population: number;
    readonly provable: number;
    readonly unprovableStaff: number;
    readonly unprovableOther: number;
  };
  /**
   * RDEP-AVAIL-1. The accepted redeposit capability, resolved by the caller from
   * `resolveRedepositCapability`.
   *
   * OPTIONAL, BUT OMITTING IT NEVER PRODUCES A CLAIM. A caller that has not
   * resolved it yields `redeposit_capability_not_resolved` — "this surface did
   * not determine it" — which is true. What it can never yield is the superseded
   * provider-contract reason, or a false `available`.
   */
  readonly redepositCapability?: RedepositCapability;
}): GrowthDataAvailability {
  const coverage = input.registrationOriginCoverage;

  return {
    trafficClicks: available,

    // The registration count is exact and canonical. What the reader could not
    // see is that it covers accounts with a PROVABLE registration record, which
    // on a database with pre-audit or operator-created accounts is fewer than
    // the accounts that exist. Declared only when it is actually a limitation:
    // on a population where every account is provable there is nothing to warn
    // about, and an always-present caveat is one nobody reads.
    ataRegistrations:
      coverage && coverage.provable < coverage.population
        ? {
            available: true,
            scope: {
              provable: coverage.provable,
              population: coverage.population,
              unprovableStaff: coverage.unprovableStaff,
              unprovableOther: coverage.unprovableOther,
              basis: "positive_registration_authority",
            },
          }
        : available,

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

    // RDEP-AVAIL-1 — DERIVED FROM THE ACCEPTED CAPABILITY, NEVER HARD-CODED.
    //
    // This line used to read
    //   unavailable("provider_event_identity_contract_absent")
    // unconditionally, on the reasoning that "what is missing is a PROVIDER
    // contract, not ATA code". That reasoning is superseded: ATA derives its own
    // deterministic redeposit identity from the authenticated provider
    // attributes, so nothing is missing from the provider. Shipping the old
    // sentence into RDEP activation would have told operators the platform
    // cannot count redeposits at the moment it started counting them — an
    // availability surface exists to be believed, so a stale reason there is
    // worse than silence.
    //
    // It is equally NOT hard-coded to `available`: with RDEP switched off, or
    // the master gate closed, the honest answer is that it is off, and that is
    // what the resolver returns.
    redeposits:
      input.redepositCapability === undefined
        ? unavailable("redeposit_capability_not_resolved")
        : input.redepositCapability.kind === "available"
          ? available
          : unavailable(input.redepositCapability.reason),

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
