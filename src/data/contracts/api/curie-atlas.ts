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
export const atlasFindingSchema = z
  .object({
    code: z.string().min(1),
    section: atlasSectionSchema,
    severity: atlasSeveritySchema,
    message: z.string().min(1),
    evidence: z.array(atlasEvidenceSchema),
    dimensionId: z.number().int().nullable(),
  })
  .strict();

export type AtlasFinding = z.infer<typeof atlasFindingSchema>;

/* -------------------------------------------------------------- sufficiency */

/**
 * The sufficiency verdict, as a discriminated union.
 *
 * TWO STATUSES EXIST IN THIS BACKEND RELEASE: `sufficient` and
 * `insufficient_data`. There is no `partial` status in the DTO. The phase brief
 * anticipates a third result state, and this CRM derives one for PRESENTATION
 * only — see `deriveResultStatus` in `atlas-status.ts`, which is built from the
 * backend's own availability and integrity findings and is never presented as a
 * backend status.
 *
 * `reason` is `z.string()` rather than an enum ON PURPOSE. §12 requires that an
 * unknown reason code render through a safe generic fallback instead of
 * crashing the page, and an enum here would turn a new backend reason into a
 * blank screen. The known codes are enumerated in `KNOWN_INSUFFICIENCY_REASONS`
 * for labelling, not for validation.
 */
export const atlasSufficiencySchema = z.union([
  z.object({ status: z.literal("sufficient") }).strict(),
  z
    .object({
      status: z.literal("insufficient_data"),
      reason: z.string().min(1),
      evidence: z.array(atlasEvidenceSchema),
    })
    .strict(),
]);

export type AtlasSufficiency = z.infer<typeof atlasSufficiencySchema>;

/**
 * The reason codes this backend release actually emits, plus the ones the brief
 * names for forward compatibility.
 *
 * THIS LIST IS FOR LABELLING ONLY and never for validation. A code absent from
 * it renders through the generic fallback with its raw code shown in technical
 * details, which is what keeps a backend addition from blanking the screen.
 */
export const KNOWN_INSUFFICIENCY_REASONS = [
  // Emitted by backend candidate 4511acf8.
  "no_events_in_period",
  "empty_cohort",
  // Named by the AFD-5D2 brief. Not emitted by this backend release; carried so
  // that if a later release adds one it renders with a reviewed label rather
  // than through the fallback.
  "SAMPLE_TOO_SMALL",
  "COHORT_FOLLOWUP_INCOMPLETE",
  "MIXED_CURRENCY",
  "COMPARISON_PERIOD_UNAVAILABLE",
  "BREAKDOWN_TRUNCATED",
] as const;

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
