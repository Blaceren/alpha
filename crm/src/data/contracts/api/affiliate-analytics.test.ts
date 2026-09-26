/**
 * AFD-5C1 — the analytics contracts.
 *
 * `.strict()` is the mechanism by which "the analytics UI exposes no PII" is
 * ENFORCED rather than intended: a payload carrying a learner email, a Pocket id
 * or a click id fails to parse, and the client turns that into
 * `malformed_response` rather than rendering it. These tests pin that, plus the
 * two discriminated unions that make a dishonest render unrepresentable.
 */
import { describe, expect, it } from "vitest";
import {
  amountAvailabilitySchema,
  availabilityStateSchema,
  cohortRatesSchema,
  followupMetadataSchema,
  medianLagSchema,
  periodRatiosSchema,
  reportCutoffSchema,
  resolvedPeriodSchema,
} from "./affiliate-analytics";

describe("resolved period", () => {
  const valid = {
    resolvedPreset: "last_30_days",
    timezone: "Europe/Moscow",
    weekStart: "monday",
    startUtc: "2026-07-01T00:00:00.000Z",
    endUtc: "2026-07-31T00:00:00.000Z",
    startLocal: "2026-07-01 00:00:00",
    endLocal: "2026-07-31 00:00:00",
    intervalConvention: "start_inclusive_end_exclusive",
  };

  it("accepts the backend's shape", () => {
    expect(resolvedPeriodSchema.safeParse(valid).success).toBe(true);
  });

  it("allows a null start only as the all-time case carries it", () => {
    expect(
      resolvedPeriodSchema.safeParse({ ...valid, startUtc: null, startLocal: null }).success,
    ).toBe(true);
  });

  it("rejects a changed week-start contract", () => {
    // Monday weeks are a contract fact the UI displays. A backend that changed
    // it must fail here rather than have the CRM quietly print "sunday".
    expect(resolvedPeriodSchema.safeParse({ ...valid, weekStart: "sunday" }).success).toBe(false);
  });

  it("rejects a changed interval convention", () => {
    expect(
      resolvedPeriodSchema.safeParse({ ...valid, intervalConvention: "start_inclusive_end_inclusive" })
        .success,
    ).toBe(false);
  });

  it("rejects an unexpected extra field", () => {
    expect(
      resolvedPeriodSchema.safeParse({ ...valid, learnerEmail: "a@b.invalid" }).success,
    ).toBe(false);
  });
});

describe("amount availability", () => {
  it("accepts a total that carries its currency", () => {
    expect(
      amountAvailabilitySchema.safeParse({
        amountAggregationAvailable: true,
        amountTotal: "10.00",
        currencyCode: "EUR",
        unavailableReason: null,
      }).success,
    ).toBe(true);
  });

  it("accepts an explicit unavailable state with a named reason", () => {
    expect(
      amountAvailabilitySchema.safeParse({
        amountAggregationAvailable: false,
        amountTotal: null,
        currencyCode: null,
        unavailableReason: "currency_unspecified_or_mixed",
      }).success,
    ).toBe(true);
  });

  it("makes a total without a currency unrepresentable", () => {
    // This is the shape that would let the UI print a bare number and let a
    // reader assume dollars. It cannot be parsed, so it cannot be rendered.
    expect(
      amountAvailabilitySchema.safeParse({
        amountAggregationAvailable: true,
        amountTotal: "10.00",
        currencyCode: null,
        unavailableReason: null,
      }).success,
    ).toBe(false);
  });

  it("makes an unavailable state carrying a total unrepresentable", () => {
    expect(
      amountAvailabilitySchema.safeParse({
        amountAggregationAvailable: false,
        amountTotal: "10.00",
        currencyCode: "USD",
        unavailableReason: "currency_unspecified_or_mixed",
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown unavailable reason", () => {
    expect(
      amountAvailabilitySchema.safeParse({
        amountAggregationAvailable: false,
        amountTotal: null,
        currencyCode: null,
        unavailableReason: "converted_to_usd",
      }).success,
    ).toBe(false);
  });
});

describe("availability state", () => {
  it("accepts an available capability with no reason", () => {
    expect(availabilityStateSchema.safeParse({ available: true }).success).toBe(true);
  });

  it("requires a reason for an unavailable capability", () => {
    expect(availabilityStateSchema.safeParse({ available: false }).success).toBe(false);
    expect(
      availabilityStateSchema.safeParse({ available: false, reason: "prohibited_not_collected" })
        .success,
    ).toBe(true);
  });

  it("gives an unavailable capability no numeric field to be rendered as zero", () => {
    expect(
      availabilityStateSchema.safeParse({ available: false, reason: "x", value: 0 }).success,
    ).toBe(false);
  });
});

describe("ratios", () => {
  it("keeps every ratio a string or null, never a number", () => {
    expect(
      periodRatiosSchema.safeParse({
        qualifiedClickToAcademyRegistrationRate: "0.2",
        academyRegistrationToPocketRegistrationRate: null,
        pocketRegistrationToFirstDepositRate: "0",
        qualifiedClickToPocketRegistrationRate: "0.12",
        qualifiedClickToFirstDepositRate: "0.04",
      }).success,
    ).toBe(true);
  });

  it("rejects a numeric ratio, which would lose exactness", () => {
    expect(
      periodRatiosSchema.safeParse({
        qualifiedClickToAcademyRegistrationRate: 0.2,
        academyRegistrationToPocketRegistrationRate: null,
        pocketRegistrationToFirstDepositRate: null,
        qualifiedClickToPocketRegistrationRate: null,
        qualifiedClickToFirstDepositRate: null,
      }).success,
    ).toBe(false);
  });

  it("allows a null cohort rate for an empty denominator", () => {
    expect(
      cohortRatesSchema.safeParse({
        pocketRegistrationRate: null,
        firstDepositRate: null,
        pocketToFirstDepositRate: null,
      }).success,
    ).toBe(true);
  });
});

describe("median lag", () => {
  it("keeps the median an exact decimal string", () => {
    expect(
      medianLagSchema.safeParse({
        medianSeconds: "1.5",
        sampleSize: 2,
        negativeDurationCount: 0,
      }).success,
    ).toBe(true);
  });

  it("rejects a numeric median", () => {
    expect(
      medianLagSchema.safeParse({ medianSeconds: 1.5, sampleSize: 2, negativeDurationCount: 0 })
        .success,
    ).toBe(false);
  });

  it("allows an absent median with a zero sample", () => {
    expect(
      medianLagSchema.safeParse({ medianSeconds: null, sampleSize: 0, negativeDurationCount: 0 })
        .success,
    ).toBe(true);
  });
});

describe("follow-up metadata", () => {
  const valid = {
    cohortStartLocal: "2026-07-01 00:00:00",
    cohortEndLocal: "2026-07-31 00:00:00",
    cutoffLocal: "2026-07-30 15:00:00",
    cohortStartUtc: "2026-06-30T21:00:00.000Z",
    cohortEndUtc: "2026-07-30T21:00:00.000Z",
    cutoffUtc: "2026-07-30T12:00:00.000Z",
    minimumPossibleFollowupSeconds: 0,
    maximumPossibleFollowupSeconds: 2559600,
    cohortIntervalFullyBeforeCutoff: false,
    maturityAssessment: "not_scored",
    maturityReason: "empirical_maturity_model_not_implemented",
  };

  it("accepts the backend's shape", () => {
    expect(followupMetadataSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses any maturity verdict other than not_scored", () => {
    // Accepting "mature" would be this contract agreeing to display a forecast
    // the API does not make.
    expect(
      followupMetadataSchema.safeParse({ ...valid, maturityAssessment: "mature" }).success,
    ).toBe(false);
  });

  it("allows an unbounded maximum follow-up for all-time", () => {
    expect(
      followupMetadataSchema.safeParse({
        ...valid,
        cohortStartLocal: null,
        cohortStartUtc: null,
        maximumPossibleFollowupSeconds: null,
      }).success,
    ).toBe(true);
  });
});

describe("report cutoff", () => {
  const valid = {
    cutoffUtc: "2026-07-30T12:00:00.000Z",
    cutoffLocal: "2026-07-30 15:00:00",
    cutoffDateLocal: null,
    source: "report_clock",
    clampedToReportClock: false,
    intervalConvention: "cutoff_exclusive",
  };

  it("accepts the report-clock default", () => {
    expect(reportCutoffSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts an explicit clamped date", () => {
    expect(
      reportCutoffSchema.safeParse({
        ...valid,
        cutoffDateLocal: "2026-07-30",
        source: "explicit_date",
        clampedToReportClock: true,
      }).success,
    ).toBe(true);
  });

  it("pins the exclusive boundary", () => {
    expect(
      reportCutoffSchema.safeParse({ ...valid, intervalConvention: "cutoff_inclusive" }).success,
    ).toBe(false);
  });

  it("rejects an unknown cutoff source", () => {
    expect(reportCutoffSchema.safeParse({ ...valid, source: "guess" }).success).toBe(false);
  });
});
