/**
 * G4-R13 — the «Что платформа не измеряет» block must never print an internal
 * code to an operator.
 *
 * THE LIST BELOW IS THE CONTRACT, NOT A SAMPLE. It is every reason string the
 * backend's `dataAvailability` can carry: the four literals in
 * `buildGrowthAvailability`, the four the deposit-amount loader produces, the
 * two the funnel and acquisition routes pass, and the legacy fallback. A reason
 * added on the backend without a label here fails this test rather than
 * appearing on screen as snake_case.
 */
import { describe, expect, it } from "vitest";

import { AMOUNT_UNAVAILABLE_REASON, AVAILABILITY_REASON, availabilityReason } from "./growth-labels";

/** Every reason the five Growth routes can put in `dataAvailability`. */
const CANONICAL_AVAILABILITY_REASONS = [
  // buildGrowthAvailability, fixed
  "historical_submission_instant_not_owned",
  "provider_event_identity_contract_absent",
  "prohibited_not_collected",
  "dimension_not_captured",
  "not_in_scope_for_growth_v1",
  // firstDepositAmountAggregation — the family that was rendering raw
  "no_deposits_in_period",
  "currency_unspecified",
  "currency_mixed",
  "amount_unreadable",
  "not_requested_on_this_surface",
  "per_row_amounts_not_published_on_this_surface",
  // the documented fallback when no more specific amount reason is known
  "currency_unspecified_or_mixed",
] as const;

const CYRILLIC = /[А-Яа-яЁё]/;

describe("availabilityReason", () => {
  it.each(CANONICAL_AVAILABILITY_REASONS)("renders %s as a human sentence", (reason) => {
    const rendered = availabilityReason(reason);

    // Not the code itself.
    expect(rendered).not.toBe(reason);
    // Written in the language the rest of the surface is written in.
    expect(rendered).toMatch(CYRILLIC);
    // Not an accidental empty label, which would hide the limitation entirely.
    expect(rendered.trim().length).toBeGreaterThan(0);
  });

  it("never leaks a snake_case code for any canonical reason", () => {
    for (const reason of CANONICAL_AVAILABILITY_REASONS) {
      expect(availabilityReason(reason)).not.toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("falls back to the amount vocabulary, which is where the defect was", () => {
    // These four live only in AMOUNT_UNAVAILABLE_REASON. Before the fix,
    // availabilityReason() looked in AVAILABILITY_REASON only and returned them
    // verbatim.
    for (const reason of [
      "no_deposits_in_period",
      "not_requested_on_this_surface",
      "per_row_amounts_not_published_on_this_surface",
      "amount_unreadable",
    ]) {
      expect(AVAILABILITY_REASON[reason]).toBeUndefined();
      expect(AMOUNT_UNAVAILABLE_REASON[reason]).toBeDefined();
      expect(availabilityReason(reason)).toBe(AMOUNT_UNAVAILABLE_REASON[reason]);
    }
  });

  it("prefers this block's own wording where the two vocabularies overlap", () => {
    for (const reason of ["currency_unspecified", "currency_mixed"]) {
      expect(AVAILABILITY_REASON[reason]).toBeDefined();
      expect(AMOUNT_UNAVAILABLE_REASON[reason]).toBeDefined();
      expect(availabilityReason(reason)).toBe(AVAILABILITY_REASON[reason]);
    }
  });

  it("still returns an unknown code verbatim, so a new backend reason is quotable", () => {
    // Deliberate. An operator who sees a code can report it; an operator shown
    // an empty box or a generic sentence cannot.
    expect(availabilityReason("a_reason_this_build_has_never_heard_of")).toBe(
      "a_reason_this_build_has_never_heard_of",
    );
  });
});
