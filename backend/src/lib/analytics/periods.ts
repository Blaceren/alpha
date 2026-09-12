/**
 * AFD-5B1 — date presets, custom ranges, all-time, and time-bucket construction.
 *
 * ONE INTERVAL CONVENTION EVERYWHERE: `[start, end)`. Start is inclusive, end is
 * exclusive, at every level — the report period, every day bucket, every week
 * bucket and every month bucket. Mixing conventions is how an event lands in two
 * buckets or in none, and how a "today" total stops equalling the sum of its
 * hours. There is deliberately no inclusive-end spelling anywhere in this file.
 *
 * THE PRESETS ARE CALENDAR FACTS, NOT ROLLING WINDOWS OF MILLISECONDS. "Previous
 * month" is the previous Moscow month, not "31 days ago"; "current week" opens
 * on Monday. All of it is computed from local calendar fields and converted to
 * UTC exactly once, at the end.
 */
import {
  addLocalDays,
  addLocalMonths,
  atLocalMidnight,
  INTERVAL_CONVENTION,
  localDateLabel,
  localMonthLabel,
  localWallClockLabel,
  localWallClockToUtc,
  parseLocalDateOnly,
  startOfLocalMonth,
  startOfLocalWeek,
  toLocalParts,
  type LocalParts,
} from "@/lib/analytics/business-time";

export const DATE_PRESETS = [
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
] as const;

export type DatePreset = (typeof DATE_PRESETS)[number];

export const BUCKET_GROUPS = ["day", "week", "month"] as const;
export type BucketGroup = (typeof BUCKET_GROUPS)[number];

/**
 * The bound on how much a single response may describe.
 *
 * Enforced by REFUSING an oversized request rather than truncating it: a
 * silently shortened series is a chart that is missing its left-hand side with
 * nothing on screen saying so.
 */
export const MAX_BUCKETS = 400;

/**
 * The longest custom interval. Five years is far beyond any reporting need this
 * product has, and `all_time` is the explicit, documented way to ask for more.
 */
export const MAX_CUSTOM_RANGE_DAYS = 366 * 5;

/** Raised for any bad period input. The route maps it to a 400. */
export class AnalyticsPeriodError extends Error {
  readonly messageKey: string;
  constructor(messageKey: string) {
    super(messageKey);
    this.name = "AnalyticsPeriodError";
    this.messageKey = messageKey;
  }
}

/**
 * A resolved reporting interval.
 *
 * `startUtc` and `startLocal` are null ONLY for `all_time`, which by definition
 * has no artificial historical cutoff. `endUtc` is always present and always
 * exclusive, including for `all_time`, where it is the resolved report time — so
 * a caller can tell exactly how much of "now" the answer includes.
 */
export type ResolvedPeriod = {
  readonly resolvedPreset: DatePreset;
  readonly timezone: string;
  readonly startUtc: Date | null;
  readonly endUtc: Date;
  readonly startLocal: string | null;
  readonly endLocal: string;
  readonly intervalConvention: typeof INTERVAL_CONVENTION;
};

export type PeriodInput = {
  readonly preset: DatePreset;
  /** `YYYY-MM-DD`, required for and only for `custom`. */
  readonly startDate?: string;
  readonly endDate?: string;
};

const DAY_MS = 86_400_000;

function boundary(parts: LocalParts, timeZone: string): Date {
  return localWallClockToUtc(parts, timeZone);
}

/**
 * Resolve a preset into a concrete UTC interval.
 *
 * `now` is injected rather than read from the clock inside, so a test can freeze
 * it and so two metrics in one response cannot straddle a tick.
 *
 * THE `last_7_days` / `last_30_days` CONVENTION, stated once and applied to
 * both: COMPLETE CALENDAR DAYS, ending at the start of today. "Last 7 days" is
 * the seven whole business days before today; today is excluded because it is
 * still running, and including a partial day would make the series dip at the
 * right-hand edge every time it is viewed before midnight. A caller who wants
 * today has the `today` preset, and one who wants both has a custom range.
 */
export function resolvePeriod(
  input: PeriodInput,
  timeZone: string,
  now: Date,
): ResolvedPeriod {
  const nowLocal = toLocalParts(now, timeZone);
  const todayStart = atLocalMidnight(nowLocal);

  const build = (startParts: LocalParts | null, endParts: LocalParts): ResolvedPeriod => ({
    resolvedPreset: input.preset,
    timezone: timeZone,
    startUtc: startParts === null ? null : boundary(startParts, timeZone),
    endUtc: boundary(endParts, timeZone),
    startLocal: startParts === null ? null : localWallClockLabel(startParts),
    endLocal: localWallClockLabel(endParts),
    intervalConvention: INTERVAL_CONVENTION,
  });

  switch (input.preset) {
    case "today":
      return build(todayStart, addLocalDays(todayStart, 1));

    case "yesterday":
      return build(addLocalDays(todayStart, -1), todayStart);

    case "current_week": {
      const monday = startOfLocalWeek(todayStart);
      return build(monday, addLocalDays(monday, 7));
    }

    case "previous_week": {
      const monday = startOfLocalWeek(todayStart);
      return build(addLocalDays(monday, -7), monday);
    }

    case "last_7_days":
      return build(addLocalDays(todayStart, -7), todayStart);

    case "last_30_days":
      return build(addLocalDays(todayStart, -30), todayStart);

    case "current_month": {
      const first = startOfLocalMonth(todayStart);
      return build(first, addLocalMonths(first, 1));
    }

    case "previous_month": {
      const first = startOfLocalMonth(todayStart);
      return build(addLocalMonths(first, -1), first);
    }

    case "custom":
      return resolveCustom(input, timeZone);

    case "all_time":
      // No start cutoff at all, and the end is the resolved report instant
      // rather than a day boundary — an all-time total that silently stopped at
      // last midnight would under-report today's events with no way to tell.
      return {
        resolvedPreset: "all_time",
        timezone: timeZone,
        startUtc: null,
        endUtc: now,
        startLocal: null,
        endLocal: localWallClockLabel(toLocalParts(now, timeZone)),
        intervalConvention: INTERVAL_CONVENTION,
      };
  }
}

function resolveCustom(input: PeriodInput, timeZone: string): ResolvedPeriod {
  if (input.startDate === undefined || input.endDate === undefined) {
    throw new AnalyticsPeriodError("crm.analytics.custom_range_required");
  }

  const start = parseLocalDateOnly(input.startDate);
  const end = parseLocalDateOnly(input.endDate);
  if (start === null || end === null) {
    throw new AnalyticsPeriodError("crm.analytics.date_invalid");
  }

  const startUtc = boundary(start, timeZone);
  const endUtc = boundary(end, timeZone);

  // Strictly before: an empty interval is a caller mistake, not a report.
  if (startUtc.getTime() >= endUtc.getTime()) {
    throw new AnalyticsPeriodError("crm.analytics.range_reversed");
  }
  if (endUtc.getTime() - startUtc.getTime() > MAX_CUSTOM_RANGE_DAYS * DAY_MS) {
    throw new AnalyticsPeriodError("crm.analytics.range_too_large");
  }

  return {
    resolvedPreset: "custom",
    timezone: timeZone,
    startUtc,
    endUtc,
    startLocal: localWallClockLabel(start),
    endLocal: localWallClockLabel(end),
    intervalConvention: INTERVAL_CONVENTION,
  };
}

/* ---------------------------------------------------------------- buckets */

export type TimeBucket = {
  readonly localLabel: string;
  readonly startUtc: Date;
  readonly endUtc: Date;
};

/**
 * Split a period into contiguous, non-overlapping, gap-free local buckets.
 *
 * CLIPPED, NOT EXPANDED. A period that starts mid-month still produces a first
 * month bucket, but that bucket starts at the period start rather than at the
 * 1st — the sum of the buckets must equal the period total, so a bucket may
 * never reach outside the interval it partitions.
 *
 * INTERIOR ZEROES ARE INCLUDED because they are the point. A week with no
 * traffic is a fact about the week; omitting it would let a chart draw a
 * straight line through it.
 *
 * `seriesStart` supplies the left edge for `all_time`, which has none of its
 * own. It must be derived from data by the caller, never invented.
 */
export function buildBuckets(
  period: ResolvedPeriod,
  group: BucketGroup,
  seriesStart?: Date,
): TimeBucket[] {
  const start = period.startUtc ?? seriesStart ?? null;
  if (start === null) return [];
  if (start.getTime() >= period.endUtc.getTime()) return [];

  const timeZone = period.timezone;
  const buckets: TimeBucket[] = [];

  // The first bucket's LABEL comes from the calendar unit containing the period
  // start, while its boundary is the period start itself. That is what "clipped"
  // means: a series beginning on the 10th labels its first month bucket with
  // that month, not with the 1st it does not cover.
  let cursor = alignDown(toLocalParts(start, timeZone), group);

  while (buckets.length <= MAX_BUCKETS) {
    const next = advance(cursor, group);
    const rawStart = localWallClockToUtc(cursor, timeZone);
    const rawEnd = localWallClockToUtc(next, timeZone);

    const clippedStart = rawStart.getTime() < start.getTime() ? start : rawStart;
    const clippedEnd =
      rawEnd.getTime() > period.endUtc.getTime() ? period.endUtc : rawEnd;

    if (clippedStart.getTime() < clippedEnd.getTime()) {
      buckets.push({
        localLabel: label(cursor, group),
        startUtc: clippedStart,
        endUtc: clippedEnd,
      });
    }

    if (rawEnd.getTime() >= period.endUtc.getTime()) break;
    cursor = next;
  }

  if (buckets.length > MAX_BUCKETS) {
    throw new AnalyticsPeriodError("crm.analytics.bucket_cap_exceeded");
  }
  return buckets;
}

/**
 * How many buckets a period/group pair would produce, WITHOUT building them.
 *
 * Used to refuse an oversized request before any work is done, so a caller
 * asking for five years of days is rejected rather than served a truncated
 * series or made to wait for 1 800 intervals to be materialised.
 */
export function countBuckets(
  period: ResolvedPeriod,
  group: BucketGroup,
  seriesStart?: Date,
): number {
  const start = period.startUtc ?? seriesStart ?? null;
  if (start === null) return 0;
  if (start.getTime() >= period.endUtc.getTime()) return 0;

  let cursor = alignDown(toLocalParts(start, period.timezone), group);
  let total = 0;
  while (total <= MAX_BUCKETS + 1) {
    const next = advance(cursor, group);
    total += 1;
    if (localWallClockToUtc(next, period.timezone).getTime() >= period.endUtc.getTime()) break;
    cursor = next;
  }
  return total;
}

function alignDown(parts: LocalParts, group: BucketGroup): LocalParts {
  switch (group) {
    case "day":
      return atLocalMidnight(parts);
    case "week":
      return startOfLocalWeek(parts);
    case "month":
      return startOfLocalMonth(parts);
  }
}

function advance(parts: LocalParts, group: BucketGroup): LocalParts {
  switch (group) {
    case "day":
      return addLocalDays(parts, 1);
    case "week":
      return addLocalDays(parts, 7);
    case "month":
      return addLocalMonths(parts, 1);
  }
}

/**
 * The bucket's local label.
 *
 * A week is labelled with the local date of ITS MONDAY, which is a date a reader
 * can look up, rather than an ISO week number nobody agrees the rules for.
 */
function label(parts: LocalParts, group: BucketGroup): string {
  switch (group) {
    case "day":
      return localDateLabel(parts);
    case "week":
      return localDateLabel(parts);
    case "month":
      return localMonthLabel(parts);
  }
}
