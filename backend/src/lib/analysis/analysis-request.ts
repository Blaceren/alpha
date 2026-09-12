/**
 * AFD-5D1 — the closed request contract for the analysis endpoint.
 *
 * A JSON BODY, NOT A QUERY STRING, because the request carries a mode, two
 * period shapes, a cutoff, three dimension filters, a grouping and a breakdown
 * dimension, and a URL that long is one an operator cannot read. The keys are
 * nevertheless the SAME names the accepted GET routes use, so a caller does not
 * have to learn a second vocabulary and a reviewer can diff the two by eye.
 *
 * EVERY ACCEPTED KEY IS NAMED HERE and anything else is a 400. A silently
 * dropped parameter is the failure mode where an operator believes they analysed
 * one affiliate and in fact analysed everybody.
 *
 * PARSING DELEGATES TO THE ACCEPTED OWNERS. The period, the cutoff, the filters,
 * the grouping and the dimension are all resolved by the AFD-5B1/5B2A functions
 * the GET routes call, so this endpoint cannot drift into a second calendar, a
 * second week start or a second interval convention.
 */
import crypto from "node:crypto";
import { AffiliateInputError } from "@/lib/crm/affiliates";
import {
  DATE_PRESETS,
  BUCKET_GROUPS,
  resolvePeriod,
  type BucketGroup,
  type DatePreset,
  type ResolvedPeriod,
} from "@/lib/analytics/periods";
import { resolveCutoff, type ResolvedCutoff } from "@/lib/analytics/cohort-time";
import type { AnalyticsFilters } from "@/lib/analytics/affiliate-sources";
import type { BreakdownDimension } from "@/lib/analytics/affiliate-queries";
import { ANALYSIS_MODES, type AnalysisMode } from "./analysis-contract";

/** Every key the endpoint answers to. */
export const ANALYSIS_BODY_KEYS = [
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
] as const;

const BREAKDOWN_DIMENSIONS: readonly BreakdownDimension[] = [
  "affiliate",
  "campaign",
  "tracking_link",
];

export type AnalysisRequest = {
  readonly mode: AnalysisMode;
  readonly period: ResolvedPeriod;
  /** Present only in cohort mode; the event-date routes have no cutoff. */
  readonly cutoff: ResolvedCutoff | null;
  readonly filters: AnalyticsFilters;
  readonly group: BucketGroup;
  readonly dimension: BreakdownDimension;
};

function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new AffiliateInputError("crm.analysis.body_invalid");
  }
  return body as Record<string, unknown>;
}

/** A string field, or undefined. Anything non-string is refused, never coerced. */
function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new AffiliateInputError("crm.analysis.field_invalid");
  return value;
}

/**
 * A positive integer id.
 *
 * Accepts a number or its string spelling, because a JSON client may send either
 * and both are unambiguous — but refuses a float, a negative, a zero and
 * anything above nine digits, which is the same grammar the GET routes enforce.
 */
function readId(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;

  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value : null;
  if (text === null || !/^\d{1,9}$/.test(text.trim())) {
    throw new AffiliateInputError("crm.analysis.filter_invalid");
  }
  const parsed = Number(text.trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AffiliateInputError("crm.analysis.filter_invalid");
  }
  return parsed;
}

/**
 * Parse and resolve the whole request.
 *
 * `timezone` and `now` come from the accepted analytics request context, so the
 * business calendar is the deployment's single configured one.
 */
export function parseAnalysisRequest(
  body: unknown,
  timezone: string,
  now: Date,
): AnalysisRequest {
  const record = asRecord(body);

  for (const key of Object.keys(record)) {
    if (!(ANALYSIS_BODY_KEYS as readonly string[]).includes(key)) {
      throw new AffiliateInputError("crm.analysis.body_unknown_key");
    }
  }

  const rawMode = readString(record, "mode") ?? "event_date";
  if (!(ANALYSIS_MODES as readonly string[]).includes(rawMode)) {
    throw new AffiliateInputError("crm.analysis.mode_invalid");
  }
  const mode = rawMode as AnalysisMode;

  // A MISSING PRESET IS THE SAME EXPLICIT DEFAULT the GET routes apply, not an
  // open-ended query: without one, an omitted field would silently mean "all of
  // history".
  const preset = (readString(record, "preset") ?? "last_30_days") as DatePreset;
  if (!(DATE_PRESETS as readonly string[]).includes(preset)) {
    throw new AffiliateInputError("crm.analytics.preset_invalid");
  }
  const startDate = readString(record, "startDate");
  const endDate = readString(record, "endDate");

  // Dates beside a named preset leave it ambiguous which one won, and the answer
  // would be invisible in the response. Refused, exactly as the GET routes do.
  if (preset !== "custom" && (startDate !== undefined || endDate !== undefined)) {
    throw new AffiliateInputError("crm.analytics.dates_not_allowed");
  }

  // The accepted period owner applies the strict date-only grammar, the
  // Europe/Moscow calendar, the Monday week start and the [start, end) rule.
  const period = resolvePeriod(
    {
      preset,
      ...(startDate === undefined ? {} : { startDate }),
      ...(endDate === undefined ? {} : { endDate }),
    },
    timezone,
    now,
  );

  const rawGroup = readString(record, "group") ?? "day";
  if (!(BUCKET_GROUPS as readonly string[]).includes(rawGroup)) {
    throw new AffiliateInputError("crm.analytics.group_invalid");
  }

  const rawDimension = readString(record, "dimension") ?? "affiliate";
  if (!(BREAKDOWN_DIMENSIONS as readonly string[]).includes(rawDimension)) {
    throw new AffiliateInputError("crm.analytics.dimension_invalid");
  }

  const cutoffDate = readString(record, "cutoffDate");
  // A cutoff is a cohort-only input. Accepting it in event-date mode would let a
  // caller believe an observation window had been applied when none exists.
  if (cutoffDate !== undefined && mode !== "acquisition_cohort") {
    throw new AffiliateInputError("crm.analysis.cutoff_not_allowed");
  }
  const cutoff =
    mode === "acquisition_cohort"
      ? resolveCutoff(cutoffDate === undefined ? {} : { cutoffDate }, period, timezone, now)
      : null;

  const filters: AnalyticsFilters = {
    ...(readId(record, "affiliatePartnerId") === undefined
      ? {}
      : { affiliatePartnerId: readId(record, "affiliatePartnerId") }),
    ...(readId(record, "affiliateCampaignId") === undefined
      ? {}
      : { affiliateCampaignId: readId(record, "affiliateCampaignId") }),
    ...(readId(record, "affiliateTrackingLinkId") === undefined
      ? {}
      : { affiliateTrackingLinkId: readId(record, "affiliateTrackingLinkId") }),
  };

  return {
    mode,
    period,
    cutoff,
    filters,
    group: rawGroup as BucketGroup,
    dimension: rawDimension as BreakdownDimension,
  };
}

/* --------------------------------------------------------- fingerprinting */

/**
 * PRODUCT-RC-1 — a stable fingerprint of the RESOLVED request.
 *
 * WHAT GOES IN. Exactly the six things that decide which numbers come back:
 * mode, the resolved window, the resolved cutoff, the three dimension filters,
 * the time bucket and the breakdown dimension. Nothing else — not the clock, not
 * the caller, not the request id — because two operators asking the same
 * question at different moments must get the same fingerprint, and the same
 * operator asking about a different window must not.
 *
 * WHY RESOLVED AND NOT RAW. `{"preset":"last_30_days"}` and the custom dates it
 * resolves to are the same question and fingerprint identically. The same raw
 * body sent a day apart resolves to two different windows and fingerprints
 * differently. Hashing the raw body would get both cases exactly backwards.
 *
 * WHY A HAND-BUILT STRING AND NOT `JSON.stringify`. Object key order is a
 * property of how the object was built, so stringify would let an innocuous
 * refactor of `parseAnalysisRequest` silently change every fingerprint the
 * product has ever published. The field order here is fixed by this function and
 * by nothing else.
 *
 * Domain-separated so a fingerprint can never be confused with, or replayed as,
 * a hash from another part of the system. Truncated to 16 hex characters: ample
 * to distinguish the questions an operator can actually ask, far too little to
 * attack a preimage — and it carries no id an unauthorised caller could not
 * already have supplied itself.
 */
export function analysisInputFingerprint(request: AnalysisRequest): string {
  const parts = [
    `mode=${request.mode}`,
    // NOT `resolvedPreset`. A preset NAME is presentation: `last_30_days` and
    // the `custom` dates it resolves to select the same rows and return the same
    // numbers, so they are the same question and must fingerprint the same. The
    // rolling nature of a preset is already captured — completely — by the
    // resolved bounds below, which move when the window moves.
    `tz=${request.period.timezone}`,
    `startUtc=${request.period.startUtc === null ? "null" : request.period.startUtc.toISOString()}`,
    `endUtc=${request.period.endUtc.toISOString()}`,
    `cutoffUtc=${request.cutoff === null ? "null" : request.cutoff.cutoffUtc.toISOString()}`,
    `partner=${request.filters.affiliatePartnerId ?? "null"}`,
    `campaign=${request.filters.affiliateCampaignId ?? "null"}`,
    `link=${request.filters.affiliateTrackingLinkId ?? "null"}`,
    `group=${request.group}`,
    `dimension=${request.dimension}`,
  ];

  return crypto
    .createHash("sha256")
    .update(`ata.analysis.input.v1:${parts.join("&")}`)
    .digest("hex")
    .slice(0, 16);
}
