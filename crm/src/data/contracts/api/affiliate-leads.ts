/**
 * AFD-5C2 — the wire contracts for the affiliate lead API.
 *
 * EVERY SCHEMA IS `.strict()`, AND THAT IS THE PRIVACY CONTROL. The backend's
 * `lead-dto.ts` builds redacted rows from facts that never carried an email, a
 * User id, a click id or a Pocket identifier — but the CRM is a second process
 * and cannot verify that by reading it. So the browser refuses instead: a list
 * row or a default detail that arrives carrying `email`, `userId`, `clickId`,
 * `pocketPlayerId` or any other unlisted key FAILS PARSING and renders nothing.
 * A regression that started leaking identity through the list would therefore
 * show as a broken page, never as a page quietly displaying more than it should.
 *
 * THE REVEALED IDENTITY HAS ITS OWN SCHEMA AND ITS OWN DISCRIMINANT. `piiState`
 * is `"redacted"` on every list row and every detail, and `"revealed"` only in
 * the single-lead reveal response. The two are separate types that never widen
 * into one another, so no component can accidentally hold a revealed identity
 * where it expected a redacted one.
 *
 * NOTHING HERE IS RECOMPUTED. Journey stage, deposit state, attribution state,
 * the timeline order, the resolved periods and the availability reasons are all
 * read verbatim from the response. There is no derived field in this file.
 */
import { z } from "zod";

/* ------------------------------------------------------------------- errors */

/** The backend's closed error envelope, shared by all three lead routes. */
export const leadErrorSchema = z
  .object({
    code: z.string().min(1),
    messageKey: z.string().min(1),
    requestId: z.string().min(1).optional(),
  })
  .strict();

/* ------------------------------------------------------------------ periods */

export const leadDatePresetSchema = z.enum([
  "today",
  "yesterday",
  "current_week",
  "previous_week",
  "last_7_days",
  "last_30_days",
  "current_month",
  "previous_month",
  "custom",
  "all_time",
]);
export type LeadDatePreset = z.infer<typeof leadDatePresetSchema>;

/**
 * The period the BACKEND resolved, echoed for display.
 *
 * `weekStart` and `intervalConvention` are literals rather than free strings: if
 * the backend ever stopped using Monday weeks or `[start, end)` the response
 * would fail to parse instead of being drawn under a caption that had become a
 * lie. The CRM never computes a boundary of its own — see `leads-controls.tsx`.
 */
export const leadResolvedPeriodSchema = z
  .object({
    resolvedPreset: leadDatePresetSchema,
    timezone: z.string().min(1),
    weekStart: z.literal("monday"),
    startUtc: z.string().datetime().nullable(),
    endUtc: z.string().datetime(),
    startLocal: z.string().min(1).nullable(),
    endLocal: z.string().min(1),
    intervalConvention: z.literal("start_inclusive_end_exclusive"),
  })
  .strict();
export type LeadResolvedPeriod = z.infer<typeof leadResolvedPeriodSchema>;

/* ------------------------------------------------------------------- states */

export const leadJourneyStageSchema = z.enum([
  "academy_registered",
  "pocket_registered",
  "first_deposit_confirmed",
]);
export type LeadJourneyStage = z.infer<typeof leadJourneyStageSchema>;

export const leadDepositStateSchema = z.enum([
  "none",
  "pending_identity",
  "conflict",
  "confirmed",
]);
export type LeadDepositState = z.infer<typeof leadDepositStateSchema>;

export const leadAttributionStateSchema = z.enum(["attributed", "unattributed"]);
export type LeadAttributionState = z.infer<typeof leadAttributionStateSchema>;

/**
 * The bounded integrity vocabulary.
 *
 * A CLOSED ENUM RATHER THAN `z.string()`. An unknown flag would have no label
 * and would render as a raw snake_case token beside a learner's record; failing
 * the parse instead means a backend that grew a new finding is noticed during
 * integration rather than shipped as debug text in an operator's face.
 */
export const leadIntegrityFlagSchema = z.enum([
  "duplicate_academy_registration",
  "attribution_clicks_incomplete",
  "pocket_identity_untrusted_source",
  "multiple_provider_deposit_events",
  "deposit_pending_after_identity_binding",
  "confirmed_deposit_without_provider_event",
  "duplicate_first_deposit_conversion",
  "negative_journey_duration",
  "acquisition_after_registration",
]);
export type LeadIntegrityFlag = z.infer<typeof leadIntegrityFlagSchema>;

export const leadConflictCategorySchema = z.enum([
  "click_id_mismatch",
  "amount_mismatch",
  "identity_owner_mismatch",
  "click_owner_missing",
]);
export type LeadConflictCategory = z.infer<typeof leadConflictCategorySchema>;

/* ----------------------------------------------------------------- identity */

/**
 * The redacted identity every list row and every default detail carries.
 *
 * `displayName` is `z.null()` — not `z.string().nullable()`. The backend drops
 * the name entirely rather than masking it, and pinning the literal null means a
 * response that started sending a real name would be REJECTED here instead of
 * rendered. `piiState` is likewise the literal `"redacted"`.
 */
export const redactedLeadIdentitySchema = z.object({
  leadId: z.string().min(1),
  maskedEmail: z.string().min(1),
  displayName: z.null(),
  piiState: z.literal("redacted"),
});

/**
 * The ONLY shape that carries full identity. Reachable exclusively from the
 * reveal response, and `.strict()` so no extra field — a phone, an IP, a Pocket
 * id — can ride along with it.
 */
export const revealedLeadIdentitySchema = z
  .object({
    leadId: z.string().min(1),
    email: z.string().min(1),
    displayName: z.string().nullable(),
    piiState: z.literal("revealed"),
  })
  .strict();
export type RevealedLeadIdentity = z.infer<typeof revealedLeadIdentitySchema>;

/* --------------------------------------------------------------- dimensions */

export const leadDimensionSummarySchema = z
  .object({
    id: z.string().min(1),
    code: z.string().min(1),
    displayName: z.string().min(1),
  })
  .strict();
export type LeadDimensionSummary = z.infer<typeof leadDimensionSummarySchema>;

/* -------------------------------------------------------------- acquisition */

/**
 * The frozen acquisition record.
 *
 * A DISCRIMINATED UNION, so a direct lead cannot be given an affiliate. The
 * `unattributed` branch pins every acquisition field to `null`: there is no
 * representable value in which a direct registration carries a partner, a touch
 * timestamp or a selection reason, which is what makes "no synthetic affiliate"
 * a type-level guarantee rather than a rendering convention.
 */
export const leadAcquisitionSummarySchema = z.discriminatedUnion("attributionState", [
  z
    .object({
      attributionState: z.literal("attributed"),
      affiliate: leadDimensionSummarySchema,
      campaign: leadDimensionSummarySchema.nullable(),
      trackingLink: leadDimensionSummarySchema.nullable(),
      firstTouchAt: z.string().datetime().nullable(),
      lastTouchAt: z.string().datetime().nullable(),
      selectedTouchAt: z.string().datetime().nullable(),
      acquisitionModel: z.string().min(1).nullable(),
      selectionReason: z.string().min(1).nullable(),
      frozenAt: z.string().datetime().nullable(),
    })
    .strict(),
  z
    .object({
      attributionState: z.literal("unattributed"),
      affiliate: z.null(),
      campaign: z.null(),
      trackingLink: z.null(),
      firstTouchAt: z.null(),
      lastTouchAt: z.null(),
      selectedTouchAt: z.null(),
      acquisitionModel: z.null(),
      selectionReason: z.null(),
      frozenAt: z.null(),
    })
    .strict(),
]);
export type LeadAcquisitionSummary = z.infer<typeof leadAcquisitionSummarySchema>;

/* ------------------------------------------------------------------ deposit */

/**
 * The amount, under the backend's currency-availability contract.
 *
 * A union rather than an optional number, so "1500.00" with no stated currency
 * is UNREPRESENTABLE. There is no USD fallback anywhere in the CRM because
 * there is no branch here that produces an amount without a currency code.
 */
export const leadAmountAvailabilitySchema = z.union([
  z.object({ available: z.literal(true) }).strict(),
  z.object({ available: z.literal(false), reason: z.string().min(1) }).strict(),
]);

export const leadDepositSummarySchema = z
  .object({
    depositState: leadDepositStateSchema,
    firstReceivedAt: z.string().datetime().nullable(),
    confirmedAt: z.string().datetime().nullable(),
    conflictDetectedAt: z.string().datetime().nullable(),
    amountAvailability: leadAmountAvailabilitySchema,
    providerAmount: z.string().min(1).nullable(),
    currencyCode: z.string().min(1).nullable(),
    currencyStatus: z.string().min(1).nullable(),
    conflictCategory: leadConflictCategorySchema.nullable(),
    /** Whether the provider redelivered at all. Never a redeposit count. */
    replayObserved: z.boolean(),
  })
  .strict();
export type LeadDepositSummary = z.infer<typeof leadDepositSummarySchema>;

/* ----------------------------------------------------------------- timeline */

export const leadTimelineEventTypeSchema = z.enum([
  "acquisition_first_touch",
  "acquisition_last_touch",
  "acquisition_selected",
  "academy_registration",
  "pocket_registration",
  "first_deposit_received_pending",
  "first_deposit_conflict_detected",
  "first_deposit_confirmed",
]);
export type LeadTimelineEventType = z.infer<typeof leadTimelineEventTypeSchema>;

export const leadTouchRoleSchema = z.enum(["first_touch", "last_touch", "selected"]);
export type LeadTouchRole = z.infer<typeof leadTouchRoleSchema>;

export const leadTimelineSourceCategorySchema = z.enum([
  "acquisition",
  "academy",
  "provider_identity",
  "provider_deposit",
  "conversion_ledger",
]);
export type LeadTimelineSourceCategory = z.infer<typeof leadTimelineSourceCategorySchema>;

export const leadTimelineStateSchema = z.enum(["recorded", "pending", "conflict", "confirmed"]);
export type LeadTimelineState = z.infer<typeof leadTimelineStateSchema>;

/**
 * One timeline item.
 *
 * `dimension` is a tracking-link display name and public code and NOTHING ELSE
 * — `.strict()` refuses a click id, a visitor id or a raw row id that a future
 * change might append. `occurredAt` is the instant and `localOccurredAt` is the
 * backend's own Europe/Moscow rendering of it, so the browser never converts a
 * timestamp into a local wall clock of its own.
 */
export const leadTimelineItemSchema = z
  .object({
    eventType: leadTimelineEventTypeSchema,
    occurredAt: z.string().datetime(),
    localOccurredAt: z.string().min(1),
    titleKey: z.string().min(1),
    state: leadTimelineStateSchema,
    sourceCategory: leadTimelineSourceCategorySchema,
    roles: z.array(leadTouchRoleSchema).nullable(),
    dimension: z
      .object({
        trackingLinkPublicCode: z.string().min(1),
        displayName: z.string().min(1),
      })
      .strict()
      .nullable(),
    integrityFlags: z.array(leadIntegrityFlagSchema),
  })
  .strict();
export type LeadTimelineItem = z.infer<typeof leadTimelineItemSchema>;

export const leadTimelineSchema = z
  .object({
    items: z.array(leadTimelineItemSchema),
    truncated: z.boolean(),
    maxItems: z.number().int().positive(),
    integrityFlags: z.array(leadIntegrityFlagSchema),
  })
  .strict();
export type LeadTimeline = z.infer<typeof leadTimelineSchema>;

/* ------------------------------------------------------------- availability */

export const leadAvailabilityStateSchema = z.union([
  z.object({ available: z.literal(true) }).strict(),
  z.object({ available: z.literal(false), reason: z.string().min(1) }).strict(),
]);
export type LeadAvailabilityState = z.infer<typeof leadAvailabilityStateSchema>;

/**
 * The first deposit has FOUR outcomes rather than two, because "not yet",
 * "we cannot say whose it is" and "it disagreed with itself" are three different
 * absences an operator must act on differently.
 */
export const leadDepositAvailabilitySchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("available") }).strict(),
  z.object({ state: z.literal("pending"), reason: z.string().min(1) }).strict(),
  z.object({ state: z.literal("conflict"), reason: z.string().min(1) }).strict(),
  z.object({ state: z.literal("absent"), reason: z.string().min(1) }).strict(),
]);
export type LeadDepositAvailability = z.infer<typeof leadDepositAvailabilitySchema>;

export const leadDataAvailabilitySchema = z
  .object({
    acquisition: leadAvailabilityStateSchema,
    academyRegistration: leadAvailabilityStateSchema,
    pocketRegistration: leadAvailabilityStateSchema,
    firstDeposit: leadDepositAvailabilitySchema,
    redeposit: leadAvailabilityStateSchema,
    currentBalance: leadAvailabilityStateSchema,
    educationTimeline: leadAvailabilityStateSchema,
    trafficSubParameters: leadAvailabilityStateSchema,
  })
  .strict();
export type LeadDataAvailability = z.infer<typeof leadDataAvailabilitySchema>;

/* ---------------------------------------------------------------- list rows */

export const leadSortSchema = z.enum([
  "registration_desc",
  "registration_asc",
  "acquisition_desc",
  "acquisition_asc",
  "pocket_registration_desc",
  "first_deposit_desc",
]);
export type LeadSort = z.infer<typeof leadSortSchema>;

/**
 * One redacted list row.
 *
 * `.strict()` on top of the redacted identity. THE LIST HAS NO TIMELINE FIELD
 * and no identity field, and a response that grew either would be refused: a
 * list carrying full histories is the shape in which a page quietly becomes a
 * bulk export.
 */
export const leadListRowSchema = redactedLeadIdentitySchema
  .extend({
    academyRegisteredAt: z.string().datetime(),
    selectedAcquisitionAt: z.string().datetime().nullable(),
    pocketRegisteredAt: z.string().datetime().nullable(),
    firstDepositAt: z.string().datetime().nullable(),
    journeyStage: leadJourneyStageSchema,
    depositState: leadDepositStateSchema,
    attributionState: leadAttributionStateSchema,
    affiliate: leadDimensionSummarySchema.nullable(),
    campaign: leadDimensionSummarySchema.nullable(),
    trackingLink: leadDimensionSummarySchema.nullable(),
    integrityFlags: z.array(leadIntegrityFlagSchema),
    /** A capability HINT for the UI. The reveal route re-checks independently. */
    canRevealPii: z.boolean(),
  })
  .strict();
export type LeadListRow = z.infer<typeof leadListRowSchema>;

export const leadListSchema = z
  .object({
    filters: z
      .object({
        affiliatePartnerId: z.string().min(1).nullable(),
        affiliateCampaignId: z.string().min(1).nullable(),
        affiliateTrackingLinkId: z.string().min(1).nullable(),
        attributionState: leadAttributionStateSchema.nullable(),
        journeyStage: leadJourneyStageSchema.nullable(),
        depositState: leadDepositStateSchema.nullable(),
      })
      .strict(),
    periods: z
      .object({
        registration: leadResolvedPeriodSchema.nullable(),
        acquisition: leadResolvedPeriodSchema.nullable(),
      })
      .strict(),
    sort: leadSortSchema,
    supportedSorts: z.array(leadSortSchema),
    pageSize: z.number().int().positive(),
    defaultPageSize: z.number().int().positive(),
    maxPageSize: z.number().int().positive(),
    hasMore: z.boolean(),
    /** Opaque. Never decoded, never parsed, never inspected by the browser. */
    nextCursor: z.string().min(1).nullable(),
    rows: z.array(leadListRowSchema),
    generatedAt: z.string().datetime(),
  })
  .strict();
export type LeadList = z.infer<typeof leadListSchema>;

/* --------------------------------------------------------------- lead detail */

export const leadJourneySummarySchema = z
  .object({
    journeyStage: leadJourneyStageSchema,
    academyRegisteredAt: z.string().datetime(),
    pocketRegisteredAt: z.string().datetime().nullable(),
    firstDepositConfirmedAt: z.string().datetime().nullable(),
  })
  .strict();
export type LeadJourneySummary = z.infer<typeof leadJourneySummarySchema>;

/**
 * The default detail. REDACTED FOR EVERY ROLE, INCLUDING crm_admin — there is
 * no branch of this schema that carries an address, so no permission and no
 * query parameter can make this response render one.
 */
export const leadDetailSchema = redactedLeadIdentitySchema
  .extend({
    acquisition: leadAcquisitionSummarySchema,
    journey: leadJourneySummarySchema,
    deposit: leadDepositSummarySchema,
    timeline: leadTimelineSchema,
    integrityFlags: z.array(leadIntegrityFlagSchema),
    canRevealPii: z.boolean(),
  })
  .strict();
export type LeadDetail = z.infer<typeof leadDetailSchema>;

export const leadDetailResponseSchema = z
  .object({
    lead: leadDetailSchema,
    dataAvailability: leadDataAvailabilitySchema,
    generatedAt: z.string().datetime(),
  })
  .strict();
export type LeadDetailResponse = z.infer<typeof leadDetailResponseSchema>;

/* --------------------------------------------------------------- the reveal */

export const leadRevealResponseSchema = z
  .object({
    identity: revealedLeadIdentitySchema,
    revealedAt: z.string().datetime(),
  })
  .strict();
export type LeadRevealResponse = z.infer<typeof leadRevealResponseSchema>;

/* ------------------------------------------------------------- lead id shape */

/**
 * The public lead reference: `v1_` and a 32-character base32 body.
 *
 * Validated in the browser ONLY to keep a malformed path segment from becoming
 * a pointless request, never as an authorization decision. The backend owns the
 * real parse and answers 400 for a bad reference and 404 for an unknown one.
 */
export const LEAD_ID_PATTERN = /^v1_[a-z2-7]{32}$/;

export function isWellFormedLeadId(value: string): boolean {
  return LEAD_ID_PATTERN.test(value);
}
