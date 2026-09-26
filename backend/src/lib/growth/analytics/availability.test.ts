/**
 * G4-R12 — the availability block must declare the registration figure's scope
 * without changing the figure, and without changing the shape any existing
 * reader depends on.
 *
 * The additive-ness is the property under test as much as the disclosure is: a
 * consumer written against the two-state contract must keep parsing every
 * response this function can produce.
 */
import { describe, expect, it } from "vitest";

import { buildGrowthAvailability } from "./availability";

const AMOUNTS_AVAILABLE = {
  amountAggregationAvailable: true,
  amountUnavailableReason: null,
} as const;

describe("buildGrowthAvailability — registration origin coverage", () => {
  it("declares the scope when some accounts have no provable origin", () => {
    const availability = buildGrowthAvailability({
      ...AMOUNTS_AVAILABLE,
      registrationOriginCoverage: {
        population: 45,
        provable: 12,
        unprovableStaff: 12,
        unprovableOther: 21,
      },
    });

    expect(availability.ataRegistrations.available).toBe(true);
    expect(availability.ataRegistrations).toEqual({
      available: true,
      scope: {
        provable: 12,
        population: 45,
        unprovableStaff: 12,
        unprovableOther: 21,
        basis: "positive_registration_authority",
      },
    });
  });

  it("stays a plain available state when every account is provable", () => {
    // Nothing to disclose. A caveat that is always present is one nobody reads,
    // and it would imply a limitation that does not exist on that population.
    const availability = buildGrowthAvailability({
      ...AMOUNTS_AVAILABLE,
      registrationOriginCoverage: {
        population: 12,
        provable: 12,
        unprovableStaff: 0,
        unprovableOther: 0,
      },
    });

    expect(availability.ataRegistrations).toEqual({ available: true });
  });

  it("emits the pre-existing shape when no coverage is supplied", () => {
    const availability = buildGrowthAvailability(AMOUNTS_AVAILABLE);

    expect(availability.ataRegistrations).toEqual({ available: true });
  });

  it("NEVER files the registration count as unavailable", () => {
    // The metric is canonical and exact. Moving it into "what the platform does
    // not measure" would be a worse untruth than the missing disclosure was.
    for (const coverage of [
      { population: 45, provable: 12, unprovableStaff: 12, unprovableOther: 21 },
      { population: 1000, provable: 1, unprovableStaff: 0, unprovableOther: 999 },
      { population: 0, provable: 0, unprovableStaff: 0, unprovableOther: 0 },
    ]) {
      const availability = buildGrowthAvailability({
        ...AMOUNTS_AVAILABLE,
        registrationOriginCoverage: coverage,
      });
      expect(availability.ataRegistrations.available).toBe(true);
    }
  });

  it("leaves every other capability's state untouched", () => {
    const withScope = buildGrowthAvailability({
      ...AMOUNTS_AVAILABLE,
      registrationOriginCoverage: {
        population: 45,
        provable: 12,
        unprovableStaff: 12,
        unprovableOther: 21,
      },
    });
    const without = buildGrowthAvailability(AMOUNTS_AVAILABLE);

    for (const key of Object.keys(without) as Array<keyof typeof without>) {
      if (key === "ataRegistrations") continue;
      expect(withScope[key]).toEqual(without[key]);
    }
  });

  it("keeps the unavailable states carrying a reason and no scope", () => {
    const availability = buildGrowthAvailability({
      amountAggregationAvailable: false,
      amountUnavailableReason: "no_deposits_in_period",
    });

    // RDEP-AVAIL-1. A caller that has not resolved the capability says exactly
    // that, rather than repeating the superseded provider-contract reason.
    expect(availability.redeposits).toEqual({
      available: false,
      reason: "redeposit_capability_not_resolved",
    });
    expect(availability.firstDepositAmountAggregation).toEqual({
      available: false,
      reason: "no_deposits_in_period",
    });
  });
});
