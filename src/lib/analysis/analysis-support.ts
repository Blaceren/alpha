/**
 * AFD-5D2A — backend-owned support tier and structured comparison.
 *
 * WHY THIS MOVED. AFD-5D2's CRM had no support tier at all and computed no
 * deltas, because the backend published neither. The brief closes both gaps on
 * the side that owns the numbers: a browser deciding how well-supported a
 * finding is, or subtracting one published value from another, is a second
 * analytical engine by another name.
 *
 * NO NEW ARITHMETIC BEYOND ONE INTEGER SUBTRACTION. Every percentage, every
 * percentage-point difference and every relative change published here was
 * ALREADY computed by `analysis-rules.ts` and is read out of the finding's own
 * operands. The single exception is `absoluteDelta` for a count change, which is
 * `last - first` over two integers the aggregates already published — exact,
 * total, and not an aggregation of anything.
 *
 * NO NEW SQL. NO NEW METRIC. NO MODEL. This module never sees the database; it
 * sees a `RawFinding` that already exists.
 */
import { ANALYSIS_THRESHOLDS, type RawFinding } from "./analysis-contract";

/* ------------------------------------------------------------ support tier */

/**
 * How well-supported a published finding is.
 *
 * `descriptive` — it states a stored value. There is no comparison to support,
 *                 so the question does not arise.
 * `moderate`    — it states a rate or a comparison whose denominator meets the
 *                 published minimum but not the strong threshold.
 * `strong`      — the denominator meets the published strong threshold.
 *
 * Three words, not a score. A number between 0 and 1 would invite arithmetic
 * nobody performed and comparisons nobody validated.
 */
export const SUPPORT_TIERS = ["descriptive", "moderate", "strong"] as const;
export type SupportTier = (typeof SUPPORT_TIERS)[number];

/**
 * Which operand carries the denominator a finding's support rests on.
 *
 * A finding absent from this map has no denominator to weigh and is therefore
 * `descriptive` — which is the honest answer for a count, a caveat, an
 * availability statement or a standing question, not a fallback.
 */
const DENOMINATOR_OPERAND: Readonly<Record<string, string>> = {
  funnel_rate_level: "denominator",
  cohort_rate_level: "denominator",
  small_sample_rate: "denominator",
  member_rate_differs_from_aggregate: "memberDenominator",
  member_clicks_without_registrations: "clicks",
  member_registrations_without_deposits: "pocketRegistrations",
  cohort_median_lag: "sampleSize",
};

/**
 * The tier for one raw finding.
 *
 * READS THE FINDING'S OWN OPERANDS and the published thresholds — nothing else.
 * A finding whose denominator operand is missing or unparseable is
 * `descriptive`: refusing to guess is the whole point, and claiming `strong`
 * from an absent number would be exactly the fabrication §5 forbids.
 */
export function supportTierOf(finding: RawFinding): SupportTier {
  const operandKey = DENOMINATOR_OPERAND[finding.code];
  if (operandKey === undefined) return "descriptive";

  const raw = finding.operands[operandKey];
  if (raw === undefined) return "descriptive";

  const denominator = Number(raw);
  if (!Number.isFinite(denominator) || denominator < 0) return "descriptive";

  // A rate the report has ALREADY flagged as small-sample can never be strong or
  // moderate: the flag and the tier would otherwise contradict each other on the
  // same screen.
  if (denominator < ANALYSIS_THRESHOLDS.minRateDenominator) return "descriptive";
  if (denominator >= ANALYSIS_THRESHOLDS.strongSupportMinDenominator) return "strong";
  return "moderate";
}

/* -------------------------------------------------------------- comparison */

/**
 * A published comparison, in one strict shape.
 *
 * EVERY FIELD IS A STRING OR NULL, never a number. The analytics contract has
 * held since AFD-5B1 that an exact decimal string and a JavaScript number are
 * not interchangeable, and a percentage-point difference is precisely where
 * binary rounding would show.
 *
 * A FIELD THAT DOES NOT APPLY IS `null`, never absent and never zero. A count
 * change has no percentage-point delta; a rate change has no absolute delta.
 * Publishing `0` for either would be a measurement nobody made.
 */
export type FindingComparison = {
  readonly kind: "count_change" | "rate_change" | "member_vs_aggregate";
  /** What the finding is about now. */
  readonly currentValue: string;
  /** What it is being compared against. */
  readonly baselineValue: string;
  /** current − baseline, for counts. Exact integer arithmetic. */
  readonly absoluteDelta: string | null;
  /** The move in percentage points, for rates. Already computed by the rules. */
  readonly percentagePointDelta: string | null;
  /** The relative move as a percentage, for counts. Already computed. */
  readonly relativeDelta: string | null;
};

/**
 * Build the comparison for a finding that has one.
 *
 * Returns `null` for every finding that is not a comparison — which is most of
 * them. There is no default comparison and no invented baseline.
 */
export function comparisonOf(finding: RawFinding): FindingComparison | null {
  const operands = finding.operands;

  if (finding.code === "series_count_change") {
    const first = operands.firstValue;
    const last = operands.lastValue;
    if (first === undefined || last === undefined) return null;

    // THE ONE PIECE OF NEW ARITHMETIC IN THIS PHASE: an integer subtraction of
    // two counts the aggregates already published. It is not an aggregation, it
    // reads no record, and it is exact.
    const firstInt = Number(first);
    const lastInt = Number(last);
    const absoluteDelta =
      Number.isSafeInteger(firstInt) && Number.isSafeInteger(lastInt)
        ? String(lastInt - firstInt)
        : null;

    return {
      kind: "count_change",
      currentValue: last,
      baselineValue: first,
      absoluteDelta,
      percentagePointDelta: null,
      // Already computed by `countChangePercent` in the rules.
      relativeDelta: operands.changePercent ?? null,
    };
  }

  if (finding.code === "series_rate_change") {
    const first = operands.firstPercent;
    const last = operands.lastPercent;
    if (first === undefined || last === undefined) return null;
    return {
      kind: "rate_change",
      currentValue: last,
      baselineValue: first,
      absoluteDelta: null,
      // Already computed by `ratioDifferencePoints` in the rules.
      percentagePointDelta: operands.changePoints ?? null,
      relativeDelta: null,
    };
  }

  if (finding.code === "member_rate_differs_from_aggregate") {
    const member = operands.memberPercent;
    const aggregate = operands.aggregatePercent;
    if (member === undefined || aggregate === undefined) return null;
    return {
      kind: "member_vs_aggregate",
      currentValue: member,
      baselineValue: aggregate,
      absoluteDelta: null,
      percentagePointDelta: operands.differencePoints ?? null,
      relativeDelta: null,
    };
  }

  return null;
}
