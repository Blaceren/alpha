/**
 * AFD-5D2 — the runtime contract for the Curie Atlas analysis response.
 *
 * This mirrors the accepted AFD-5D1 backend DTO as PRODUCT-RC-1 normalized it,
 * pinned against backend candidate `4511acf8`. Every object is `.strict()`, for
 * the reason every other contract in this directory is: a field the backend
 * starts sending later must fail parsing HERE and stop the page rendering,
 * rather than quietly appearing in a report an operator will act on.
 *
 * THREE RULES THIS FILE ENFORCES STRUCTURALLY, NOT BY CONVENTION:
 *
 *   1. `modelInvoked` IS THE LITERAL `false`. It is not `z.boolean()`. In this
 *      deterministic release a response claiming a model was invoked is a
 *      CONTRACT VIOLATION, not a variant to render — see §19 of the phase
 *      brief. `z.literal(false)` makes that a parse failure rather than
 *      something the UI has to remember to check.
 *
 *   2. `opportunities` CANNOT BE ACCEPTED. PRODUCT-RC-1 renamed it to
 *      `positiveSignals` before first deployment and published no alias. The
 *      top-level object is `.strict()`, so a body carrying the old name is
 *      rejected wholesale — the UI never has to decide which of two names won.
 *
 *   3. `agent.code` AND `agent.version` ARE LITERALS. This CRM release renders
 *      exactly `curie_atlas` at `1.0.0`. A different agent or a different
 *      contract version reaching this screen would mean the UI is displaying
 *      something it was not reviewed against.
 *
 * WHAT IS DELIBERATELY ABSENT, and therefore rejected by `.strict()` if the
 * backend ever sends it here: any lead, learner email, learner name, user id,
 * learner id, raw Pocket player id, raw affiliate click id, callback query,
 * provider payload, raw prompt, raw model response, and every row-level record.
 * A dimension member is named by its numeric id and nothing else.
 */
import { z } from "zod";

/* ------------------------------------------------------------ error envelope */

/**
 * The backend's closed `{code, messageKey, requestId}` envelope, identical to
 * the one the analytics routes use. Re-declared rather than imported so this
 * contract can be read on its own, matching how `affiliate-leads.ts` treats it.
 */
export const atlasErrorSchema = z
  .object({
    code: z.string().min(1),
    messageKey: z.string().min(1),
    requestId: z.string().min(1).optional(),
  })
  .strict();

/* ------------------------------------------------------------------ vocabulary */

export const ATLAS_MODES = ["event_date", "acquisition_cohort"] as const;
export const atlasModeSchema = z.enum(ATLAS_MODES);
export type AtlasMode = (typeof ATLAS_MODES)[number];

/**
 * The four published sections.
 *
 * `positive_signal` — never `opportunity`. The section name and the response
 * collection name were renamed together by PRODUCT-RC-1.
 */
export const ATLAS_SECTIONS = [
  "observation",
  "warning",
  "positive_signal",
  "question",
] as const;
export const atlasSectionSchema = z.enum(ATLAS_SECTIONS);
export type AtlasSection = (typeof ATLAS_SECTIONS)[number];

/**
 * TWO severities, not three.
 *
 * The backend catalog is deliberately `info | attention` and has no `critical`:
 * a severity ladder invites a judgement this report is not entitled to make.
 * The AGENT-FOUNDATION-1 Agent Core has a separate three-level ladder for a
 * different purpose; this CRM screen renders the ATLAS one, and a `critical`
 * arriving here would be an unreviewed severity.
 */
export const ATLAS_SEVERITIES = ["info", "attention"] as const;
export const atlasSeveritySchema = z.enum(ATLAS_SEVERITIES);
export type AtlasSeverity = (typeof ATLAS_SEVERITIES)[number];

/** Which accepted aggregate produced an evidence operand. */
export const ATLAS_EVIDENCE_SOURCES = [
  "summary",
  "timeseries",
  "breakdown",
  "availability",
  "integrity",
  "period",
] as const;
export const atlasEvidenceSourceSchema = z.enum(ATLAS_EVIDENCE_SOURCES);
export type AtlasEvidenceSource = (typeof ATLAS_EVIDENCE_SOURCES)[number];

export const ATLAS_COVERAGES = ["attributed", "unattributed", "total"] as const;
export const atlasCoverageSchema = z.enum(ATLAS_COVERAGES);
export type AtlasCoverage = (typeof ATLAS_COVERAGES)[number];

export const ATLAS_GROUPS = ["day", "week", "month"] as const;
export const atlasGroupSchema = z.enum(ATLAS_GROUPS);
export type AtlasGroup = (typeof ATLAS_GROUPS)[number];

/**
 * The BREAKDOWN AXIS, which is a different thing from `group`.
 *
 * `group` is the time bucket width; `dimension` is what the rows are grouped by.
 * The brief calls this out explicitly because reading either as the other
 * silently changes what the report means.
 */
export const ATLAS_DIMENSIONS = ["affiliate", "campaign", "tracking_link"] as const;
export const atlasDimensionSchema = z.enum(ATLAS_DIMENSIONS);
export type AtlasDimension = (typeof ATLAS_DIMENSIONS)[number];

/* -------------------------------------------------------------------- agent */

/**
 * WHO produced this report, as distinct from HOW.
 *
 * Both are literals. See rule 3 in the file header.
 */
export const atlasAgentSchema = z
  .object({
    code: z.literal("curie_atlas"),
    version: z.literal("1.0.0"),
  })
  .strict();

/**
 * HOW the findings were produced.
 *
 * `kind` is the literal `deterministic` and `modelInvoked` the literal `false`.
 * `engineVersion` and `catalogVersion` move independently of `agent.version`
 * and are carried so an operator comparing two saved reports can tell which of
 * the three actually moved.
 */
export const atlasEngineSchema = z
  .object({
    kind: z.literal("deterministic"),
    engineVersion: z.string().min(1),
    catalogVersion: z.string().min(1),
    modelInvoked: z.literal(false),
  })
  .strict();

/* ----------------------------------------------------------------- evidence */

/**
 * One operand, carrying the value AND where it came from.
 *
 * `value` is a STRING even for counts, exactly as the backend publishes it.
 * Parsing it into a number here would make `null`-shaped absences and real
 * zeroes interchangeable at the first arithmetic operation, and this UI does no
 * arithmetic on evidence at all — it displays what the backend returned.
 *
 * `dimensionId` is a numeric internal id and is OPTIONAL. It is never shown as
 * a name; §11 requires a resolved human label or a bounded neutral one.
 */
export const atlasEvidenceSchema = z
  .object({
    key: z.string().min(1),
    value: z.string(),
    source: atlasEvidenceSourceSchema,
    dimensionId: z.number().int().optional(),
  })
  .strict();

export type AtlasEvidence = z.infer<typeof atlasEvidenceSchema>;

/* ----------------------------------------------------------------- findings */

/**
 * One published finding.
 *
 * `message` is the RENDERED RUSSIAN SENTENCE produced by the backend catalog's
 * template for `code`. The UI displays it and never parses it: every
 * presentation decision — icon, severity styling, section placement, evidence
 * rendering — is taken from the machine-readable fields beside it.
 *
 * `code` is a stable identifier a consumer may branch on. It is not shown as
 * primary user-facing text; it appears only inside technical details.
 */
/**
 * AFD-5D2A — how well-supported a finding is, DECIDED BY THE BACKEND.
 *
 * A closed enum, so an unknown tier is a parse failure rather than a string the
 * UI prints. The CRM computes nothing: it has no access to a denominator and no
 * code path that inspects one.
 */
export const ATLAS_SUPPORT_TIERS = ["descriptive", "moderate", "strong"] as const;
export const atlasSupportTierSchema = z.enum(ATLAS_SUPPORT_TIERS);
export type AtlasSupportTier = (typeof ATLAS_SUPPORT_TIERS)[number];

export const ATLAS_COMPARISON_KINDS = [
  "count_change",
  "rate_change",
  "member_vs_aggregate",
] as const;
export const atlasComparisonKindSchema = z.enum(ATLAS_COMPARISON_KINDS);

/**
 * AFD-5D2A — the structured comparison, computed by the BACKEND.
 *
 * Every field is a string or null, never a number: an exact decimal string and
 * a JavaScript number are not interchangeable, and a percentage-point delta is
 * precisely where binary rounding would show.
 *
 * A field that does not apply is `null`, never absent and never `0` — a count
 * change has no percentage-point delta, and publishing zero for one would be a
 * measurement nobody made. `.strict()` plus the required nulls makes the shape
 * TOTAL: the CRM never has to decide whether a missing field means zero.
 */
/**
 * AFD-5D3 — THE EXACT ACCEPTED REPRESENTATION, taken from the backend.
 *
 * The values are NUMERIC IN MEANING and carried as EXACT DECIMAL STRINGS. That
 * is not a hedge: an exact decimal string and an IEEE double are not
 * interchangeable, and a percentage-point delta is precisely where binary
 * rounding shows. Accepting a JSON number here would silently import that
 * rounding, so a number is rejected — the VALUE is numeric, its TRANSPORT is a
 * string.
 *
 * Measured from `analysis-support.ts` against the real engine:
 *
 *   count_change        current "10"   baseline "25"   absolute "-15" (SIGNED)
 *                       percentagePoint null           relative "60.0" (UNSIGNED)
 *   rate_change         current "35.0" baseline "40.0" absolute null
 *                       percentagePoint "5.0" (UNSIGNED)  relative null
 *   member_vs_aggregate current "40.0" baseline "25.0" absolute null
 *                       percentagePoint "15.0" (UNSIGNED) relative null
 *
 * Direction is carried by the finding's own sentence and, for counts, by the
 * SIGN of `absoluteDelta`. The percentage magnitudes are unsigned by design.
 *
 * Each kind's shape is enforced EXACTLY: a field that does not apply must be
 * `null`, never absent and never zero, and a field that does apply must be a
 * well-formed decimal. A partial or cross-kind structure is rejected.
 */

/** A finite decimal. Rejects "", "NaN", "Infinity", "1e5", "1,5" and "0x10". */
const DECIMAL = /^-?\d+(?:\.\d+)?$/;
/** A whole count or a signed integer delta. */
const INTEGER = /^-?\d+$/;
/** A percentage magnitude the engine publishes: unsigned, at most one decimal. */
const PERCENT_MAGNITUDE = /^\d+(?:\.\d)?$/;

function isDecimal(value: string): boolean {
  return DECIMAL.test(value) && Number.isFinite(Number(value));
}

/** A rate must be a real percentage: 0…100, and no more precision than published. */
function isRatePercent(value: string): boolean {
  if (!PERCENT_MAGNITUDE.test(value)) return false;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= 100;
}

export const atlasComparisonSchema = z
  .object({
    kind: atlasComparisonKindSchema,
    currentValue: z.string().min(1),
    baselineValue: z.string().min(1),
    absoluteDelta: z.string().min(1).nullable(),
    percentagePointDelta: z.string().min(1).nullable(),
    relativeDelta: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((comparison, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    if (comparison.kind === "count_change") {
      // Counts are whole numbers; the delta is signed; there is no
      // percentage-point move for a count.
      if (!INTEGER.test(comparison.currentValue)) fail("currentValue", "count must be an integer");
      if (!INTEGER.test(comparison.baselineValue)) fail("baselineValue", "count must be an integer");
      if (comparison.absoluteDelta !== null && !INTEGER.test(comparison.absoluteDelta)) {
        fail("absoluteDelta", "a count delta must be a signed integer");
      }
      if (comparison.percentagePointDelta !== null) {
        fail("percentagePointDelta", "a count change has no percentage-point delta");
      }
      if (comparison.relativeDelta !== null && !isDecimal(comparison.relativeDelta)) {
        fail("relativeDelta", "the relative move must be a finite decimal");
      }
      // The delta must agree with the two values it claims to relate.
      if (comparison.absoluteDelta !== null) {
        const expected = Number(comparison.currentValue) - Number(comparison.baselineValue);
        if (Number(comparison.absoluteDelta) !== expected) {
          fail("absoluteDelta", "the delta disagrees with current − baseline");
        }
      }
      return;
    }

    // rate_change and member_vs_aggregate share one shape: two percentages and a
    // percentage-POINT difference between them.
    if (!isRatePercent(comparison.currentValue)) fail("currentValue", "not a 0–100 percentage");
    if (!isRatePercent(comparison.baselineValue)) fail("baselineValue", "not a 0–100 percentage");
    if (comparison.absoluteDelta !== null) {
      fail("absoluteDelta", "a rate comparison has no absolute delta");
    }
    if (comparison.relativeDelta !== null) {
      fail("relativeDelta", "a rate comparison publishes points, not a relative move");
    }
    if (comparison.percentagePointDelta !== null) {
      if (!isRatePercent(comparison.percentagePointDelta)) {
        fail("percentagePointDelta", "a points delta must be an unsigned 0–100 magnitude");
      } else {
        const expected = Math.abs(
          Number(comparison.currentValue) - Number(comparison.baselineValue),
        );
        // One decimal place is the published precision, so compare at that scale.
        if (Math.round(Number(comparison.percentagePointDelta) * 10) !== Math.round(expected * 10)) {
          fail("percentagePointDelta", "the points delta disagrees with its own two values");
        }
      }
    }
  });

export type AtlasComparison = z.infer<typeof atlasComparisonSchema>;

export const atlasFindingSchema = z
  .object({
    code: z.string().min(1),
    section: atlasSectionSchema,
    severity: atlasSeveritySchema,
    message: z.string().min(1),
    evidence: z.array(atlasEvidenceSchema),
    dimensionId: z.number().int().nullable(),
    /** REQUIRED. A finding without a backend tier is a contract violation. */
    supportTier: atlasSupportTierSchema,
    /** REQUIRED, and `null` for the majority of findings that are not comparisons. */
    comparison: atlasComparisonSchema.nullable(),
  })
  .strict();

export type AtlasFinding = z.infer<typeof atlasFindingSchema>;

/* -------------------------------------------------------------- sufficiency */

/**
 * AFD-5D2A — the sufficiency verdict, NORMALIZED AND BACKEND-OWNED.
 *
 * AFD-5D2 received a two-branch union that could not express "this report is
 * real but one comparison is missing", which is why its CRM derived a `partial`
 * state in the browser. The backend now publishes a three-valued status plus a
 * list of coded issues, and this UI renders exactly that.
 *
 * AFD-5D3 CLOSED THE REASON VOCABULARY. AFD-5D2A had `code` as an open
 * `z.string()` so an unknown reason degraded to a fallback label instead of
 * blanking the page. That is no longer accepted: the contract publishes seven
 * reason codes and an eighth is a violation of it, handled like any other —
 * reject the whole response and show the bounded contract-error state.
 *
 * `KNOWN_REASON_CODES` is therefore now a VALIDATION vocabulary as well as a
 * labelling one.
 */
export const ATLAS_SUFFICIENCY_STATUSES = ["complete", "partial", "insufficient"] as const;
export const atlasSufficiencyStatusSchema = z.enum(ATLAS_SUFFICIENCY_STATUSES);
export type AtlasSufficiencyStatus = (typeof ATLAS_SUFFICIENCY_STATUSES)[number];

/**
 * The backend's closed reason catalog. AFD-5D3 made this the VALIDATION
 * vocabulary, not merely a labelling one — see `atlasSufficiencyIssueSchema`.
 */
export const KNOWN_REASON_CODES = [
  "SAMPLE_TOO_SMALL",
  "COHORT_FOLLOWUP_INCOMPLETE",
  "COMPARISON_PERIOD_UNAVAILABLE",
  "MIXED_CURRENCY",
  "BREAKDOWN_TRUNCATED",
  "METRIC_UNAVAILABLE",
  "INTEGRITY_WARNING",
] as const;

/**
 * AFD-5D3 — the reason vocabulary is CLOSED.
 *
 * AFD-5D2A left `code` as an open `z.string()` so that a backend adding a reason
 * would produce a labelling gap rather than a blank page. AFD-5D3 reverses that
 * by decision: the published contract is a closed seven-code catalog, and a code
 * outside it is a CONTRACT VIOLATION, not a presentation gap.
 *
 * THE TRADE THIS MAKES, STATED PLAINLY. A backend that starts emitting an eighth
 * reason code now fails the whole response here until the CRM ships the code.
 * That couples the two releases, and it is the intended behaviour: an
 * unrecognised limitation must never be rendered as a vague sentence an operator
 * might read as "nothing important".
 *
 * There is deliberately NO fallback label. Inventing generic prose for a code
 * this release does not understand would be exactly the invented analytical
 * meaning the whole agent is built to avoid.
 */
export const atlasReasonCodeSchema = z.enum(KNOWN_REASON_CODES);
export type AtlasReasonCode = (typeof KNOWN_REASON_CODES)[number];

export const atlasSufficiencyIssueSchema = z
  .object({
    code: atlasReasonCodeSchema,
    scope: z.string().min(1).optional(),
    details: z.record(z.string(), z.string()).optional(),
    evidence: z.array(atlasEvidenceSchema),
  })
  .strict();

export type AtlasSufficiencyIssue = z.infer<typeof atlasSufficiencyIssueSchema>;

export const atlasSufficiencySchema = z
  .object({
    status: atlasSufficiencyStatusSchema,
    issues: z.array(atlasSufficiencyIssueSchema),
  })
  .strict();

export type AtlasSufficiency = z.infer<typeof atlasSufficiencySchema>;


/**
 * AFD-5D2A — the top-level result status, the one word an operator acts on.
 *
 * A closed enum: an unsupported status is a contract violation, not something
 * this UI renders. `partial` is now a BACKEND value; the CRM no longer derives
 * one, and `atlas-derivation-guard.test.ts` fails the build if it starts again.
 */
export const ATLAS_STATUSES = ["ok", "partial", "insufficient_data"] as const;
export const atlasStatusSchema = z.enum(ATLAS_STATUSES);
export type AtlasStatus = (typeof ATLAS_STATUSES)[number];

/* ----------------------------------------------------------------- overview */

/**
 * The headline block.
 *
 * `headlineMetrics` is an open string→string record because the metric SET
 * differs by mode — event-date publishes six, cohort publishes three — and
 * pinning either shape here would reject the other. Every value is a string
 * exactly as the backend published it, and the UI labels known keys and shows
 * unknown ones under their raw key rather than dropping them.
 */
export const atlasOverviewSchema = z
  .object({
    mode: atlasModeSchema,
    coverage: atlasCoverageSchema,
    filtered: z.boolean(),
    breakdownDimension: z.string().min(1),
    bucketCount: z.number().int().nonnegative(),
    findingCounts: z
      .object({
        observation: z.number().int().nonnegative(),
        warning: z.number().int().nonnegative(),
        positive_signal: z.number().int().nonnegative(),
        question: z.number().int().nonnegative(),
      })
      .strict(),
    headlineMetrics: z.record(z.string(), z.string()),
  })
  .strict();

export type AtlasOverview = z.infer<typeof atlasOverviewSchema>;

/* ------------------------------------------------------------ resolved request */

/** The period as the SERVER resolved it, not as the caller spelled it. */
export const atlasResolvedPeriodSchema = z
  .object({
    resolvedPreset: z.string().min(1),
    timezone: z.string().min(1),
    weekStart: z.string().min(1),
    startUtc: z.string().nullable(),
    endUtc: z.string().min(1),
    startLocal: z.string().nullable(),
    endLocal: z.string().min(1),
    intervalConvention: z.string().min(1),
  })
  .strict();

export const atlasResolvedCutoffSchema = z
  .object({
    cutoffUtc: z.string().min(1),
    cutoffLocal: z.string().min(1),
    /**
     * NULL when the cutoff came from the report clock rather than from an
     * explicit date the operator supplied — `cohort-time.ts` returns
     * `string | null`. The isolated browser journey caught this: the schema
     * originally required a string and refused every default-cutoff cohort
     * report as a contract violation.
     */
    cutoffDateLocal: z.string().nullable(),
    source: z.string().min(1),
    clampedToReportClock: z.boolean(),
    intervalConvention: z.string().min(1),
  })
  .strict();

/**
 * Filters echoed as STRINGS or null.
 *
 * The backend serializes ids as strings so a JavaScript client cannot lose
 * precision on a large id. Nothing here converts them back to numbers.
 */
export const atlasResolvedFiltersSchema = z
  .object({
    affiliatePartnerId: z.string().nullable(),
    affiliateCampaignId: z.string().nullable(),
    affiliateTrackingLinkId: z.string().nullable(),
  })
  .strict();

export const atlasResolvedRequestSchema = z
  .object({
    mode: atlasModeSchema,
    period: atlasResolvedPeriodSchema,
    cutoff: atlasResolvedCutoffSchema.nullable(),
    filters: atlasResolvedFiltersSchema,
    group: atlasGroupSchema,
    dimension: atlasDimensionSchema,
  })
  .strict();

export type AtlasResolvedRequest = z.infer<typeof atlasResolvedRequestSchema>;

/* --------------------------------------------------------------- thresholds */

/**
 * Every threshold the rules consulted, published so a reader can see WHY a
 * finding fired without reading backend source.
 *
 * Deliberately an open record: thresholds are a reviewable list that a later
 * catalog version may extend, and rejecting a new one would blank a report over
 * a number shown in a disclosure.
 */
export const atlasThresholdsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number()]),
);

/* ----------------------------------------------------------------- response */

/**
 * The complete published response.
 *
 * `.strict()` at the top level is what rejects `opportunities`: a body carrying
 * the pre-normalization name fails here and never reaches a component.
 */
export const atlasReportSchema = z
  .object({
    /** REQUIRED. A response with no backend status is a contract violation. */
    status: atlasStatusSchema,
    agent: atlasAgentSchema,
    engine: atlasEngineSchema,
    inputFingerprint: z.string().min(1),
    overview: atlasOverviewSchema,
    dataSufficiency: atlasSufficiencySchema,
    observations: z.array(atlasFindingSchema),
    warnings: z.array(atlasFindingSchema),
    positiveSignals: z.array(atlasFindingSchema),
    questions: z.array(atlasFindingSchema),
    thresholds: atlasThresholdsSchema,
    request: atlasResolvedRequestSchema,
    requestId: z.string().min(1),
    generatedAt: z.string().min(1),
  })
  .strict();

export type AtlasReport = z.infer<typeof atlasReportSchema>;

/* ------------------------------------------------------------- the request */

/**
 * The request body.
 *
 * The backend refuses an unknown key with `crm.analysis.body_unknown_key`, so
 * this type is the whole vocabulary. `preset` and explicit dates are mutually
 * exclusive at the backend: dates are permitted only with `preset: "custom"`.
 */
export interface AtlasRequestBody {
  mode: AtlasMode;
  preset?: string;
  startDate?: string;
  endDate?: string;
  cutoffDate?: string;
  group?: AtlasGroup;
  dimension?: AtlasDimension;
  affiliatePartnerId?: string;
  affiliateCampaignId?: string;
  affiliateTrackingLinkId?: string;
}

/**
 * Exactly the keys the backend accepts, in one fixed order.
 *
 * Used to build the body deterministically, so two identical selections produce
 * a byte-identical request — which is what makes "the same request produces the
 * same visible result" checkable rather than assumed.
 */
export const ATLAS_BODY_KEY_ORDER: readonly (keyof AtlasRequestBody)[] = [
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
];
