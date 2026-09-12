/**
 * THE RENDER-LEVEL CONTRACT THE PREVIOUS CORRECTION LACKED.
 *
 * WHY THIS FILE EXISTS. G4-R13 was corrected once and shipped, and the live
 * browser then found it still leaking on a fifth surface. The reason is worth
 * stating exactly, because it is the whole lesson:
 *
 *   * `growth-labels.test.ts` proves `availabilityReason()` returns a sentence.
 *   * `growth-availability-render.test.tsx` proves `AvailabilityList` calls it.
 *   * Both passed. Both were correct. Neither could see `growth-workspace.tsx`
 *     interpolating `switches.redepositIdentityReason` directly into JSX,
 *     because that render site never calls the function under test.
 *
 * A test of a translation function cannot find a render site that does not use
 * it. So this file asserts a property of the RENDERED OUTPUT of all five Growth
 * surfaces instead: no internal machine identifier reaches operator-facing text,
 * and the operator prose is in the UI's own language.
 *
 * THE FORBIDDEN VOCABULARY IS DERIVED, NOT LISTED. It is read from the exported
 * label maps themselves, so a reason code added to the product is automatically
 * covered here without anyone remembering to extend a list — which is the
 * failure mode that produced G4-R13-B in the first place.
 *
 * DELIBERATELY NOT A `/[a-z]+_[a-z]+/` SWEEP. That matches legitimate technical
 * text — `last_30_days` in a select value, a css class, a test id — and a check
 * that cries wolf is one that gets an exception added until it means nothing.
 * The assertion targets the known internal vocabularies and the specific English
 * sentences this correction removed.
 *
 * FIXTURES ARE COMPLETE AND SELF-CONTAINED. They carry the exact machine codes
 * and the exact English prose the live API sends, so this test FAILS on the
 * parent candidate `c69819d6…` and passes on the correction.
 */
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import {
  AMOUNT_UNAVAILABLE_REASON,
  AVAILABILITY_REASON,
  REDEPOSIT_IDENTITY_CONTRACT,
} from "./growth-labels";
import { GROWTH_ROUTES, type GrowthSurface } from "./growth-routes";

vi.mock("next/navigation", () => ({
  usePathname: () => "/growth",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: React.ReactNode }) =>
    React.createElement("a", rest, children),
}));

/** The English prose the live API carries, verbatim. */
const API_ENGLISH = {
  rateMode:
    "Numerators and denominators are events occurring in the selected period and " +
    "may belong to different acquisition cohorts. A ratio is null, never zero, " +
    "when its denominator is zero.",
  attribution:
    "Events are sliced by the learner's FROZEN acquisition attribution, decided " +
    "once at registration under the last_eligible_affiliate_click model. A later " +
    "click never re-attributes an existing learner.",
  unresolvedMeaning:
    "Deliveries received and validated. NOT counted as money because Pocket " +
    "supplies no unique event identifier, so a retry cannot be told apart from a " +
    "genuine second deposit. This is not a count of zero redeposits.",
  depositNote:
    "Covers FIRST deposits only. Confirmed redeposits are structurally zero " +
    "until a provider event-identity contract exists, and quarantined or " +
    "identity-unresolved deliveries are never included in any monetary total.",
} as const;

const AVAILABILITY = {
  trafficClicks: { available: true },
  ataRegistrations: {
    available: true,
    scope: {
      provable: 12,
      population: 45,
      unprovableStaff: 12,
      unprovableOther: 21,
      basis: "positive_registration_authority",
    },
  },
  enrollments: { available: true },
  academyActivation: { available: true },
  educationProgression: { available: true },
  mentorReviewSubmissions: { available: false, reason: "historical_submission_instant_not_owned" },
  pocketRegistrations: { available: true },
  firstDeposits: { available: true },
  firstDepositAmountAggregation: { available: false, reason: "no_deposits_in_period" },
  redeposits: { available: false, reason: "provider_event_identity_contract_absent" },
  currentBalance: { available: false, reason: "prohibited_not_collected" },
  acquisitionCreativeDimensions: { available: false, reason: "dimension_not_captured" },
  cpaAndCommission: { available: false, reason: "not_in_scope_for_growth_v1" },
};

const PERIOD = {
  resolvedPreset: "last_30_days",
  timezone: "Europe/Moscow",
  weekStart: "monday",
  startUtc: "2026-07-14T21:00:00.000Z",
  endUtc: "2026-08-13T21:00:00.000Z",
};

const AMOUNT = {
  sum: null,
  average: null,
  median: null,
  count: 0,
  currencyCode: null,
  amountAggregationAvailable: false,
  unavailableReason: "no_deposits_in_period",
};

/** Every field `countsSchema` declares — the live PREPROD figures. */
const COUNTS = {
  clicks: 0,
  ataRegistrations: 12,
  enrollments: 21,
  activatedLearners: 14,
  levelStarted: 42,
  levelCompleted: 47,
  assessmentsCompleted: 16,
  assessmentsPassed: 14,
  reportsSubmitted: 7,
  reportsApproved: 7,
  mentorReviewsSubmitted: 0,
  mentorReviewsApproved: 0,
  pocketRegistrations: 9,
  firstDeposits: 0,
  confirmedRedeposits: 0,
  unresolvedRedeposits: 0,
  ratios: {
    attributedClickToRegistrationRate: null,
    attributedRegistrationToActivationRate: null,
    attributedRegistrationToPocketRegistrationRate: null,
    attributedRegistrationToDepositRate: null,
    attributedPocketRegistrationToDepositRate: null,
    activationRate: "0.500000",
    enrollmentRate: "0.666666",
    assessmentPassRate: "0.875000",
    pocketRegistrationRate: "0.333333",
    depositRatePerRegistration: "0.000000",
    depositRatePerPocketRegistration: "0.000000",
    submittedReportCohortApprovalRate: "1.000000",
  },
  reportCohort: { submittedCohort: 7, approvedFromCohort: 7 },
};

/**
 * The five payloads. Cast once, at the boundary, because the mocked client
 * returns already-parsed data — the wire schema is exercised by the contract
 * tests, and duplicating every optional field here would obscure what this file
 * is actually asserting.
 */
const FIXTURES = {
  overview: {
    mode: "event_date",
    rateMode: "period_event_ratio",
    rateModeExplanation: API_ENGLISH.rateMode,
    attributionExplanation: API_ENGLISH.attribution,
    ratioBasis: {},
    ratioDenominators: {},
    clickCohort: {},
    period: PERIOD,
    filters: { affiliatePartnerId: null, affiliateCampaignId: null, trackingLinkId: null },
    coverage: { attributed: { ...COUNTS, clicks: 0 }, organic: { ...COUNTS }, total: { ...COUNTS } },
    attributionCoverage: {
      attributedRegistrations: 0,
      totalRegistrations: 12,
      attributionCoverageRate: "0.000000",
    },
    firstDepositAmount: AMOUNT,
    dataAvailability: AVAILABILITY,
    generatedAt: "2026-08-13T21:00:00.000Z",
  },
  funnel: {
    mode: "event_date",
    attributionExplanation: API_ENGLISH.attribution,
    period: PERIOD,
    scope: "total",
    maxLevel: 100,
    defaultScope: "total",
    attributionCoverage: {
      attributedRegistrations: 0,
      totalRegistrations: 12,
      attributionCoverageRate: "0.000000",
    },
    acquisitionFunnel: {
      denominatorModel: "explicit_per_step",
      rateBasis: "unique_learners",
      steps: [
        { learners: null, ofLearners: null, step: "click", count: 0, ofStep: null, rate: null, dropOff: null },
        { learners: 12, ofLearners: null, step: "ata_registration", count: 12, ofStep: null, rate: null, dropOff: null },
      ],
    },
    levelFunnel: {
      absentMeans: "no_events_in_period",
      countBasis: "unique_enrollment_level_pairs",
      rateDefinition: "started_then_completed",
      steps: [
        {
          levelNumber: 1,
          startedLearners: 15,
          completedLearners: 14,
          startedAndCompletedLearners: 14,
          completedWithoutStartLearners: 0,
          startedCompletionRate: "0.933333",
        },
      ],
    },
    educationQuality: {
      assessmentsCompleted: 16,
      assessmentsPassed: 14,
      assessmentPassRate: "0.875000",
      reportsSubmitted: 7,
      reportsApproved: 7,
      submittedReportCohort: 7,
      approvedFromSubmittedReportCohort: 7,
      submittedReportCohortApprovalRate: "1.000000",
      mentorReviewsSubmitted: 0,
      mentorReviewsApproved: 0,
    },
    dataAvailability: { ...AVAILABILITY, firstDepositAmountAggregation: { available: false, reason: "not_requested_on_this_surface" } },
    generatedAt: "2026-08-13T21:00:00.000Z",
  },
  acquisition: {
    mode: "event_date",
    attributionExplanation: API_ENGLISH.attribution,
    period: PERIOD,
    dimension: "affiliateCampaign",
    limit: 25,
    rankingPolicy: "none_ordered_by_id",
    qualityScorePolicy: "not_computed_by_design",
    totalDimensionMembers: 0,
    truncated: false,
    metricClass: "attributed_click_cohort",
    cohortAnchor: "qualified clicks whose own occurredAt falls in the period",
    downstreamObservation: "cohort_state_today",
    totals: {
      clicks: 0, convertedClicks: 0, registeredLearners: 0, activatedLearners: 0,
      pocketRegisteredLearners: 0, depositedLearners: 0, depositedAmongPocketRegistered: 0,
      attributedClickToRegistrationRate: null, attributedRegistrationToActivationRate: null,
      attributedRegistrationToPocketRegistrationRate: null,
      attributedRegistrationToDepositRate: null, attributedPocketRegistrationToDepositRate: null,
    },
    rows: [],
    dataAvailability: { ...AVAILABILITY, firstDepositAmountAggregation: { available: false, reason: "per_row_amounts_not_published_on_this_surface" } },
    generatedAt: "2026-08-13T21:00:00.000Z",
  },
  pocketConversions: {
    mode: "event_date",
    period: PERIOD,
    filters: { affiliatePartnerId: null, affiliateCampaignId: null, trackingLinkId: null },
    scope: "total",
    conversions: { pocketRegistrations: 9, firstDeposits: 0, confirmedRedeposits: 0 },
    operational: {
      unresolvedRedeposits: 0,
      unresolvedRedepositsMeaning: API_ENGLISH.unresolvedMeaning,
      unresolvedRedepositsScope: "platform_wide_not_filtered",
    },
    firstDepositAmount: AMOUNT,
    totalDepositAmountNote: API_ENGLISH.depositNote,
    prohibited: { currentBalance: "not_collected", profitAndLoss: "not_collected", commission: "not_in_scope_for_growth_v1" },
    dataAvailability: AVAILABILITY,
    generatedAt: "2026-08-13T21:00:00.000Z",
  },
  /** THE SURFACE THAT LEAKED. Both machine values are exactly what live sends. */
  ingressHealth: {
    mode: "event_date",
    period: PERIOD,
    switches: {
      masterEnabled: false,
      regIngestEnabled: false,
      depIngestEnabled: false,
      rdepIngestEnabled: false,
      redepositIdentityContract: "unavailable",
      redepositIdentityReason: "provider_event_identity_contract_absent",
    },
    deliveries: { total: 0, byGoal: {}, byStatus: {}, byRejectionCode: {} },
    summary: { accepted: 0, duplicates: 0, pendingLinkage: 0, identityUnresolved: 0, rejected: 0, quarantined: 0 },
    notes: {
      authRejected: "Отклонённые по аутентификации доставки не раскрываются подробнее.",
      identityUnresolved: "Идентичность не определена — событие не считается деньгами.",
    },
    generatedAt: "2026-08-13T21:00:00.000Z",
  },
} as const;

vi.mock("@/application/api/growth-client", () => ({
  fetchGrowthOverview: async () => ({ status: "success", data: FIXTURES.overview }),
  fetchGrowthFunnel: async () => ({ status: "success", data: FIXTURES.funnel }),
  fetchGrowthAcquisition: async () => ({ status: "success", data: FIXTURES.acquisition }),
  fetchGrowthPocketConversions: async () => ({ status: "success", data: FIXTURES.pocketConversions }),
  fetchGrowthIngressHealth: async () => ({ status: "success", data: FIXTURES.ingressHealth }),
}));

// Imported AFTER the mock so the workspace binds to it.
const { GrowthWorkspace } = await import("./growth-workspace");

/**
 * Derived from the canonical route registry, not typed out: a sixth Growth
 * surface added to the product is covered by this contract automatically.
 * `GROWTH_ROUTES` is the same definition both CRM shells navigate with.
 */
const ANCHORS: Record<GrowthSurface, string> = {
  overview: "Сводка",
  funnel: "Воронка привлечения",
  acquisition: "Строки не ранжированы",
  pocket: "Подтверждённые конверсии",
  ingress: "Переключатели приёма",
};

const SURFACES = GROWTH_ROUTES.map((route) => [route.surface, ANCHORS[route.surface]] as const);

/**
 * Every internal identifier that must never reach operator prose, derived from
 * the label maps rather than typed out. `available` is excluded from the
 * contract-state keys: it is an ordinary English word that a future Russian
 * sentence could legitimately contain as a substring, and `unavailable` — the
 * state that actually leaked — is covered.
 */
const FORBIDDEN_TOKENS = [
  ...Object.keys(AVAILABILITY_REASON),
  ...Object.keys(AMOUNT_UNAVAILABLE_REASON),
  ...Object.keys(REDEPOSIT_IDENTITY_CONTRACT).filter((k) => k !== "available"),
];

async function renderSurface(surface: GrowthSurface, anchor: string) {
  const view = render(<GrowthWorkspace surface={surface} />);
  await screen.findByText(new RegExp(anchor, "i"));
  return view.container.textContent ?? "";
}

afterEach(cleanup);

describe("Growth surfaces — no internal identifier reaches operator text", () => {
  it("has a non-trivial forbidden vocabulary, so this cannot pass vacuously", () => {
    expect(FORBIDDEN_TOKENS.length).toBeGreaterThanOrEqual(10);
    expect(FORBIDDEN_TOKENS).toContain("provider_event_identity_contract_absent");
    expect(FORBIDDEN_TOKENS).toContain("configured_param_rejected");
    expect(FORBIDDEN_TOKENS).toContain("unavailable");
  });

  it.each(SURFACES)("%s renders no internal reason or state code", async (surface, anchor) => {
    const text = await renderSurface(surface, anchor);

    const leaked = FORBIDDEN_TOKENS.filter((token) => text.includes(token));
    expect(leaked).toEqual([]);
  });

  /**
   * The exact regression. On the parent candidate this surface rendered
   * «Контракт идентичности редепозита: unavailable —
   * provider_event_identity_contract_absent.»
   */
  it("ingress-health states the redeposit identity contract in Russian, fail-closed", async () => {
    const text = await renderSurface("ingress", ANCHORS.ingress);

    expect(text).toContain("Контракт идентичности редепозита");
    expect(text).toContain("не установлен");
    expect(text).not.toContain("provider_event_identity_contract_absent");
    expect(text).not.toContain("unavailable");
    // The truth is preserved: the reason is stated, not hidden behind the state.
    expect(text).toContain("Pocket не передаёт уникальный идентификатор события");
    // And it must not imply RDEP works or that this is a temporary outage.
    expect(text).not.toMatch(/временно|попробуйте позже|скоро/i);
  });

  it("labels the other identity reason too, which G4-L2 made reachable", () => {
    expect(AVAILABILITY_REASON.configured_param_rejected).toBeDefined();
    expect(AVAILABILITY_REASON.configured_param_rejected).toMatch(/[А-Яа-яЁё]/);
  });
});

describe("Growth surfaces — operator prose is in the UI's language", () => {
  it.each(SURFACES)("%s renders none of the API's English explanatory prose", async (surface, anchor) => {
    const text = await renderSurface(surface, anchor);

    for (const english of Object.values(API_ENGLISH)) {
      // Compare on a distinctive fragment: whitespace differs after rendering.
      const fragment = english.slice(0, 45);
      expect(text).not.toContain(fragment);
    }
  });

  it("overview carries the Russian equivalents, so nothing was merely deleted", async () => {
    const text = await renderSurface("overview", ANCHORS.overview);

    expect(text).toContain("Доля равна null, а не нулю");
    expect(text).toContain("ЗАФИКСИРОВАННОЙ атрибуции");
    expect(text).not.toContain("A ratio is null");
    expect(text).not.toContain("FROZEN acquisition attribution");
  });

  it("pocket-conversions carries the Russian equivalents", async () => {
    const text = await renderSurface("pocket", ANCHORS.pocket);

    expect(text).toContain("Доставки получены и проверены");
    expect(text).toContain("Учитываются ТОЛЬКО первые депозиты");
    expect(text).not.toContain("Deliveries received and validated");
    expect(text).not.toContain("Covers FIRST deposits only");
  });

  it("keeps accepted product terminology untranslated", async () => {
    // ATA, Pocket, REG, DEP, RDEP, CRM are product nouns, not accidental English.
    const overview = await renderSurface("overview", ANCHORS.overview);
    expect(overview).toContain("Регистрации ATA");
    expect(overview).toContain("Регистрации Pocket");

    cleanup();
    const ingress = await renderSurface("ingress", ANCHORS.ingress);
    expect(ingress).toContain("Приём REG");
    expect(ingress).toContain("Приём DEP");
    expect(ingress).toContain("Приём RDEP");
  });
});

describe("G4-R12 is preserved by this correction", () => {
  it("still states the registration scope truthfully", async () => {
    const text = await renderSurface("overview", ANCHORS.overview);

    expect(text).toContain("12 регистраций с подтверждённым источником");
    expect(text).toContain("45");
    expect(text).toContain("сотрудники");
    expect(text).toContain("исторические");
  });
});
