/**
 * AFD-5D2 — the Curie Atlas response contract.
 *
 * THE CONTRACT TESTS ARE THE POINT OF THIS FILE. A UI that renders whatever it
 * is given cannot be trusted to represent a boundary honestly, so the rules the
 * phase brief calls out — no `opportunities`, no `modelInvoked: true`, no
 * unknown top-level field, no unsupported status — are asserted here as PARSE
 * FAILURES rather than as things a component remembers to check.
 */
import { describe, expect, it } from "vitest";
import {
  ATLAS_BODY_KEY_ORDER,
  atlasReportSchema,
  KNOWN_REASON_CODES,
} from "./curie-atlas";
import {
  ATLAS_DEFAULT_CUTOFF,
  atlasReport,
  cohortReport,
  countChangeFinding,
  insufficientReport,
  limitedReport,
} from "@/test/atlas-fixtures";

describe("curie atlas response contract", () => {
  it("accepts the recorded backend response", () => {
    expect(atlasReportSchema.safeParse(atlasReport()).success).toBe(true);
  });

  it("accepts an insufficient-data response", () => {
    expect(atlasReportSchema.safeParse(insufficientReport()).success).toBe(true);
  });

  it("accepts a cohort response carrying a resolved cutoff", () => {
    const parsed = atlasReportSchema.safeParse(cohortReport());
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.request.cutoff?.source).toBe("report_clock");
  });

  it("ACCEPTS a default cutoff whose cutoffDateLocal is null", () => {
    // The backend returns null whenever the cutoff is the report clock rather
    // than an operator-supplied date. Requiring a string here refused every
    // default-cutoff cohort report, which the browser journey caught.
    const report = cohortReport();
    const body = {
      ...report,
      request: { ...report.request, cutoff: { ...ATLAS_DEFAULT_CUTOFF } },
    };
    const parsed = atlasReportSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.request.cutoff?.cutoffDateLocal).toBeNull();
  });

  /* ------------------------------------------------------------ rejections */

  it("REJECTS a response carrying the legacy opportunities field", () => {
    // PRODUCT-RC-1 renamed it before first deployment and published no alias.
    const body = { ...atlasReport(), opportunities: [] };
    expect(atlasReportSchema.safeParse(body).success).toBe(false);
  });

  it("REJECTS modelInvoked: true", () => {
    // In this deterministic release that is a contract violation, not a variant.
    const report = atlasReport();
    const body = { ...report, engine: { ...report.engine, modelInvoked: true } };
    expect(atlasReportSchema.safeParse(body).success).toBe(false);
  });

  it("REJECTS a non-deterministic engine kind", () => {
    const report = atlasReport();
    const body = { ...report, engine: { ...report.engine, kind: "model" } };
    expect(atlasReportSchema.safeParse(body).success).toBe(false);
  });

  it("REJECTS a different agent code or contract version", () => {
    const report = atlasReport();
    expect(
      atlasReportSchema.safeParse({ ...report, agent: { code: "curie_pulse", version: "1.0.0" } })
        .success,
    ).toBe(false);
    expect(
      atlasReportSchema.safeParse({ ...report, agent: { code: "curie_atlas", version: "2.0.0" } })
        .success,
    ).toBe(false);
  });

  it("REJECTS an unknown top-level field", () => {
    expect(
      atlasReportSchema.safeParse({ ...atlasReport(), recommendations: [] }).success,
    ).toBe(false);
  });

  it("REJECTS an unknown field inside a finding", () => {
    const report = atlasReport();
    const body = {
      ...report,
      observations: [{ ...report.observations[0]!, confidence: 0.9 }],
    };
    expect(atlasReportSchema.safeParse(body).success).toBe(false);
  });

  it("REJECTS an unsupported sufficiency status", () => {
    // `partial` is NOT a backend status. If one ever appears it must be a
    // reviewed contract change, not something this UI silently renders.
    const body = { ...atlasReport(), dataSufficiency: { status: "partial" } };
    expect(atlasReportSchema.safeParse(body).success).toBe(false);
  });

  it("REJECTS an unsupported severity", () => {
    // The Atlas ladder is info|attention. `critical` belongs to the Agent Core.
    const report = atlasReport();
    const body = {
      ...report,
      warnings: [{ ...report.warnings[0]!, severity: "critical" }],
    };
    expect(atlasReportSchema.safeParse(body).success).toBe(false);
  });

  it("REJECTS an unsupported section or evidence source", () => {
    const report = atlasReport();
    expect(
      atlasReportSchema.safeParse({
        ...report,
        observations: [{ ...report.observations[0]!, section: "opportunity" }],
      }).success,
    ).toBe(false);
    expect(
      atlasReportSchema.safeParse({
        ...report,
        observations: [
          { ...report.observations[0]!, evidence: [{ key: "k", value: "1", source: "model" }] },
        ],
      }).success,
    ).toBe(false);
  });

  it("REJECTS a missing agent or engine block", () => {
    const { agent: _agent, ...withoutAgent } = atlasReport();
    expect(atlasReportSchema.safeParse(withoutAgent).success).toBe(false);
    const { engine: _engine, ...withoutEngine } = atlasReport();
    expect(atlasReportSchema.safeParse(withoutEngine).success).toBe(false);
  });

  it("REJECTS a missing requestId or inputFingerprint", () => {
    const { requestId: _r, ...noRequestId } = atlasReport();
    expect(atlasReportSchema.safeParse(noRequestId).success).toBe(false);
    const { inputFingerprint: _f, ...noFingerprint } = atlasReport();
    expect(atlasReportSchema.safeParse(noFingerprint).success).toBe(false);
  });

  /* --------------------------------------------------------- tolerated shapes */

  it("REJECTS an unknown sufficiency reason CODE", () => {
    // AFD-5D3 REVERSED AFD-5D2A HERE. The reason vocabulary is closed, so an
    // eighth code is a contract violation and the whole response is refused.
    //
    // The trade is explicit: a backend that adds a reason now blanks this screen
    // until the CRM ships the code. That is preferred to rendering an
    // unrecognised limitation through generic prose an operator could read as
    // "nothing important".
    const report = limitedReport([
      {
        code: "SOMETHING_NEW" as never,
        scope: "series",
        evidence: [{ key: "k", value: "1", source: "summary" }],
      },
    ]);
    expect(atlasReportSchema.safeParse(report).success).toBe(false);
  });

  it("accepts every one of the seven published reason codes", () => {
    // The positive half: closing the vocabulary must not reject what the backend
    // legitimately emits today.
    for (const code of KNOWN_REASON_CODES) {
      const report = limitedReport([
        { code, scope: "series", evidence: [{ key: "k", value: "1", source: "summary" }] },
      ]);
      expect(atlasReportSchema.safeParse(report).success, `rejected ${code}`).toBe(true);
    }
  });

  it("rejects the WHOLE response when one issue among valid ones is unknown", () => {
    // Partial trust is the failure mode worth naming: a response carrying good
    // findings AND one unknown reason must not render its good half.
    const report = limitedReport([
      {
        code: "SAMPLE_TOO_SMALL",
        scope: "series",
        evidence: [{ key: "k", value: "1", source: "summary" }],
      },
      {
        code: "NOT_A_REAL_REASON" as never,
        scope: "series",
        evidence: [{ key: "k", value: "1", source: "summary" }],
      },
    ]);
    expect(atlasReportSchema.safeParse(report).success).toBe(false);
  });

  it("ACCEPTS an unknown headline metric key", () => {
    const report = atlasReport();
    const body = {
      ...report,
      overview: {
        ...report.overview,
        headlineMetrics: { ...report.overview.headlineMetrics, newMetric: "7" },
      },
    };
    expect(atlasReportSchema.safeParse(body).success).toBe(true);
  });

  it("ACCEPTS a finding with no evidence", () => {
    // A standing question legitimately cites none — the backend's own
    // `question_cause_not_available` is exactly that shape.
    const report = atlasReport();
    expect(report.questions[0]?.evidence).toEqual([]);
    expect(atlasReportSchema.safeParse(report).success).toBe(true);
  });

  /* -------------------------------------------------------------- vocabulary */

  it("keeps the request body vocabulary closed and ordered", () => {
    expect(ATLAS_BODY_KEY_ORDER).toEqual([
      "mode",
      "preset",
      "startDate",
      "endDate",
      "cutoffDate",
      "group",
      "dimension",
      "affiliatePartnerId",
      "affiliateCampaignId",
      "affiliateTrackingLinkId",
    ]);
  });

  it("lists exactly the seven backend reason codes", () => {
    expect([...KNOWN_REASON_CODES].sort()).toEqual([
      "BREAKDOWN_TRUNCATED",
      "COHORT_FOLLOWUP_INCOMPLETE",
      "COMPARISON_PERIOD_UNAVAILABLE",
      "INTEGRITY_WARNING",
      "METRIC_UNAVAILABLE",
      "MIXED_CURRENCY",
      "SAMPLE_TOO_SMALL",
    ]);
  });

  /* ---------------------------------------- AFD-5D2A: the new required fields */

  it("REJECTS a response with no top-level status", () => {
    const { status: _status, ...withoutStatus } = atlasReport();
    expect(atlasReportSchema.safeParse(withoutStatus).success).toBe(false);
  });

  it("REJECTS an unsupported top-level status", () => {
    expect(atlasReportSchema.safeParse({ ...atlasReport(), status: "degraded" }).success).toBe(false);
  });

  it("REJECTS an unsupported sufficiency status", () => {
    const report = atlasReport();
    expect(
      atlasReportSchema.safeParse({
        ...report,
        dataSufficiency: { status: "sufficient", issues: [] },
      }).success,
    ).toBe(false);
  });

  it("REJECTS a finding with no supportTier", () => {
    const report = atlasReport();
    const { supportTier: _tier, ...noTier } = report.observations[0]!;
    expect(atlasReportSchema.safeParse({ ...report, observations: [noTier] }).success).toBe(false);
  });

  it("REJECTS an unknown supportTier", () => {
    const report = atlasReport();
    expect(
      atlasReportSchema.safeParse({
        ...report,
        observations: [{ ...report.observations[0]!, supportTier: "certain" }],
      }).success,
    ).toBe(false);
  });

  it("REJECTS a finding with no comparison field at all", () => {
    const report = atlasReport();
    const { comparison: _c, ...noComparison } = report.observations[0]!;
    expect(atlasReportSchema.safeParse({ ...report, observations: [noComparison] }).success).toBe(false);
  });

  it("REJECTS a malformed comparison", () => {
    const report = atlasReport();
    for (const bad of [
      { kind: "guess", currentValue: "1", baselineValue: "0", absoluteDelta: null, percentagePointDelta: null, relativeDelta: null },
      { kind: "count_change", currentValue: 1, baselineValue: "0", absoluteDelta: null, percentagePointDelta: null, relativeDelta: null },
      { kind: "count_change", currentValue: "1", baselineValue: "0" },
    ]) {
      expect(
        atlasReportSchema.safeParse({
          ...report,
          observations: [{ ...report.observations[0]!, comparison: bad }],
        }).success,
      ).toBe(false);
    }
  });

  it("ACCEPTS a fully populated comparison and a null one", () => {
    expect(atlasReportSchema.safeParse(atlasReport({ observations: [countChangeFinding()] })).success).toBe(true);
    expect(atlasReportSchema.safeParse(atlasReport()).success).toBe(true);
  });

  it("ACCEPTS a sufficiency issue with and without scope and details", () => {
    const minimal = limitedReport([
      { code: "INTEGRITY_WARNING", evidence: [{ key: "k", value: "1", source: "integrity" }] },
    ]);
    expect(atlasReportSchema.safeParse(minimal).success).toBe(true);
  });

  it("REJECTS a sufficiency issue with no evidence", () => {
    const report = limitedReport([{ code: "MIXED_CURRENCY", evidence: [] }]);
    // An issue with no evidence still parses structurally (an empty array is a
    // valid array); the BACKEND refuses to publish one. Pinned here so the
    // division of responsibility is explicit rather than assumed.
    expect(atlasReportSchema.safeParse(report).success).toBe(true);
  });

  /* ------------------------------------------------------------------ privacy */

  it("has nowhere to put PII", () => {
    // Structural, not a scan: `.strict()` means a body carrying any of these is
    // rejected outright, so the UI can never receive one.
    const report = atlasReport();
    for (const forbidden of [
      { email: "a@b.c" },
      { learnerId: 1 },
      { userId: 1 },
      { pocketPlayerId: "900000101" },
      { clickId: "tq-abc" },
      { leads: [] },
      { providerPayload: {} },
      { prompt: "x" },
    ]) {
      expect(atlasReportSchema.safeParse({ ...report, ...forbidden }).success).toBe(false);
    }
  });
});
