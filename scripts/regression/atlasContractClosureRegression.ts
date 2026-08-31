/**
 * AFD-5D2A — the authoritative Atlas contract.
 *
 * AFD-5D2 disclosed that the backend published neither a `partial` status, nor
 * coded sufficiency reasons, nor a support tier, nor comparison deltas — so its
 * CRM derived a presentation-level `partial` in the browser. This suite pins the
 * contract that moved all of that to the side that owns the numbers.
 *
 * WHAT IT PROVES:
 *   A. status — all three values, and that they are decided from the input.
 *   B. sufficiency — every reason code, from an authoritative source.
 *   C. emptiness is NOT an issue.
 *   D. unknown codes are refused before publication.
 *   E. support tiers — all three, from the published thresholds.
 *   F. comparisons — the exact fields, and no arithmetic the rules did not do.
 *   G. determinism, fingerprints, the null cutoff, no PII, modelInvoked false.
 *
 * Pure functions over fixtures. NO DATABASE, no server, no network, no Agent
 * Core row — this suite cannot create one because it never opens a connection.
 */
import assert from "node:assert/strict";
import fs from "node:fs";

import { ANALYSIS_THRESHOLDS } from "../../src/lib/analysis/analysis-contract";
import { buildAnalysisReport } from "../../src/lib/analysis/analysis-report";
import {
  SUFFICIENCY_REASON_CODES,
  SUFFICIENCY_STATUSES,
  ANALYSIS_STATUSES,
  UNEMITTED_REASON_CODES,
  AnalysisSufficiencyError,
  assertIssueIsCatalogLegal,
  assertStatusesAgree,
  analysisStatusOf,
  sufficiencyIssuesOf,
  type SufficiencyIssue,
} from "../../src/lib/analysis/analysis-sufficiency";
import { SUPPORT_TIERS, supportTierOf, comparisonOf } from "../../src/lib/analysis/analysis-support";
import { runRules } from "../../src/lib/analysis/analysis-rules";
import type { AnalysisInput, EventDateInput, CohortInput } from "../../src/lib/analysis/analysis-input";
import { computeRatios } from "../../src/lib/analytics/affiliate-queries";
import { ZERO_COUNTS, type MetricCounts } from "../../src/lib/analytics/affiliate-sources";
import type { ResolvedPeriod } from "../../src/lib/analytics/periods";
import type { ResolvedCutoff } from "../../src/lib/analytics/cohort-time";
import {
  EMPTY_MEDIANS,
  ZERO_COHORT_COUNTS,
  computeCohortRates,
} from "../../src/lib/analytics/cohort-queries";

const FINGERPRINT = "a1b2c3d4e5f60718";
const MSK = "Europe/Moscow";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  }
}

/* ------------------------------------------------------------- fixtures */

const PERIOD: ResolvedPeriod = {
  resolvedPreset: "last_30_days",
  timezone: MSK,
  startUtc: new Date("2026-06-30T21:00:00.000Z"),
  endUtc: new Date("2026-07-30T21:00:00.000Z"),
  startLocal: "2026-07-01 00:00:00",
  endLocal: "2026-07-31 00:00:00",
  intervalConvention: "start_inclusive_end_exclusive",
} as unknown as ResolvedPeriod;

const CUTOFF: ResolvedCutoff = {
  cutoffUtc: new Date("2026-07-30T21:00:00.000Z"),
  cutoffLocal: "2026-07-31 00:00:00",
  cutoffDateLocal: "2026-07-31",
  source: "explicit",
  clampedToReportClock: false,
} as unknown as ResolvedCutoff;

/** The default cutoff shape — `cutoffDateLocal` is NULL. AFD-5D2's correction. */
const DEFAULT_CUTOFF: ResolvedCutoff = {
  cutoffUtc: new Date("2026-08-04T04:53:15.423Z"),
  cutoffLocal: "2026-08-04T07:53:15",
  cutoffDateLocal: null,
  source: "report_clock",
  clampedToReportClock: false,
} as unknown as ResolvedCutoff;

function counts(over: Partial<MetricCounts> = {}): MetricCounts {
  return { ...ZERO_COUNTS, ...over };
}

/** A bucket with the shape the timeseries publishes. */
function bucket(label: string, over: Partial<MetricCounts> = {}) {
  return { localLabel: label, counts: counts(over) } as never;
}

function eventInput(over: Partial<EventDateInput> = {}): EventDateInput {
  const base = counts({
    rawClicks: 1200,
    qualifiedClicks: 1000,
    uniqueVisitors: 800,
    academyRegistrations: 100,
    pocketRegistrations: 50,
    confirmedFirstDeposits: 10,
  });
  const resolved = over.counts ?? base;
  return {
    mode: "event_date",
    period: PERIOD,
    filters: {},
    coverage: "total",
    filtered: false,
    group: "day",
    dimension: "affiliate",
    counts: resolved,
    ratios: computeRatios(resolved),
    amount: {
      amountAggregationAvailable: true,
      amountTotal: "500.00",
      currencyCode: "USD",
      unavailableReason: null,
    },
    attributedCounts: null,
    unattributedCounts: null,
    // Two buckets that reconcile to the totals, so the default fixture is `ok`.
    buckets: [
      bucket("2026-07-01", {
        qualifiedClicks: 500,
        academyRegistrations: 50,
        pocketRegistrations: 25,
        confirmedFirstDeposits: 5,
      }),
      bucket("2026-07-02", {
        qualifiedClicks: 500,
        academyRegistrations: 50,
        pocketRegistrations: 25,
        confirmedFirstDeposits: 5,
      }),
    ],
    breakdown: [],
    breakdownTotals: resolved,
    ...over,
    ...(over.counts ? { ratios: over.ratios ?? computeRatios(over.counts) } : {}),
  };
}

function cohortInput(over: Partial<CohortInput> = {}): CohortInput {
  const base = { cohortLearners: 200, pocketRegisteredLearners: 80, firstDepositLearners: 20 };
  const resolved = over.counts ?? base;
  return {
    mode: "acquisition_cohort",
    period: PERIOD,
    cutoff: CUTOFF,
    filters: {},
    filtered: false,
    group: "day",
    dimension: "affiliate",
    counts: resolved,
    rates: computeCohortRates(resolved),
    medians: EMPTY_MEDIANS,
    integrity: { missingOrDuplicateRegistrationCount: 0, duplicateFirstDepositCount: 0 },
    amount: {
      amountAggregationAvailable: false,
      amountTotal: null,
      currencyCode: null,
      unavailableReason: "no_confirmed_first_deposits",
    },
    buckets: [],
    breakdown: [],
    ...over,
    ...(over.counts ? { rates: over.rates ?? computeCohortRates(over.counts) } : {}),
  };
}

const report = (input: AnalysisInput) => buildAnalysisReport(input, FINGERPRINT);
const codesOf = (issues: readonly SufficiencyIssue[]) => issues.map((i) => i.code).sort();

/* ======================= A. the status contract ======================= */

check("A1 the status vocabulary is exactly the three published values", () => {
  assert.deepEqual(ANALYSIS_STATUSES, ["ok", "partial", "insufficient_data"]);
  assert.deepEqual(SUFFICIENCY_STATUSES, ["complete", "partial", "insufficient"]);
});

check("A2 a complete event-date report is ok / complete with no issues", () => {
  const built = report(eventInput());
  assert.equal(built.status, "ok");
  assert.equal(built.dataSufficiency.status, "complete");
  assert.deepEqual(built.dataSufficiency.issues, []);
});

check("A3 an empty period is insufficient_data / insufficient", () => {
  const built = report(eventInput({ counts: counts(), buckets: [] }));
  assert.equal(built.status, "insufficient_data");
  assert.equal(built.dataSufficiency.status, "insufficient");
  // Observations and positive signals stay empty: nothing is dressed up as zero
  // performance.
  assert.deepEqual(built.observations, []);
  assert.deepEqual(built.positiveSignals, []);
});

check("A4 an empty cohort is insufficient_data / insufficient", () => {
  const built = report(cohortInput({ counts: { ...ZERO_COHORT_COUNTS } }));
  assert.equal(built.status, "insufficient_data");
  assert.equal(built.dataSufficiency.status, "insufficient");
});

check("A5 a real report with one unavailable comparison is partial", () => {
  // One bucket: the series comparison the report would have made has no second
  // endpoint. The period itself is full of events.
  const built = report(eventInput({ buckets: [bucket("2026-07-01", { qualifiedClicks: 1000 })] }));
  assert.equal(built.status, "partial");
  assert.equal(built.dataSufficiency.status, "partial");
  assert.ok(codesOf(built.dataSufficiency.issues).includes("COMPARISON_PERIOD_UNAVAILABLE"));
  // A partial report still publishes its supported findings.
  assert.ok(built.observations.length > 0);
});

check("A6 the two statuses can never disagree", () => {
  for (const input of [eventInput(), eventInput({ counts: counts() }), cohortInput()]) {
    const built = report(input);
    const expected =
      built.status === "insufficient_data"
        ? "insufficient"
        : built.status === "partial"
          ? "partial"
          : "complete";
    assert.equal(built.dataSufficiency.status, expected);
  }
  // And the invariant is enforced, not merely observed.
  assert.throws(() => assertStatusesAgree("ok", "partial"), AnalysisSufficiencyError);
});

check("A7 status is decided by the backend from the input, not passed in", () => {
  // `buildAnalysisReport` takes an input and a fingerprint. There is no status
  // parameter, so no caller can assert one.
  assert.equal(buildAnalysisReport.length, 2);
});

/* ==================== B. every reason code ============================ */

check("B1 the reason-code catalog is exactly the seven required codes", () => {
  assert.deepEqual([...SUFFICIENCY_REASON_CODES].sort(), [
    "BREAKDOWN_TRUNCATED",
    "COHORT_FOLLOWUP_INCOMPLETE",
    "COMPARISON_PERIOD_UNAVAILABLE",
    "INTEGRITY_WARNING",
    "METRIC_UNAVAILABLE",
    "MIXED_CURRENCY",
    "SAMPLE_TOO_SMALL",
  ]);
});

check("B2 SAMPLE_TOO_SMALL comes from the published minimum denominator", () => {
  const small = counts({
    qualifiedClicks: 10,
    academyRegistrations: 3,
    pocketRegistrations: 1,
    confirmedFirstDeposits: 0,
  });
  const issues = sufficiencyIssuesOf(
    eventInput({ counts: small, buckets: [bucket("a", { qualifiedClicks: 10 }), bucket("b")] }),
  );
  const sample = issues.filter((i) => i.code === "SAMPLE_TOO_SMALL");
  assert.ok(sample.length > 0);
  assert.equal(sample[0]!.details?.threshold, String(ANALYSIS_THRESHOLDS.minRateDenominator));
  assert.ok(Number(sample[0]!.details?.denominator) < ANALYSIS_THRESHOLDS.minRateDenominator);
  assert.ok(sample[0]!.evidence.length > 0);
});

check("B3 COMPARISON_PERIOD_UNAVAILABLE comes from having fewer than two buckets", () => {
  const issues = sufficiencyIssuesOf(eventInput({ buckets: [bucket("only", { qualifiedClicks: 1000 })] }));
  const issue = issues.find((i) => i.code === "COMPARISON_PERIOD_UNAVAILABLE");
  assert.ok(issue);
  assert.equal(issue!.details?.bucketCount, "1");
  assert.equal(issue!.details?.required, "2");
});

check("B4 MIXED_CURRENCY comes from the amount aggregate's own reason", () => {
  const issues = sufficiencyIssuesOf(
    eventInput({
      amount: {
        amountAggregationAvailable: false,
        amountTotal: null,
        currencyCode: null,
        unavailableReason: "currency_unspecified_or_mixed",
      },
    }),
  );
  const issue = issues.find((i) => i.code === "MIXED_CURRENCY");
  assert.ok(issue);
  assert.equal(issue!.scope, "firstDepositAmount");
  assert.equal(issue!.details?.reason, "currency_unspecified_or_mixed");
});

check("B5 COHORT_FOLLOWUP_INCOMPLETE comes from a clamped cutoff", () => {
  const clamped = { ...CUTOFF, clampedToReportClock: true } as unknown as ResolvedCutoff;
  const issues = sufficiencyIssuesOf(cohortInput({ cutoff: clamped }));
  const issue = issues.find((i) => i.code === "COHORT_FOLLOWUP_INCOMPLETE");
  assert.ok(issue);
  assert.equal(issue!.scope, "cohort");
});

check("B6 INTEGRITY_WARNING comes from the cohort integrity record", () => {
  const issues = sufficiencyIssuesOf(
    cohortInput({ integrity: { missingOrDuplicateRegistrationCount: 4, duplicateFirstDepositCount: 2 } }),
  );
  const integrity = issues.filter((i) => i.code === "INTEGRITY_WARNING");
  assert.equal(integrity.length, 2);
  assert.deepEqual(integrity.map((i) => i.scope).sort(), ["firstDeposit", "registration"]);
});

check("B7 INTEGRITY_WARNING also comes from a series reconciliation mismatch", () => {
  // Buckets that do not sum to the period total: two stored views disagree.
  const issues = sufficiencyIssuesOf(
    eventInput({ buckets: [bucket("a", { qualifiedClicks: 1 }), bucket("b", { qualifiedClicks: 1 })] }),
  );
  const issue = issues.find((i) => i.code === "INTEGRITY_WARNING" && i.scope === "qualifiedClicks");
  assert.ok(issue);
  assert.equal(issue!.details?.bucketSum, "2");
  assert.equal(issue!.details?.periodTotal, "1000");
});

check("B8 METRIC_UNAVAILABLE distinguishes a BROKEN median from an empty one", () => {
  // An empty median with no negative durations is valid emptiness: no issue.
  const empty = sufficiencyIssuesOf(cohortInput());
  assert.equal(empty.filter((i) => i.code === "METRIC_UNAVAILABLE").length, 0);

  // The same empty median WITH negative durations means the metric could not be
  // produced because the records ran backwards.
  const broken = sufficiencyIssuesOf(
    cohortInput({
      medians: {
        ...EMPTY_MEDIANS,
        selectedClickToAcademyRegistration: {
          medianSeconds: null,
          sampleSize: 0,
          negativeDurationCount: 3,
        },
      },
    }),
  );
  const issue = broken.find((i) => i.code === "METRIC_UNAVAILABLE");
  assert.ok(issue);
  assert.equal(issue!.details?.negativeDurationCount, "3");
});

check("B8b a FUTURE third unavailable reason surfaces as METRIC_UNAVAILABLE, never silence", () => {
  // THE TOTALITY GUARD, tested rather than asserted in prose.
  //
  // `amount.unavailableReason` is a closed union of exactly two literals today,
  // so `sufficiencyIssuesOf`'s `else` branch is UNREACHABLE at the type level.
  // It exists for the day the aggregate gains a third reason: on that day the
  // new reason must surface as a limitation the operator can see, not vanish
  // into an `ok` report.
  //
  // A guard whose whole purpose is to catch a future change is exactly the kind
  // that rots unnoticed, so it is exercised here through a DELIBERATE cast that
  // simulates that future widening. The production union is NOT widened, no
  // production fixture fabricates this reason, and no new code is added — only
  // this test constructs the value.
  const futureReason = "settlement_provider_unreachable";

  const futureAmount = {
    amountAggregationAvailable: false,
    amountTotal: null,
    currencyCode: null,
    // The cast is the point of the case: it stands in for a widened union.
    unavailableReason: futureReason,
  } as unknown as EventDateInput["amount"];

  // Both real emission sites, because the branch is duplicated per mode and a
  // guard that holds in one mode and not the other is not a guard.
  const fromEventDate = sufficiencyIssuesOf(eventInput({ amount: futureAmount }));
  const fromCohort = sufficiencyIssuesOf(
    cohortInput({ amount: futureAmount as unknown as CohortInput["amount"] }),
  );

  for (const [label, issues] of [
    ["event_date", fromEventDate],
    ["acquisition_cohort", fromCohort],
  ] as const) {
    const issue = issues.find((i) => i.code === "METRIC_UNAVAILABLE");
    assert.ok(issue, `${label}: an unrecognised unavailable reason was dropped silently`);
    // It is reported as a limitation, and it carries the reason as evidence, so
    // the operator is told WHICH metric could not be produced.
    assert.equal(issue!.scope, "firstDepositAmount");
    assert.equal(issue!.details?.reason, futureReason);
    assert.ok(issue!.evidence.length > 0);
    // And it is NOT misfiled as a currency problem, which would be a specific
    // claim nobody measured.
    assert.equal(issues.filter((i) => i.code === "MIXED_CURRENCY").length, 0);
  }

  // The report is then `partial` — real data, one metric missing — and never
  // `ok`, which is the whole point of refusing to drop the unknown reason.
  assert.equal(
    analysisStatusOf(eventInput({ amount: futureAmount }), fromEventDate),
    "partial",
  );
});

check("B9 BREAKDOWN_TRUNCATED is catalogued and NOT emitted by this release", () => {
  // Stated rather than left to be discovered: `loadBreakdown` takes no limit, so
  // the analysis reads the COMPLETE breakdown and there is nothing to truncate.
  // The code exists so a later paginating phase has a reviewed one to emit.
  assert.deepEqual(UNEMITTED_REASON_CODES, ["BREAKDOWN_TRUNCATED"]);
  assert.ok((SUFFICIENCY_REASON_CODES as readonly string[]).includes("BREAKDOWN_TRUNCATED"));

  const everyIssue = [
    ...sufficiencyIssuesOf(eventInput()),
    ...sufficiencyIssuesOf(eventInput({ buckets: [bucket("a", { qualifiedClicks: 1000 })] })),
    ...sufficiencyIssuesOf(cohortInput()),
    ...sufficiencyIssuesOf(cohortInput({ integrity: { missingOrDuplicateRegistrationCount: 1, duplicateFirstDepositCount: 1 } })),
  ];
  assert.equal(everyIssue.filter((i) => i.code === "BREAKDOWN_TRUNCATED").length, 0);
});

/* ============== C. emptiness is a fact, not an issue ================== */

check("C1 an empty period raises NO issues at all", () => {
  assert.deepEqual(sufficiencyIssuesOf(eventInput({ counts: counts(), buckets: [] })), []);
});

check("C2 an empty cohort raises NO issues at all", () => {
  assert.deepEqual(sufficiencyIssuesOf(cohortInput({ counts: { ...ZERO_COHORT_COUNTS } })), []);
});

check("C3 no confirmed deposits is emptiness, NOT MIXED_CURRENCY or METRIC_UNAVAILABLE", () => {
  const issues = sufficiencyIssuesOf(
    eventInput({
      amount: {
        amountAggregationAvailable: false,
        amountTotal: null,
        currencyCode: null,
        unavailableReason: "no_confirmed_first_deposits",
      },
    }),
  );
  assert.equal(issues.filter((i) => i.code === "MIXED_CURRENCY").length, 0);
  assert.equal(issues.filter((i) => i.code === "METRIC_UNAVAILABLE").length, 0);
});

/* ============ D. an unknown code cannot be published ================== */

check("D1 an unknown reason code is refused before publication", () => {
  assert.throws(
    () =>
      assertIssueIsCatalogLegal({
        code: "SOMETHING_NEW" as never,
        evidence: [{ key: "k", value: "1", source: "summary" }],
      }),
    AnalysisSufficiencyError,
  );
});

check("D2 an issue with no evidence is refused", () => {
  assert.throws(
    () => assertIssueIsCatalogLegal({ code: "SAMPLE_TOO_SMALL", evidence: [] }),
    AnalysisSufficiencyError,
  );
});

check("D3 every published issue carries evidence", () => {
  const issues = [
    ...sufficiencyIssuesOf(eventInput({ buckets: [bucket("a", { qualifiedClicks: 1000 })] })),
    ...sufficiencyIssuesOf(cohortInput({ integrity: { missingOrDuplicateRegistrationCount: 1, duplicateFirstDepositCount: 0 } })),
  ];
  assert.ok(issues.length > 0);
  for (const issue of issues) assert.ok(issue.evidence.length > 0, `${issue.code} has no evidence`);
});

/* ==================== E. support tiers ================================ */

check("E1 the tier vocabulary is exactly the three published values", () => {
  assert.deepEqual(SUPPORT_TIERS, ["descriptive", "moderate", "strong"]);
});

check("E2 every finding carries a backend-owned supportTier", () => {
  const built = report(eventInput());
  const all = [...built.observations, ...built.warnings, ...built.positiveSignals, ...built.questions];
  assert.ok(all.length > 0);
  for (const finding of all) {
    assert.ok(
      (SUPPORT_TIERS as readonly string[]).includes(finding.supportTier),
      `${finding.code} has tier ${finding.supportTier}`,
    );
  }
});

check("E3 a statement with no denominator is descriptive", () => {
  assert.equal(supportTierOf({ code: "period_volume", operands: {}, evidence: [] }), "descriptive");
  assert.equal(
    supportTierOf({ code: "question_cause_not_available", operands: {}, evidence: [] }),
    "descriptive",
  );
});

check("E4 a denominator below the published minimum is descriptive, never moderate", () => {
  // The report already flags this rate as small-sample; a tier above
  // `descriptive` would contradict that flag on the same screen.
  assert.equal(
    supportTierOf({
      code: "funnel_rate_level",
      operands: { denominator: String(ANALYSIS_THRESHOLDS.minRateDenominator - 1) },
      evidence: [],
    }),
    "descriptive",
  );
});

check("E5 a denominator at the minimum is moderate", () => {
  assert.equal(
    supportTierOf({
      code: "funnel_rate_level",
      operands: { denominator: String(ANALYSIS_THRESHOLDS.minRateDenominator) },
      evidence: [],
    }),
    "moderate",
  );
});

check("E6 a denominator at the strong threshold is strong", () => {
  assert.equal(
    supportTierOf({
      code: "funnel_rate_level",
      operands: { denominator: String(ANALYSIS_THRESHOLDS.strongSupportMinDenominator) },
      evidence: [],
    }),
    "strong",
  );
  assert.equal(
    supportTierOf({
      code: "funnel_rate_level",
      operands: { denominator: String(ANALYSIS_THRESHOLDS.strongSupportMinDenominator - 1) },
      evidence: [],
    }),
    "moderate",
  );
});

check("E7 a missing or unparseable denominator is descriptive, never strong", () => {
  assert.equal(supportTierOf({ code: "funnel_rate_level", operands: {}, evidence: [] }), "descriptive");
  assert.equal(
    supportTierOf({ code: "funnel_rate_level", operands: { denominator: "many" }, evidence: [] }),
    "descriptive",
  );
});

check("E8 the strong threshold is published in the response", () => {
  const built = report(eventInput());
  assert.equal(
    built.thresholds.strongSupportMinDenominator,
    ANALYSIS_THRESHOLDS.strongSupportMinDenominator,
  );
  // A reader can see the rule that produced the label without reading source.
  assert.equal(built.thresholds.minRateDenominator, ANALYSIS_THRESHOLDS.minRateDenominator);
});

/* ==================== F. evidence deltas ============================== */

check("F1 a count change publishes current, baseline, absolute and relative", () => {
  const raw = runRules(
    eventInput({
      buckets: [
        bucket("a", { qualifiedClicks: 100, academyRegistrations: 10 }),
        bucket("b", { qualifiedClicks: 400, academyRegistrations: 40 }),
      ],
      counts: counts({ qualifiedClicks: 500, academyRegistrations: 50 }),
    }),
  ).find((f) => f.code === "series_count_change" && f.operands.metric === "qualifiedClicks");

  assert.ok(raw);
  const comparison = comparisonOf(raw!);
  assert.ok(comparison);
  assert.equal(comparison!.kind, "count_change");
  assert.equal(comparison!.baselineValue, "100");
  assert.equal(comparison!.currentValue, "400");
  assert.equal(comparison!.absoluteDelta, "300");
  // The relative move is the rules' OWN value, not recomputed here.
  assert.equal(comparison!.relativeDelta, raw!.operands.changePercent);
  // A count change has no percentage-point delta, and publishes null rather
  // than a zero nobody measured.
  assert.equal(comparison!.percentagePointDelta, null);
});

check("F2 a rate change publishes percentage points and no absolute delta", () => {
  const raw = runRules(
    eventInput({
      buckets: [
        bucket("a", { qualifiedClicks: 100, academyRegistrations: 5 }),
        bucket("b", { qualifiedClicks: 100, academyRegistrations: 40 }),
      ],
      counts: counts({ qualifiedClicks: 200, academyRegistrations: 45 }),
    }),
  ).find((f) => f.code === "series_rate_change");

  assert.ok(raw);
  const comparison = comparisonOf(raw!);
  assert.ok(comparison);
  assert.equal(comparison!.kind, "rate_change");
  assert.equal(comparison!.percentagePointDelta, raw!.operands.changePoints);
  assert.equal(comparison!.absoluteDelta, null);
  assert.equal(comparison!.relativeDelta, null);
});

check("F3 a finding that is not a comparison publishes null", () => {
  assert.equal(comparisonOf({ code: "period_volume", operands: {}, evidence: [] }), null);
  assert.equal(comparisonOf({ code: "small_sample_rate", operands: {}, evidence: [] }), null);
});

check("F4 every published finding carries a comparison field, null or object", () => {
  const built = report(
    eventInput({
      buckets: [
        bucket("a", { qualifiedClicks: 100, academyRegistrations: 10 }),
        bucket("b", { qualifiedClicks: 900, academyRegistrations: 90 }),
      ],
    }),
  );
  const all = [...built.observations, ...built.warnings, ...built.positiveSignals, ...built.questions];
  for (const finding of all) {
    assert.ok("comparison" in finding, `${finding.code} has no comparison field`);
    if (finding.comparison !== null) {
      assert.equal(typeof finding.comparison.currentValue, "string");
      assert.equal(typeof finding.comparison.baselineValue, "string");
    }
  }
  assert.ok(all.some((f) => f.comparison !== null), "no comparison was produced at all");
});

check("F5 every comparison value is a STRING, never a number", () => {
  const built = report(
    eventInput({
      buckets: [
        bucket("a", { qualifiedClicks: 100 }),
        bucket("b", { qualifiedClicks: 900 }),
      ],
    }),
  );
  const all = [...built.observations, ...built.warnings, ...built.positiveSignals];
  for (const finding of all) {
    if (finding.comparison === null) continue;
    for (const key of ["currentValue", "baselineValue", "absoluteDelta", "percentagePointDelta", "relativeDelta"] as const) {
      const value = finding.comparison[key];
      assert.ok(value === null || typeof value === "string", `${finding.code}.${key} is ${typeof value}`);
    }
  }
});

/* =============== G. the preserved contract ============================ */

check("G1 the default null cutoff is preserved", () => {
  const built = report(cohortInput({ cutoff: DEFAULT_CUTOFF }));
  assert.equal(built.status, "ok");
  // The report itself does not echo the cutoff — the ROUTE does — but the input
  // carrying a null `cutoffDateLocal` must not break the engine.
  assert.ok(built.observations.length > 0);
});

check("G2 the report is deterministic: the same input twice is byte-identical", () => {
  const first = JSON.stringify(report(eventInput()));
  const second = JSON.stringify(report(eventInput()));
  assert.equal(first, second);
});

check("G3 modelInvoked stays the literal false and the agent is unchanged", () => {
  const built = report(eventInput());
  assert.equal(built.engine.modelInvoked, false);
  assert.equal(built.engine.kind, "deterministic");
  assert.equal(built.agent.code, "curie_atlas");
  assert.equal(built.agent.version, "1.0.0");
});

check("G4 the fingerprint is echoed exactly as supplied", () => {
  assert.equal(report(eventInput()).inputFingerprint, FINGERPRINT);
});

check("G5 positiveSignals is published and opportunities is not", () => {
  const built = report(eventInput());
  assert.ok("positiveSignals" in built);
  assert.ok(!("opportunities" in built));
});

check("G6 no PII of any shape reaches the response", () => {
  const serialized = JSON.stringify(
    report(
      eventInput({
        buckets: [bucket("a", { qualifiedClicks: 100 }), bucket("b", { qualifiedClicks: 900 })],
      }),
    ),
  );
  assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(serialized), "an email leaked");
  for (const forbidden of ["email", "phone", "fullName", "leadId", "pocketPlayerId", "ataClickId", "userId"]) {
    assert.ok(!serialized.includes(`"${forbidden}"`), `${forbidden} leaked`);
  }
});

check("G7 the sufficiency module opens no database connection", () => {
  // Structural: it imports no Prisma client and no query module, so it cannot
  // create an Agent Core row or read a learner.
  const source = fs.readFileSync("src/lib/analysis/analysis-sufficiency.ts", "utf8");
  for (const forbidden of ["PrismaClient", "prisma", "$queryRaw", "fetch(", "agentRun"]) {
    assert.ok(!source.includes(forbidden), `sufficiency module references ${forbidden}`);
  }
});

console.log(`\nAFD-5D2A atlas contract closure: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
