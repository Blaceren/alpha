/**
 * AFD-5D2 — Curie Atlas response fixtures, shared by the contract, client and
 * component suites.
 *
 * THESE MIRROR BACKEND CANDIDATE `4511acf8` EXACTLY. Every field, every literal
 * and every enum member here was read from the backend source, not invented to
 * make a test pass: `src/lib/analysis/analysis-report.ts` for the envelope,
 * `analysis-contract.ts` for `Finding` and `Evidence`, and the analysis route
 * for the `request`/`requestId`/`generatedAt` echo.
 *
 * A fixture that drifts from the real DTO is worse than no fixture, because it
 * makes a suite that proves the UI works against a response the backend never
 * sends. `curie-atlas-contract.test.ts` pins these against the recorded contract
 * so drift fails there rather than silently everywhere.
 *
 * NOTHING HERE CONTAINS PII. Dimension members are numeric ids exactly as the
 * backend publishes them; there is no email, no name, no lead, no click id and
 * no Pocket identifier, because the DTO has nowhere to put one.
 */
import type {
  AtlasEvidence,
  AtlasFinding,
  AtlasReport,
  AtlasSufficiencyIssue,
} from "@/data/contracts/api/curie-atlas";

export const ATLAS_PERIOD = {
  resolvedPreset: "last_30_days",
  timezone: "Europe/Moscow",
  weekStart: "monday",
  startUtc: "2026-06-30T21:00:00.000Z",
  endUtc: "2026-07-30T21:00:00.000Z",
  startLocal: "2026-07-01 00:00:00",
  endLocal: "2026-07-31 00:00:00",
  intervalConvention: "start_inclusive_end_exclusive",
} as const;

export const ATLAS_CUTOFF = {
  cutoffUtc: "2026-07-30T21:00:00.000Z",
  cutoffLocal: "2026-07-31 00:00:00",
  cutoffDateLocal: "2026-07-31",
  source: "report_clock",
  clampedToReportClock: false,
  intervalConvention: "cutoff_exclusive",
} as const;

export function evidence(over: Partial<AtlasEvidence> = {}): AtlasEvidence {
  return { key: "qualifiedClicks", value: "1240", source: "summary", ...over };
}

export function finding(over: Partial<AtlasFinding> = {}): AtlasFinding {
  return {
    code: "period_volume",
    section: "observation",
    severity: "info",
    message: "За период засчитано 1240 кликов и 96 регистраций в Академии.",
    evidence: [evidence()],
    dimensionId: null,
    // AFD-5D2A — both are backend-owned and REQUIRED on every finding.
    supportTier: "descriptive",
    comparison: null,
    ...over,
  };
}

/** One backend sufficiency issue. */
export function issue(over: Partial<AtlasSufficiencyIssue> = {}): AtlasSufficiencyIssue {
  return {
    code: "SAMPLE_TOO_SMALL",
    scope: "qualifiedClickToAcademyRegistrationRate",
    details: { denominatorMetric: "qualifiedClicks", denominator: "18", threshold: "30" },
    evidence: [evidence({ key: "qualifiedClicks", value: "18" })],
    ...over,
  };
}

/**
 * A complete, sufficient event-date report.
 *
 * Deliberately carries one finding in each of the four sections, so a component
 * suite can assert section placement without a second fixture.
 */
export function atlasReport(over: Partial<AtlasReport> = {}): AtlasReport {
  return {
    agent: { code: "curie_atlas", version: "1.0.0" },
    engine: {
      kind: "deterministic",
      engineVersion: "1.0.0",
      catalogVersion: "afd5d1.1",
      modelInvoked: false,
    },
    inputFingerprint: "a1b2c3d4e5f60718",
    overview: {
      mode: "event_date",
      coverage: "total",
      filtered: false,
      breakdownDimension: "affiliate",
      bucketCount: 30,
      findingCounts: { observation: 1, warning: 1, positive_signal: 1, question: 1 },
      headlineMetrics: {
        qualifiedClicks: "1240",
        academyRegistrations: "96",
        pocketRegistrations: "41",
        confirmedFirstDeposits: "12",
        pendingIdentityDeposits: "0",
        conflictingDeposits: "0",
      },
    },
    status: "ok",
    dataSufficiency: { status: "complete", issues: [] },
    observations: [finding()],
    warnings: [
      finding({
        code: "small_sample_rate",
        section: "warning",
        severity: "attention",
        message: "Доля рассчитана по выборке меньше 30 наблюдений.",
        evidence: [evidence({ key: "denominator", value: "18", source: "summary" })],
      }),
    ],
    positiveSignals: [
      finding({
        code: "member_rate_differs_from_aggregate",
        section: "positive_signal",
        severity: "info",
        message: "У элемента разреза доля регистраций выше совокупной на 12 п.п.",
        evidence: [evidence({ key: "memberRate", value: "0.34", source: "breakdown", dimensionId: 1 })],
        dimensionId: 1,
        supportTier: "strong",
        comparison: {
          kind: "member_vs_aggregate",
          currentValue: "34.0",
          baselineValue: "22.0",
          absoluteDelta: null,
          percentagePointDelta: "12.0",
          relativeDelta: null,
        },
      }),
    ],
    questions: [
      finding({
        code: "question_cause_not_available",
        section: "question",
        severity: "info",
        message: "Отчёт не устанавливает причины наблюдаемых изменений.",
        evidence: [],
      }),
    ],
    thresholds: {
      minRateDenominator: 30,
      seriesCountChangeMinRelativePercent: "20",
      memberRateDifferenceMinPoints: "10",
    },
    request: {
      mode: "event_date",
      period: { ...ATLAS_PERIOD },
      cutoff: null,
      filters: {
        affiliatePartnerId: null,
        affiliateCampaignId: null,
        affiliateTrackingLinkId: null,
      },
      group: "day",
      dimension: "affiliate",
    },
    requestId: "req_atlas_0001",
    generatedAt: "2026-07-31T09:15:00.000Z",
    ...over,
  };
}

/** An insufficient-data report, with the reason this backend actually emits. */
export function insufficientReport(): AtlasReport {
  return atlasReport({
    status: "insufficient_data",
    // An empty period raises NO issues: emptiness is a valid factual result, and
    // the backend deliberately publishes none. See analysis-sufficiency.ts.
    dataSufficiency: { status: "insufficient", issues: [] },
    overview: {
      ...atlasReport().overview,
      findingCounts: { observation: 0, warning: 0, positive_signal: 0, question: 1 },
      headlineMetrics: {
        qualifiedClicks: "0",
        academyRegistrations: "0",
        pocketRegistrations: "0",
        confirmedFirstDeposits: "0",
        pendingIdentityDeposits: "0",
        conflictingDeposits: "0",
      },
    },
    observations: [],
    warnings: [],
    positiveSignals: [],
  });
}

/**
 * A `partial` report — the BACKEND's verdict, not a derived one.
 *
 * AFD-5D2 had to infer this state from evidence sources. AFD-5D2A receives it:
 * `status: "partial"` with a coded issue list the backend owns.
 */
export function limitedReport(issues: readonly AtlasSufficiencyIssue[] = [
  issue({
    code: "MIXED_CURRENCY",
    scope: "firstDepositAmount",
    details: { reason: "currency_unspecified_or_mixed" },
    evidence: [
      evidence({
        key: "firstDepositAmount.unavailableReason",
        value: "currency_unspecified_or_mixed",
        source: "availability",
      }),
    ],
  }),
]): AtlasReport {
  return atlasReport({
    status: "partial",
    dataSufficiency: { status: "partial", issues: [...issues] },
    warnings: [
      finding({
        code: "amount_aggregation_unavailable",
        section: "warning",
        severity: "attention",
        message: "Сумма первых депозитов не агрегируется: в периоде несколько валют.",
        evidence: [
          evidence({
            key: "firstDepositAmountAggregation",
            value: "unavailable",
            source: "availability",
          }),
        ],
      }),
    ],
  });
}

/**
 * The cutoff as the backend returns it when NO explicit date was supplied:
 * `cutoffDateLocal` is null and the report clock is the boundary. Recorded from
 * a real response during the AFD-5D2 browser journey.
 */
export const ATLAS_DEFAULT_CUTOFF = {
  cutoffUtc: "2026-08-04T04:53:15.423Z",
  cutoffLocal: "2026-08-04T07:53:15",
  cutoffDateLocal: null,
  source: "report_clock",
  clampedToReportClock: false,
  intervalConvention: "cutoff_exclusive",
} as const;

/** A finding carrying a COUNT comparison, for delta rendering. */
export function countChangeFinding(): AtlasFinding {
  return finding({
    code: "series_count_change",
    section: "observation",
    severity: "info",
    message: "Засчитанные клики выросли с 100 до 400 между 2026-07-01 и 2026-07-02.",
    evidence: [evidence({ key: "qualifiedClicks.first", value: "100", source: "timeseries" })],
    supportTier: "moderate",
    comparison: {
      kind: "count_change",
      currentValue: "400",
      baselineValue: "100",
      absoluteDelta: "300",
      percentagePointDelta: null,
      relativeDelta: "300.0",
    },
  });
}

/** A cohort-mode report, carrying a resolved cutoff. */
export function cohortReport(): AtlasReport {
  return atlasReport({
    overview: {
      ...atlasReport().overview,
      mode: "acquisition_cohort",
      coverage: "attributed",
      headlineMetrics: {
        cohortLearners: "310",
        pocketRegisteredLearners: "128",
        firstDepositLearners: "37",
      },
    },
    request: {
      ...atlasReport().request,
      mode: "acquisition_cohort",
      cutoff: { ...ATLAS_CUTOFF },
    },
  });
}
