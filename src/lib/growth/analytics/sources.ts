/**
 * G4-GROWTH — the authoritative source of every Growth metric, named here and
 * nowhere else.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE (§59). Every metric states the table it
 * counts, the column carrying its OWN occurrence time, and the predicate that
 * makes it that metric. Nothing derives an occurrence time from `now()`, from
 * `updatedAt`, or from a neighbouring event.
 *
 *   clicks                  AffiliateClick        occurredAt   classification=qualified
 *   ataRegistrations        GrowthEvent           occurredAt   eventType=ata_reg
 *   enrollments             GrowthEvent           occurredAt   eventType=curriculum_enrollment
 *   activatedLearners       GrowthEvent           occurredAt   eventType=academy_activation
 *   levelStarted            GrowthEvent           occurredAt   eventType=level_started
 *   levelCompleted          GrowthEvent           occurredAt   eventType=level_completed
 *   assessmentsCompleted    GrowthEvent           occurredAt   eventType=assessment_completed
 *   assessmentsPassed       GrowthEvent           occurredAt   eventType=assessment_completed, metadata.passed=1
 *   reportsSubmitted        GrowthEvent           occurredAt   eventType=report_submitted
 *   reportsApproved         GrowthEvent           occurredAt   eventType=report_approved
 *   mentorReviewsSubmitted  GrowthEvent           occurredAt   eventType=mentor_review_submitted
 *   mentorReviewsApproved   GrowthEvent           occurredAt   eventType=mentor_review_approved
 *   pocketRegistrations     GrowthEvent           occurredAt   eventType=pocket_reg
 *   firstDeposits           GrowthEvent           occurredAt   eventType=dep
 *   confirmedRedeposits     GrowthEvent           occurredAt   eventType=rdep
 *   unresolvedRedeposits    ProviderIngressEvent  receivedAt   goal=redep, processingStatus=identity_unresolved
 *
 * WHY CLICKS COME FROM `AffiliateClick` AND NOT FROM THE LEDGER. The accepted
 * AFD-5B1 analytics already counts `AffiliateClick.occurredAt` and is live. If
 * the Growth surfaces counted `traffic_click` GrowthEvents instead, two
 * dashboards would report different click totals for the same period — and the
 * one derived from the newer table would be wrong for every click that predates
 * it. One click number, one owner.
 *
 * WHY EVERYTHING ELSE COMES FROM THE LEDGER. Because the ledger is complete for
 * those families: migration 47 backfilled them from the same owner tables the
 * runtime emitters write from, using the same keys, so a period before the
 * migration and a period after it are answered identically.
 *
 * WHAT IS DELIBERATELY NOT COUNTED ANYWHERE: a current balance, a trading P&L, a
 * commission, a CPA payout, a redeposit whose identity is unresolved, a
 * quarantined deposit, or a replay counter. The first four do not exist in this
 * phase, and the last three are transport or operational facts, not money.
 */

import { exactRatio } from "@/lib/analytics/decimal";

export const GROWTH_ANALYTICS_MODE = "event_date" as const;
export const GROWTH_RATE_MODE = "period_event_ratio" as const;

/**
 * The metric vocabulary. Every key here appears in
 * `GROWTH_METRICS_REGISTRY.md` with its numerator, denominator, time basis and
 * null behaviour — the registry is generated against this list, so a metric
 * cannot be added to the API without being defined.
 */
export const GROWTH_METRIC_KEYS = [
  "clicks",
  "ataRegistrations",
  "enrollments",
  "activatedLearners",
  "levelStarted",
  "levelCompleted",
  "assessmentsCompleted",
  "assessmentsPassed",
  "reportsSubmitted",
  "reportsApproved",
  "mentorReviewsSubmitted",
  "mentorReviewsApproved",
  "pocketRegistrations",
  "firstDeposits",
  "confirmedRedeposits",
  "unresolvedRedeposits",
] as const;

export type GrowthMetricKey = (typeof GROWTH_METRIC_KEYS)[number];

export type GrowthMetricCounts = Record<GrowthMetricKey, number>;

export const ZERO_GROWTH_COUNTS: GrowthMetricCounts = Object.fromEntries(
  GROWTH_METRIC_KEYS.map((key) => [key, 0]),
) as GrowthMetricCounts;

/**
 * The event type each ledger-sourced metric counts.
 *
 * `clicks` and `unresolvedRedeposits` are absent because they are not counted
 * from the ledger — their owners are named in the header above and their queries
 * are written separately, which is deliberate: a metric that reads a different
 * table should not be reachable through a map that implies it reads this one.
 */
export const LEDGER_METRIC_EVENT_TYPES = {
  ataRegistrations: "ata_reg",
  enrollments: "curriculum_enrollment",
  activatedLearners: "academy_activation",
  levelStarted: "level_started",
  levelCompleted: "level_completed",
  assessmentsCompleted: "assessment_completed",
  reportsSubmitted: "report_submitted",
  reportsApproved: "report_approved",
  mentorReviewsSubmitted: "mentor_review_submitted",
  mentorReviewsApproved: "mentor_review_approved",
  pocketRegistrations: "pocket_reg",
  firstDeposits: "dep",
  confirmedRedeposits: "rdep",
} as const;

/**
 * The denominator every published ratio divides by, stated in the payload.
 *
 * NAMED RATHER THAN IMPLIED because "conversion rate" means four different
 * things to four different readers, and a dashboard that does not say which one
 * it computed is producing a number nobody can check. §59 requires a numerator
 * and a denominator for every metric, and this is where a client reads them.
 */
export const GROWTH_RATIO_DENOMINATORS = {
  ataRegistrationRate: { numerator: "ataRegistrations", denominator: "clicks" },
  activationRate: { numerator: "activatedLearners", denominator: "ataRegistrations" },
  enrollmentRate: { numerator: "enrollments", denominator: "ataRegistrations" },
  assessmentPassRate: { numerator: "assessmentsPassed", denominator: "assessmentsCompleted" },
  reportApprovalRate: { numerator: "reportsApproved", denominator: "reportsSubmitted" },
  pocketRegistrationRate: { numerator: "pocketRegistrations", denominator: "ataRegistrations" },
  depositRatePerRegistration: { numerator: "firstDeposits", denominator: "ataRegistrations" },
  depositRatePerPocketRegistration: {
    numerator: "firstDeposits",
    denominator: "pocketRegistrations",
  },
} as const;

export type GrowthRatioKey = keyof typeof GROWTH_RATIO_DENOMINATORS;

/**
 * An EXACT DECIMAL STRING, or null. Never a JavaScript number.
 *
 * The accepted AFD-5B1 analytics publishes ratios this way and the Growth
 * surfaces match it, for two reasons that both matter. A float quotient is
 * already rounded by the time it reaches the wire, so two readers computing the
 * same rate by hand can disagree with the dashboard and with each other. And a
 * `number | null` type invites `?? 0` somewhere in a client, which is precisely
 * the fabrication §60 forbids — turning "no traffic yet" into "0% converted".
 */
export type GrowthRatios = Record<GrowthRatioKey, string | null>;

/**
 * Compute every ratio, with a NULL — never a zero — when the denominator is zero.
 *
 * "0% of nobody registered" and "0% of ten thousand registered" are different
 * statements, and rendering both as `0` is how a campaign with no traffic yet
 * gets reported as a campaign that failed.
 *
 * `exactRatio` is the accepted helper: BigInt arithmetic, truncated at a fixed
 * scale so a rate is never overstated, and null on a zero denominator.
 */
export function computeGrowthRatios(counts: GrowthMetricCounts): GrowthRatios {
  return Object.fromEntries(
    (Object.keys(GROWTH_RATIO_DENOMINATORS) as GrowthRatioKey[]).map((key) => {
      const spec = GROWTH_RATIO_DENOMINATORS[key];
      return [
        key,
        exactRatio(
          counts[spec.numerator as GrowthMetricKey],
          counts[spec.denominator as GrowthMetricKey],
        ),
      ];
    }),
  ) as GrowthRatios;
}
