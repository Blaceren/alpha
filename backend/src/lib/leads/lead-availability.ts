/**
 * AFD-5B2B — what one lead's record can and cannot answer, said out loud.
 *
 * NOTHING UNAVAILABLE IS EVER RENDERED AS ZERO, AN EMPTY ARRAY OR A NULL WITH
 * NO REASON. "No redeposits" and "we do not count redeposits" render
 * identically once they reach a drawer, and only one of them is true. Every
 * absence below therefore travels with the reason it is absent.
 */
import type { AvailabilityState } from "@/lib/analytics/availability";
import type { LeadDepositState } from "@/lib/leads/lead-state";

const available: AvailabilityState = { available: true };
const unavailable = (reason: string): AvailabilityState => ({ available: false, reason });

/**
 * The first deposit is the one dimension with FOUR outcomes rather than two,
 * because "not yet" and "we cannot say whose it is" and "it disagreed with
 * itself" are three different absences an operator must act on differently.
 */
export type LeadDepositAvailability =
  | { readonly state: "available" }
  | { readonly state: "pending"; readonly reason: string }
  | { readonly state: "conflict"; readonly reason: string }
  | { readonly state: "absent"; readonly reason: string };

export type LeadDataAvailability = {
  readonly acquisition: AvailabilityState;
  readonly academyRegistration: AvailabilityState;
  readonly pocketRegistration: AvailabilityState;
  readonly firstDeposit: LeadDepositAvailability;
  readonly redeposit: AvailabilityState;
  readonly currentBalance: AvailabilityState;
  readonly educationTimeline: AvailabilityState;
  readonly trafficSubParameters: AvailabilityState;
};

export function buildLeadDataAvailability(input: {
  readonly attributed: boolean;
  readonly pocketRegistered: boolean;
  readonly depositState: LeadDepositState;
}): LeadDataAvailability {
  return {
    // A direct lead's acquisition is not MISSING — it is known to be absent,
    // which is a stronger statement and a different one.
    acquisition: input.attributed ? available : unavailable("direct_registration"),

    // Always available: the academy_registration event is what makes this a
    // lead, so a lead with no such event cannot be reached by this API.
    academyRegistration: available,

    pocketRegistration: input.pocketRegistered
      ? available
      : unavailable("trusted_pocket_identity_absent"),

    firstDeposit:
      input.depositState === "confirmed"
        ? { state: "available" }
        : input.depositState === "pending_identity"
          ? { state: "pending", reason: "provider_identity_not_yet_reconciled" }
          : input.depositState === "conflict"
            ? { state: "conflict", reason: "provider_delivery_disagreed" }
            : { state: "absent", reason: "no_provider_deposit_event" },

    // Pocket's deposit callback carries no transaction id, no event id and no
    // occurrence time, so a second deposit is indistinguishable from a
    // redelivery of the first. AFD-4 refused to invent the distinction and this
    // phase does not resurrect it.
    redeposit: unavailable("provider_transaction_identifier_missing"),

    // PVA-1: Pocket exposes no official balance API and ExchangeAccount.balance
    // carries no trading P&L. Never collected, so never reported.
    currentBalance: unavailable("prohibited_not_collected"),

    educationTimeline: unavailable("authoritative_product_event_catalog_not_implemented"),

    // sub1..sub5 are affiliate-supplied acquisition metadata. They exist on
    // AffiliateClick and are deliberately not projected by this phase — see
    // PRODUCT-ANALYTICS-1 in the handoff.
    trafficSubParameters: unavailable("sensitive_acquisition_metadata_not_exposed"),
  };
}
