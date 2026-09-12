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

/**
 * G4-H3/H4 — the acquisition coverage a request is asking about.
 *
 * A TYPED, CLOSED VOCABULARY, NOT A FREE-FORM STRING (§23). Three populations
 * that are genuinely different questions:
 *
 *   `total`      every canonical event, whatever its acquisition origin. This is
 *                "what is happening in the business".
 *   `attributed` events whose learner carries a frozen acquisition click. This is
 *                "what did tracked traffic produce" — the only population in
 *                which a click-denominated rate means anything.
 *   `organic`    events whose learner carries no acquisition click at all.
 *
 * `total` is the DEFAULT for every business surface. The audited candidate
 * hard-coded `attributed` on the funnel and the Pocket surfaces, so on a platform
 * with real learners and no attribution coverage — which is precisely the current
 * PREPROD — both reported zero. An absence of tracking is not an absence of
 * business.
 */
export const GROWTH_COVERAGE_SCOPES = ["total", "attributed", "organic"] as const;

export type GrowthCoverageScope = (typeof GROWTH_COVERAGE_SCOPES)[number];

export const GROWTH_DEFAULT_COVERAGE_SCOPE: GrowthCoverageScope = "total";

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
  /**
   * G4-H3 — RENAMED, AND DEFINED ONLY WHERE IT MEANS SOMETHING.
   *
   * It used to be `ataRegistrationRate`, computed in every coverage block. In the
   * `total` block that divided organic-plus-attributed registrations by
   * tracking-link clicks — two different populations — and the audit measured the
   * result: `"6.833333"`, a 683% "conversion rate". On PREPROD the arithmetic is
   * worse, because 40 backfilled registrations against the first tracking click
   * would read 4000%.
   *
   * `clicks` can only ever count traffic that came through a tracking link, so
   * the numerator must be restricted to learners those clicks could have
   * produced. The name now says so, and `computeGrowthRatios` returns null for it
   * outside the `attributed` scope rather than publishing a number.
   */
  attributedClickToRegistrationRate: {
    basis: "click_cohort" as const,
    numerator: "convertedClicks",
    denominator: "clicks",
    cohortAnchor: "qualified clicks whose own occurredAt falls in the period",
    /** Only the attributed population has a click denominator. */
    definedInScopes: ["attributed"] as const,
  },
  attributedRegistrationToActivationRate: {
    basis: "click_cohort" as const,
    numerator: "activatedLearners",
    denominator: "registeredLearners",
    cohortAnchor: "learners whose frozen attribution names a click in the period",
    definedInScopes: ["attributed"] as const,
  },
  attributedRegistrationToPocketRegistrationRate: {
    basis: "click_cohort" as const,
    numerator: "pocketRegisteredLearners",
    denominator: "registeredLearners",
    cohortAnchor: "learners whose frozen attribution names a click in the period",
    definedInScopes: ["attributed"] as const,
  },
  attributedRegistrationToDepositRate: {
    basis: "click_cohort" as const,
    numerator: "depositedLearners",
    denominator: "registeredLearners",
    cohortAnchor: "learners whose frozen attribution names a click in the period",
    definedInScopes: ["attributed"] as const,
  },
  attributedPocketRegistrationToDepositRate: {
    basis: "click_cohort" as const,
    numerator: "depositedAmongPocketRegistered",
    denominator: "pocketRegisteredLearners",
    cohortAnchor: "learners whose frozen attribution names a click in the period",
    definedInScopes: ["attributed"] as const,
  },
  /**
   * G4-H3. Published from `computeLearnerFunnelRatios` on a UNIQUE-LEARNER
   * subset basis, not as an event-count quotient — the two populations are not
   * nested and the event form reported above 100% on real data. The entry here
   * documents the shape for the payload's `ratioDenominators` block.
   */
  activationRate: {
    basis: "unique_learners" as const,
    numerator: "activatedLearners",
    denominator: "ataRegistrations",
    definedInScopes: GROWTH_COVERAGE_SCOPES,
  },
  /**
   * G4-H3. Published from `computeLearnerFunnelRatios` on a UNIQUE-LEARNER
   * subset basis, not as an event-count quotient — the two populations are not
   * nested and the event form reported above 100% on real data. The entry here
   * documents the shape for the payload's `ratioDenominators` block.
   */
  enrollmentRate: {
    basis: "unique_learners" as const,
    numerator: "enrollments",
    denominator: "ataRegistrations",
    definedInScopes: GROWTH_COVERAGE_SCOPES,
  },
  assessmentPassRate: {
    numerator: "assessmentsPassed",
    denominator: "assessmentsCompleted",
    definedInScopes: GROWTH_COVERAGE_SCOPES,
  },
  /**
   * G4-R5 — RENAMED, AND COHORT-BASED.
   *
   * It used to be `reportApprovalRate = report_approved events ÷
   * report_submitted events` in the same window, which is two populations and
   * measured 200%. It is now the share of the SUBMISSION COHORT anchored in the
   * period that is approved today, computed by `computeReportCohortRatio`, so
   * the entry here documents the shape for the payload's `ratioDenominators`
   * block and the value is never produced from event counts.
   */
  submittedReportCohortApprovalRate: {
    basis: "submission_cohort" as const,
    numerator: "approvedFromCohort",
    denominator: "submittedCohort",
    cohortAnchor: "report submissions whose firstSubmittedAt falls in the period",
    definedInScopes: GROWTH_COVERAGE_SCOPES,
  },
  /**
   * G4-H3. Published from `computeLearnerFunnelRatios` on a UNIQUE-LEARNER
   * subset basis, not as an event-count quotient — the two populations are not
   * nested and the event form reported above 100% on real data. The entry here
   * documents the shape for the payload's `ratioDenominators` block.
   */
  pocketRegistrationRate: {
    basis: "unique_learners" as const,
    numerator: "pocketRegistrations",
    denominator: "ataRegistrations",
    definedInScopes: GROWTH_COVERAGE_SCOPES,
  },
  /**
   * G4-H3. Published from `computeLearnerFunnelRatios` on a UNIQUE-LEARNER
   * subset basis, not as an event-count quotient — the two populations are not
   * nested and the event form reported above 100% on real data. The entry here
   * documents the shape for the payload's `ratioDenominators` block.
   */
  depositRatePerRegistration: {
    basis: "unique_learners" as const,
    numerator: "firstDeposits",
    denominator: "ataRegistrations",
    definedInScopes: GROWTH_COVERAGE_SCOPES,
  },
  /**
   * G4-H3. Published from `computeLearnerFunnelRatios` on a UNIQUE-LEARNER
   * subset basis, not as an event-count quotient — the two populations are not
   * nested and the event form reported above 100% on real data. The entry here
   * documents the shape for the payload's `ratioDenominators` block.
   */
  depositRatePerPocketRegistration: {
    basis: "unique_learners" as const,
    numerator: "firstDeposits",
    denominator: "pocketRegistrations",
    definedInScopes: GROWTH_COVERAGE_SCOPES,
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
/**
 * G4-H3 — the ratios that are SUBSET FRACTIONS of a learner population.
 *
 * These replace the event-count quotients for every step whose numerator is not
 * drawn from its denominator's population. Each one divides "learners who did
 * BOTH" by "learners who did the first", so it is a fraction of a set by its own
 * subset and cannot exceed 1.
 */
export function computeLearnerFunnelRatios(funnel: {
  readonly registeredLearners: number;
  readonly enrolledLearners: number;
  readonly activatedLearners: number;
  readonly pocketRegisteredLearners: number;
  readonly depositedLearners: number;
  readonly pocketRegisteredTotal: number;
  readonly depositedAmongPocketRegistered: number;
}): Record<string, string | null> {
  return {
    enrollmentRate: exactRatio(funnel.enrolledLearners, funnel.registeredLearners),
    activationRate: exactRatio(funnel.activatedLearners, funnel.registeredLearners),
    pocketRegistrationRate: exactRatio(funnel.pocketRegisteredLearners, funnel.registeredLearners),
    depositRatePerRegistration: exactRatio(funnel.depositedLearners, funnel.registeredLearners),
    depositRatePerPocketRegistration: exactRatio(
      funnel.depositedAmongPocketRegistered,
      funnel.pocketRegisteredTotal,
    ),
  };
}

/**
 * G4-R2 — the ratios of a CLICK COHORT, used by both surfaces that have one.
 *
 * The acquisition table computes these per source row and the overview computes
 * them once for the whole tracked population. Sharing the function is the point:
 * the previous wave fixed the overview's arithmetic and left the acquisition
 * table's, and the re-audit measured the difference at 683%.
 *
 * Every numerator here is drawn from the denominator's own set — see
 * `loadClickCohortFunnel` — so each value is in [0, 1] by construction. Nothing
 * is clamped.
 */
export function computeClickCohortRatios(cohort: {
  readonly clicks: number;
  readonly convertedClicks: number;
  readonly registeredLearners: number;
  readonly activatedLearners: number;
  readonly pocketRegisteredLearners: number;
  readonly depositedLearners: number;
  readonly depositedAmongPocketRegistered: number;
}): Record<string, string | null> {
  return {
    /** Of the clicks in this cohort, how many produced a registration. */
    attributedClickToRegistrationRate: exactRatio(cohort.convertedClicks, cohort.clicks),
    /** Of the learners this cohort produced, how many reached each later step. */
    attributedRegistrationToActivationRate: exactRatio(
      cohort.activatedLearners,
      cohort.registeredLearners,
    ),
    attributedRegistrationToPocketRegistrationRate: exactRatio(
      cohort.pocketRegisteredLearners,
      cohort.registeredLearners,
    ),
    attributedRegistrationToDepositRate: exactRatio(
      cohort.depositedLearners,
      cohort.registeredLearners,
    ),
    attributedPocketRegistrationToDepositRate: exactRatio(
      cohort.depositedAmongPocketRegistered,
      cohort.pocketRegisteredLearners,
    ),
  };
}

/**
 * G4-R5 — the approval rate of a SUBMISSION COHORT.
 *
 * `approvedFromCohort` is the subset of `submittedCohort` that is approved
 * today, so the rate is in [0, 1] whatever the review latency. A window with
 * approvals but no submissions of its own yields `null` — "this period started
 * no reports" — rather than dividing by a population that does not exist.
 */
export function computeReportCohortRatio(cohort: {
  readonly submittedCohort: number;
  readonly approvedFromCohort: number;
}): string | null {
  return exactRatio(cohort.approvedFromCohort, cohort.submittedCohort);
}

export function computeGrowthRatios(
  counts: GrowthMetricCounts,
  scope: GrowthCoverageScope,
): GrowthRatios {
  return Object.fromEntries(
    (Object.keys(GROWTH_RATIO_DENOMINATORS) as GrowthRatioKey[]).map((key) => {
      const spec = GROWTH_RATIO_DENOMINATORS[key];

      // G4-H3. A ratio that is not defined for this population is NULL, and null
      // is already this API's word for "not answerable" — the same word a zero
      // denominator produces. It is deliberately not omitted from the payload:
      // a missing key reads as a bug, a null reads as an answer.
      if (!(spec.definedInScopes as readonly string[]).includes(scope)) {
        return [key, null];
      }

      // G4-H3/G4-R2/G4-R5. ANY ratio that declares a `basis` is produced by the
      // dedicated function that owns that basis — `computeLearnerFunnelRatios`,
      // `computeClickCohortRatios`, `computeReportCohortRatio` — and is NEVER
      // computed from event counts here.
      //
      // This is a default-deny rather than a list of three known cases: a metric
      // added to the registry with a cohort basis and no wiring reads as `null`
      // ("not answerable here"), never as a plausible number produced by the
      // wrong arithmetic. Both defects this file has now carried were exactly
      // that — a quotient of two event counts that looked like a conversion.
      //
      // Only a ratio whose numerator and denominator are the SAME population of
      // events, counted the same way in the same window, may be divided here.
      // `assessmentPassRate` is the one such metric: its numerator is its
      // denominator's rows filtered by a metadata flag.
      if ("basis" in spec) {
        return [key, null];
      }

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

/**
 * G4-H3 (§19) — how much of the business the tracked-acquisition view can see.
 *
 * THIS IS A COVERAGE METRIC AND NOT A CONVERSION RATE, and the distinction is the
 * whole point. `attributedAtaRegistrationRate` asks "of the clicks we bought, how
 * many registered". This asks "of the registrations we have, how many can we
 * attribute to a click at all" — a property of ATA's own tracking, not of any
 * campaign's performance.
 *
 * It is what turns the empty attributed funnel from a mystery into a fact: 0 of
 * 12 registrations attributed is a coverage statement, and a reader who sees it
 * beside an empty acquisition table knows why the table is empty.
 *
 * Both counts come from the SAME population (canonical `ata_reg` events in the
 * period), so the ratio is a genuine subset fraction and can never exceed 1.
 */
export function computeAttributionCoverage(input: {
  readonly attributedRegistrations: number;
  readonly totalRegistrations: number;
}): {
  readonly attributedRegistrations: number;
  readonly totalRegistrations: number;
  readonly attributionCoverageRate: string | null;
} {
  return {
    attributedRegistrations: input.attributedRegistrations,
    totalRegistrations: input.totalRegistrations,
    attributionCoverageRate: exactRatio(input.attributedRegistrations, input.totalRegistrations),
  };
}
