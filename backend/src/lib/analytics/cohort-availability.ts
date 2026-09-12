/**
 * AFD-5B2A — what an acquisition-cohort report can and cannot answer.
 *
 * WHY EVERY COHORT RESPONSE CARRIES THIS. The most dangerous number this API
 * could publish is a click-to-registration cohort rate, because it is the one an
 * affiliate manager most wants and the one the data cannot support. An absent
 * metric and a metric that is genuinely zero look identical on a chart, so each
 * absence is published WITH ITS REASON and never as a zero.
 */
import type { AvailabilityState } from "@/lib/analytics/availability";

const available: AvailabilityState = { available: true };
const unavailable = (reason: string): AvailabilityState => ({ available: false, reason });

export type CohortDataAvailability = {
  readonly registeredAcquisitionCohort: AvailabilityState;
  readonly pocketRegistration: AvailabilityState;
  readonly firstDeposit: AvailabilityState;
  readonly firstDepositAmountAggregation: AvailabilityState;
  readonly anonymousVisitorToRegistrationCohortRate: AvailabilityState;
  readonly unattributedAcquisitionCohort: AvailabilityState;
  readonly directTrafficCohort: AvailabilityState;
  readonly educationQuality: AvailabilityState;
  readonly redeposits: AvailabilityState;
  readonly currentBalance: AvailabilityState;
  readonly leadDrilldown: AvailabilityState;
  readonly maturityScoring: AvailabilityState;
  readonly forecasting: AvailabilityState;
};

export function buildCohortAvailability(input: {
  readonly amountAggregationAvailable: boolean;
  readonly amountUnavailableReason: string | null;
}): CohortDataAvailability {
  return {
    registeredAcquisitionCohort: available,
    pocketRegistration: available,
    firstDeposit: available,

    firstDepositAmountAggregation: input.amountAggregationAvailable
      ? available
      : unavailable(input.amountUnavailableReason ?? "currency_unspecified_or_mixed"),

    // THE CENTRAL LIMITATION OF THIS PHASE. `AffiliateAttribution` — and with it
    // `selectedClickId` — is written only on successful registration, so a
    // visitor who never registered has no frozen selected click. Choosing one
    // for them at query time would fabricate attribution and would produce a
    // different answer every time the report ran.
    anonymousVisitorToRegistrationCohortRate: unavailable(
      "unregistered_visitor_selected_attribution_not_frozen",
    ),

    unattributedAcquisitionCohort: unavailable("no_selected_acquisition_click"),

    // A direct learner has no acquisition click to be anchored to. Placing them
    // in a cohort by their REGISTRATION date would be a registration cohort
    // wearing an acquisition cohort's name. They remain fully reported by
    // AFD-5B1's event-date mode.
    directTrafficCohort: unavailable("acquisition_anchor_absent"),

    educationQuality: unavailable("authoritative_product_event_catalog_not_implemented"),

    // Pocket's deposit callback carries no transaction id, so a second deposit
    // is indistinguishable from a redelivery of the first.
    redeposits: unavailable("provider_transaction_identifier_missing"),
    currentBalance: unavailable("prohibited_not_collected"),

    // AFD-5B2B shipped the per-lead drilldown at
    // /api/crm/v1/affiliates/leads. Leaving "deferred_to_afd5b2b" here after
    // that would be a claim this file knows to be false.
    leadDrilldown: available,
    maturityScoring: unavailable("deferred_to_statistical_analyst_phase"),
    forecasting: unavailable("deferred_to_predictive_analytics_phase"),
  };
}

/**
 * The sentence a UI must show beside a cohort rate, carried in the payload so
 * the caveat cannot be lost when somebody builds a second client.
 */
export const COHORT_MODE_EXPLANATION =
  "Learners are selected by the date of their frozen selected acquisition click " +
  "and their later conversions are observed through the report cutoff. The " +
  "population is registered attributed learners only: an unregistered visitor " +
  "has no frozen selected attribution, so click-to-registration cohort " +
  "conversion is not measured. These rates describe observed conversion, not " +
  "causation, and are not a forecast.";

/** Why a cohort total and an event-date total for the same month differ. */
export const COHORT_VERSUS_EVENT_DATE_EXPLANATION =
  "Event-date mode counts each event on its own occurrence date. " +
  "Acquisition-cohort mode counts learners on their selected-click date and " +
  "follows them forward. The two modes answer different questions and their " +
  "totals for the same calendar period are not expected to match.";
