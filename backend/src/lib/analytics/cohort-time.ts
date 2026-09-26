/**
 * AFD-5B2A — the conversion-observation cutoff and the follow-up window it implies.
 *
 * WHY A COHORT REPORT NEEDS A SECOND DATE. An event-date report has one interval
 * and every number lives inside it. A cohort report has TWO: the interval that
 * SELECTS the learners (when their acquisition click happened) and the instant
 * up to which their later conversions are OBSERVED. Without the second one, a
 * January cohort re-read in June silently gains three months of conversions and
 * nobody can reproduce the number they screenshotted in March.
 *
 * THE CUTOFF IS EXCLUSIVE, like every other boundary in this namespace. A
 * conversion at exactly the cutoff instant belongs to the next report, not this
 * one, so two adjacent cutoffs never count the same event twice.
 *
 * NOTHING HERE READS THE HOST CLOCK OR THE HOST TIMEZONE. The report instant is
 * injected by the caller — frozen once per request by `openAnalyticsRequest` —
 * and the calendar comes from `business-time`, whose zone is configuration.
 *
 * THE CALENDAR CONTRACT IS AFD-5B1'S, UNCHANGED. Europe/Moscow, Monday weeks,
 * `[start, end)`, the same ten presets, the same strict `YYYY-MM-DD` parser.
 * `cutoffDate` is the ONE addition this phase makes to the date contract, and it
 * is a cohort-only input: it exists because only a cohort report observes events
 * outside the interval that selected its population.
 */
import {
  addLocalDays,
  localWallClockLabel,
  localWallClockToUtc,
  parseLocalDateOnly,
  toLocalParts,
} from "@/lib/analytics/business-time";
import { AnalyticsPeriodError, type ResolvedPeriod } from "@/lib/analytics/periods";

/** Where the resolved cutoff came from, stated in every response. */
export type CutoffSource = "report_clock" | "explicit_date";

export type ResolvedCutoff = {
  /** Exclusive. No conversion at or after this instant is ever counted. */
  readonly cutoffUtc: Date;
  /** The cutoff as a local wall-clock reading, with no offset suffix. */
  readonly cutoffLocal: string;
  /** The requested local calendar date, or null when the report clock was used. */
  readonly cutoffDateLocal: string | null;
  readonly source: CutoffSource;
  /**
   * True when an explicit date named today, so "the end of that date" has not
   * happened yet and the effective cutoff is the report clock instead.
   *
   * Reported rather than hidden: it is the difference between a reproducible
   * historical report and one that will grow the next time it is run.
   */
  readonly clampedToReportClock: boolean;
};

/**
 * Resolve the observation cutoff for one cohort report.
 *
 * DEFAULT: the frozen report clock, so an unqualified request means "everything
 * known right now" rather than an accidental open window.
 *
 * EXPLICIT `cutoffDate`: a Europe/Moscow calendar date whose conversions are
 * observed THROUGH ITS END, so the resolved instant is the start of the
 * following local day. `2026-02-28` therefore includes a deposit at 23:59:59 on
 * the 28th and excludes one at 00:00:00 on the 1st.
 *
 * A FUTURE DATE IS REFUSED rather than clamped silently: asking for March while
 * it is February is a mistake in the question, and answering it with February's
 * numbers would look like March had no conversions.
 *
 * A CUTOFF AT OR BEFORE THE COHORT START IS REFUSED: no member of the cohort can
 * have registered before their own acquisition click, so the report would be
 * empty by construction and would say nothing about the cohort.
 */
export function resolveCutoff(
  input: { readonly cutoffDate?: string },
  period: ResolvedPeriod,
  timeZone: string,
  now: Date,
): ResolvedCutoff {
  const resolved = input.cutoffDate === undefined
    ? reportClockCutoff(timeZone, now)
    : explicitCutoff(input.cutoffDate, timeZone, now);

  // Strictly after: an interval that opens at or after its own observation
  // instant observes nothing at all.
  if (period.startUtc !== null && resolved.cutoffUtc.getTime() <= period.startUtc.getTime()) {
    throw new AnalyticsPeriodError("crm.analytics.cutoff_before_cohort_start");
  }

  return resolved;
}

function reportClockCutoff(timeZone: string, now: Date): ResolvedCutoff {
  return {
    cutoffUtc: now,
    cutoffLocal: localWallClockLabel(toLocalParts(now, timeZone)),
    cutoffDateLocal: null,
    source: "report_clock",
    clampedToReportClock: false,
  };
}

function explicitCutoff(raw: string, timeZone: string, now: Date): ResolvedCutoff {
  const date = parseLocalDateOnly(raw);
  if (date === null) throw new AnalyticsPeriodError("crm.analytics.cutoff_invalid");

  const today = toLocalParts(now, timeZone);
  const namedDay = localWallClockToUtc(date, timeZone).getTime();
  const todayStart = localWallClockToUtc(
    { year: today.year, month: today.month, day: today.day, hour: 0, minute: 0, second: 0 },
    timeZone,
  ).getTime();

  // Compared as whole local days, so "today" is accepted and "tomorrow" is not,
  // regardless of the hour the report is run.
  if (namedDay > todayStart) throw new AnalyticsPeriodError("crm.analytics.cutoff_in_future");

  const endOfNamedDay = localWallClockToUtc(addLocalDays(date, 1), timeZone);

  // Naming today asks to observe through an evening that has not happened. The
  // effective cutoff is the report clock, and the response says so.
  const clamped = endOfNamedDay.getTime() > now.getTime();
  const cutoffUtc = clamped ? now : endOfNamedDay;

  return {
    cutoffUtc,
    cutoffLocal: localWallClockLabel(toLocalParts(cutoffUtc, timeZone)),
    cutoffDateLocal: raw,
    source: "explicit_date",
    clampedToReportClock: clamped,
  };
}

/* ------------------------------------------------------- follow-up window */

/**
 * How long the report was able to watch the cohort for.
 *
 * THESE ARE OBSERVATION-WINDOW FACTS, NOT A MATURITY SCORE. They say how much
 * time elapsed between acquisition and the cutoff; they do not say whether that
 * is long enough for the conversion rate to have settled, because this phase
 * ships no empirical model of how long that takes. `maturityAssessment` is
 * therefore `not_scored`, and inventing "mature" or "high potential" here would
 * be a forecast wearing a fact's clothes.
 *
 * MINIMUM uses the cohort END: the youngest member of the cohort clicked just
 * before it, so this is the follow-up EVERY member has had at least.
 * MAXIMUM uses the cohort START: the oldest member has had at most this long.
 */
export type FollowupMetadata = {
  readonly cohortStartLocal: string | null;
  readonly cohortEndLocal: string;
  readonly cutoffLocal: string;
  readonly cohortStartUtc: string | null;
  readonly cohortEndUtc: string;
  readonly cutoffUtc: string;
  readonly minimumPossibleFollowupSeconds: number;
  /** Null for `all_time`, which has no cohort start to measure from. */
  readonly maximumPossibleFollowupSeconds: number | null;
  readonly cohortIntervalFullyBeforeCutoff: boolean;
  readonly maturityAssessment: "not_scored";
  readonly maturityReason: "empirical_maturity_model_not_implemented";
};

/** Whole seconds between two instants, floored at zero. */
function elapsedSeconds(fromUtc: Date, toUtc: Date): number {
  const ms = toUtc.getTime() - fromUtc.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 1000);
}

export function buildFollowupMetadata(
  period: ResolvedPeriod,
  cutoff: ResolvedCutoff,
): FollowupMetadata {
  return {
    cohortStartLocal: period.startLocal,
    cohortEndLocal: period.endLocal,
    cutoffLocal: cutoff.cutoffLocal,
    cohortStartUtc: period.startUtc === null ? null : period.startUtc.toISOString(),
    cohortEndUtc: period.endUtc.toISOString(),
    cutoffUtc: cutoff.cutoffUtc.toISOString(),
    minimumPossibleFollowupSeconds: elapsedSeconds(period.endUtc, cutoff.cutoffUtc),
    maximumPossibleFollowupSeconds:
      period.startUtc === null ? null : elapsedSeconds(period.startUtc, cutoff.cutoffUtc),
    // The whole selecting interval is behind the cutoff, so every member has
    // been observed for at least `minimumPossibleFollowupSeconds`.
    cohortIntervalFullyBeforeCutoff: period.endUtc.getTime() <= cutoff.cutoffUtc.getTime(),
    maturityAssessment: "not_scored",
    maturityReason: "empirical_maturity_model_not_implemented",
  };
}

/**
 * Follow-up metadata for ONE bucket of a time series.
 *
 * The cutoff is the report's, identical for every bucket — that is what makes
 * the buckets comparable. Only the acquisition interval moves, so an early
 * bucket honestly reports a longer maximum follow-up than a late one.
 */
export function buildBucketFollowupMetadata(
  bucket: { readonly startUtc: Date; readonly endUtc: Date },
  timeZone: string,
  cutoff: ResolvedCutoff,
): FollowupMetadata {
  return {
    cohortStartLocal: localWallClockLabel(toLocalParts(bucket.startUtc, timeZone)),
    cohortEndLocal: localWallClockLabel(toLocalParts(bucket.endUtc, timeZone)),
    cutoffLocal: cutoff.cutoffLocal,
    cohortStartUtc: bucket.startUtc.toISOString(),
    cohortEndUtc: bucket.endUtc.toISOString(),
    cutoffUtc: cutoff.cutoffUtc.toISOString(),
    minimumPossibleFollowupSeconds: elapsedSeconds(bucket.endUtc, cutoff.cutoffUtc),
    maximumPossibleFollowupSeconds: elapsedSeconds(bucket.startUtc, cutoff.cutoffUtc),
    cohortIntervalFullyBeforeCutoff: bucket.endUtc.getTime() <= cutoff.cutoffUtc.getTime(),
    maturityAssessment: "not_scored",
    maturityReason: "empirical_maturity_model_not_implemented",
  };
}
