/**
 * The two operator-facing corrections, asserted where the operator actually
 * meets them: rendered output.
 *
 * The label map is unit-tested next door. This file asserts the components that
 * consume it — because G4-R13 was not a missing translation, it was a component
 * reading the wrong map, and a test of the map alone would have passed while the
 * screen still printed `no_deposits_in_period`.
 *
 * The availability payload below is the EXACT `dataAvailability` block a live
 * PREPROD `/growth/overview` returns, captured from the candidate backend.
 */
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { AvailabilityList, GrowthMetric } from "./growth-primitives";
import { registrationScopeHint } from "./growth-labels";

/** Captured from the candidate backend against a copy of live PREPROD. */
const LIVE_AVAILABILITY = {
  trafficClicks: { available: true },
  ataRegistrations: {
    available: true,
    scope: {
      provable: 12,
      population: 45,
      unprovableStaff: 12,
      unprovableOther: 21,
      basis: "positive_registration_authority",
    },
  },
  enrollments: { available: true },
  academyActivation: { available: true },
  educationProgression: { available: true },
  mentorReviewSubmissions: {
    available: false,
    reason: "historical_submission_instant_not_owned",
  },
  pocketRegistrations: { available: true },
  firstDeposits: { available: true },
  firstDepositAmountAggregation: { available: false, reason: "no_deposits_in_period" },
  redeposits: { available: false, reason: "provider_event_identity_contract_absent" },
  currentBalance: { available: false, reason: "prohibited_not_collected" },
  acquisitionCreativeDimensions: { available: false, reason: "dimension_not_captured" },
  cpaAndCommission: { available: false, reason: "not_in_scope_for_growth_v1" },
} as const;

/** Every reason the four surfaces can put on `firstDepositAmountAggregation`. */
const AMOUNT_REASONS = [
  "no_deposits_in_period",
  "not_requested_on_this_surface",
  "per_row_amounts_not_published_on_this_surface",
  "amount_unreadable",
  "currency_unspecified",
  "currency_mixed",
];

describe("AvailabilityList — G4-R13", () => {
  it("prints no raw snake_case code for the live availability block", () => {
    const { container } = render(
      <AvailabilityList availability={LIVE_AVAILABILITY as never} />,
    );

    // The block rendered at all — otherwise this would pass vacuously.
    expect(screen.getByText("Что платформа не измеряет")).toBeInTheDocument();
    // And nothing in it looks like an internal enum.
    expect(container.textContent).not.toMatch(/[a-z]+_[a-z_]{4,}/);
  });

  it("renders a sentence for every amount reason a surface can send", () => {
    for (const reason of AMOUNT_REASONS) {
      const { container, unmount } = render(
        <AvailabilityList
          availability={
            {
              ...LIVE_AVAILABILITY,
              firstDepositAmountAggregation: { available: false, reason },
            } as never
          }
        />,
      );

      expect(container.textContent).not.toContain(reason);
      expect(container.textContent).toMatch(/[А-Яа-яЁё]/);
      unmount();
    }
  });

  it("still names the capability whose limitation it is describing", () => {
    render(<AvailabilityList availability={LIVE_AVAILABILITY as never} />);

    expect(screen.getByText("Суммы первых депозитов")).toBeInTheDocument();
    expect(screen.getByText("Редепозиты")).toBeInTheDocument();
  });
});

describe("registration scope hint — G4-R12", () => {
  it("states the provable count, the population and the split, and infers nothing", () => {
    const hint = registrationScopeHint(LIVE_AVAILABILITY.ataRegistrations.scope);

    expect(hint).toBeDefined();
    expect(hint).toContain("12");
    expect(hint).toContain("45");
    expect(hint).toContain("33"); // 45 − 12, stated as the unprovable remainder
    expect(hint).toContain("сотрудники");
    expect(hint).toContain("исторические");
    // No audit jargon on an operator surface.
    expect(hint).not.toMatch(/G4-R\d+|dataAvailability|scope|basis/);
  });

  it("says nothing when every account is provable", () => {
    expect(
      registrationScopeHint({
        provable: 12,
        population: 12,
        unprovableStaff: 0,
        unprovableOther: 0,
      }),
    ).toBeUndefined();
  });

  it("renders beside the metric without disturbing the value", () => {
    render(
      <GrowthMetric
        label="Регистрации ATA"
        value={12}
        hint={registrationScopeHint(LIVE_AVAILABILITY.ataRegistrations.scope)}
      />,
    );

    expect(screen.getByText("Регистрации ATA")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText(/происхождение не восстанавливается/)).toBeInTheDocument();
  });
});
