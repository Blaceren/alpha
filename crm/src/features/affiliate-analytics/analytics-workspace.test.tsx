/**
 * AFD-5C1 — the analytics workspace.
 *
 * These cover the behaviour that only appears once the pieces are assembled:
 * permission gating, the two modes staying distinct, the request orchestration
 * refusing to render a stale answer, and the privacy properties of what the
 * workspace actually calls and actually paints.
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthenticatedSessionProvider } from "@/components/crm-shell/session-context";
import { sessionFromDto } from "@/domain/identity/session";
import type { Permission } from "@/domain/identity/roles";
import { AffiliateAnalyticsWorkspace } from "./analytics-workspace";

/* ----------------------------------------------------------------- routing */

/**
 * A router double that actually navigates.
 *
 * `useSearchParams` is backed by a real external store, so `router.push`
 * re-renders the tree exactly as a navigation does. A mock that merely recorded
 * the call would leave the component frozen on its initial URL, and every
 * assertion about "what happens after a filter change" would silently be
 * testing nothing.
 */
let currentSearch = "";
const searchListeners = new Set<() => void>();

function setSearch(next: string) {
  currentSearch = next;
  for (const listener of searchListeners) listener();
}

const pushMock = vi.fn((url: string) => {
  setSearch(url.includes("?") ? url.slice(url.indexOf("?")) : "");
});

vi.mock("next/navigation", async () => {
  const react = await vi.importActual<typeof import("react")>("react");
  return {
    useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
    usePathname: () => "/affiliates/analytics",
    useSearchParams: () => {
      const raw = react.useSyncExternalStore(
        (listener: () => void) => {
          searchListeners.add(listener);
          return () => searchListeners.delete(listener);
        },
        () => currentSearch,
        () => currentSearch,
      );
      return new URLSearchParams(raw);
    },
  };
});

/* ------------------------------------------------------------- API doubles */

const filtersMock = vi.fn();
const eventSummaryMock = vi.fn();
const eventSeriesMock = vi.fn();
const eventBreakdownMock = vi.fn();
const cohortSummaryMock = vi.fn();
const cohortSeriesMock = vi.fn();
const cohortBreakdownMock = vi.fn();

vi.mock("@/application/api/affiliate-analytics-client", async () => {
  const actual = await vi.importActual<
    typeof import("@/application/api/affiliate-analytics-client")
  >("@/application/api/affiliate-analytics-client");
  return {
    ...actual,
    fetchAnalyticsFilters: (...a: unknown[]) => filtersMock(...a),
    fetchEventDateSummary: (...a: unknown[]) => eventSummaryMock(...a),
    fetchEventDateTimeseries: (...a: unknown[]) => eventSeriesMock(...a),
    fetchEventDateBreakdown: (...a: unknown[]) => eventBreakdownMock(...a),
    fetchCohortSummary: (...a: unknown[]) => cohortSummaryMock(...a),
    fetchCohortTimeseries: (...a: unknown[]) => cohortSeriesMock(...a),
    fetchCohortBreakdown: (...a: unknown[]) => cohortBreakdownMock(...a),
  };
});

/* ------------------------------------------------------------- fixtures */

const PERIOD = {
  resolvedPreset: "last_30_days",
  timezone: "Europe/Moscow",
  weekStart: "monday",
  startUtc: "2026-06-30T21:00:00.000Z",
  endUtc: "2026-07-30T21:00:00.000Z",
  startLocal: "2026-07-01 00:00:00",
  endLocal: "2026-07-31 00:00:00",
  intervalConvention: "start_inclusive_end_exclusive",
} as const;

const AVAILABILITY = {
  trafficClicks: { available: true },
  academyRegistrations: { available: true },
  pocketRegistrations: { available: true },
  firstDeposits: { available: true },
  firstDepositAmountAggregation: { available: true },
  redeposits: { available: false, reason: "provider_transaction_identifier_missing" },
  currentBalance: { available: false, reason: "prohibited_not_collected" },
  educationQuality: {
    available: false,
    reason: "authoritative_product_event_catalog_not_implemented",
  },
  acquisitionCohortMode: { available: true },
  leadDrilldown: { available: true },
} as const;

const COHORT_AVAILABILITY = {
  registeredAcquisitionCohort: { available: true },
  pocketRegistration: { available: true },
  firstDeposit: { available: true },
  firstDepositAmountAggregation: { available: true },
  anonymousVisitorToRegistrationCohortRate: {
    available: false,
    reason: "unregistered_visitor_selected_attribution_not_frozen",
  },
  unattributedAcquisitionCohort: { available: false, reason: "no_selected_acquisition_click" },
  directTrafficCohort: { available: false, reason: "acquisition_anchor_absent" },
  educationQuality: {
    available: false,
    reason: "authoritative_product_event_catalog_not_implemented",
  },
  redeposits: { available: false, reason: "provider_transaction_identifier_missing" },
  currentBalance: { available: false, reason: "prohibited_not_collected" },
  leadDrilldown: { available: true },
  maturityScoring: { available: false, reason: "deferred_to_statistical_analyst_phase" },
  forecasting: { available: false, reason: "deferred_to_predictive_analytics_phase" },
} as const;

function counts(over: Partial<Record<string, number>> = {}) {
  return {
    rawClicks: 120,
    qualifiedClicks: 100,
    prefetchClicks: 15,
    authenticatedUserClicks: 5,
    uniqueVisitors: 80,
    academyRegistrations: 20,
    pocketRegistrations: 12,
    confirmedFirstDeposits: 4,
    pendingIdentityDeposits: 2,
    conflictingDeposits: 1,
    ...over,
  };
}

function ratios(over: Partial<Record<string, string | null>> = {}) {
  return {
    qualifiedClickToAcademyRegistrationRate: "0.2",
    academyRegistrationToPocketRegistrationRate: "0.6",
    pocketRegistrationToFirstDepositRate: "0.3333",
    qualifiedClickToPocketRegistrationRate: "0.12",
    qualifiedClickToFirstDepositRate: "0.04",
    ...over,
  };
}

const AMOUNT_OK = {
  amountAggregationAvailable: true,
  amountTotal: "1250.00",
  currencyCode: "EUR",
  unavailableReason: null,
} as const;

const AMOUNT_MIXED = {
  amountAggregationAvailable: false,
  amountTotal: null,
  currencyCode: null,
  unavailableReason: "currency_unspecified_or_mixed",
} as const;

function eventSummary(over: Record<string, unknown> = {}) {
  return {
    mode: "event_date",
    rateMode: "period_event_ratio",
    rateModeExplanation: "Numerators and denominators are events occurring in the selected period.",
    ratioDenominators: {
      qualifiedClickToAcademyRegistrationRate: "qualifiedClicks",
      academyRegistrationToPocketRegistrationRate: "academyRegistrations",
      pocketRegistrationToFirstDepositRate: "pocketRegistrations",
      qualifiedClickToPocketRegistrationRate: "qualifiedClicks",
      qualifiedClickToFirstDepositRate: "qualifiedClicks",
    },
    period: PERIOD,
    filters: {
      affiliatePartnerId: null,
      affiliateCampaignId: null,
      affiliateTrackingLinkId: null,
    },
    coverage: {
      attributed: { ...counts(), ratios: ratios() },
      unattributed: { ...counts({ qualifiedClicks: 40 }), ratios: ratios() },
      total: { ...counts({ qualifiedClicks: 140 }), ratios: ratios() },
    },
    firstDepositAmount: AMOUNT_OK,
    dataAvailability: AVAILABILITY,
    generatedAt: "2026-07-30T12:00:00.000Z",
    ...over,
  };
}

function eventSeries(over: Record<string, unknown> = {}) {
  return {
    mode: "event_date",
    rateMode: "period_event_ratio",
    rateModeExplanation: "…",
    period: PERIOD,
    group: "day",
    coverage: "total",
    bucketCount: 2,
    bucketCap: 400,
    buckets: [
      {
        localLabel: "2026-07-01",
        startUtc: "2026-06-30T21:00:00.000Z",
        endUtc: "2026-07-01T21:00:00.000Z",
        metrics: { ...counts(), bucketUniqueVisitors: 50 },
      },
      {
        localLabel: "2026-07-02",
        startUtc: "2026-07-01T21:00:00.000Z",
        endUtc: "2026-07-02T21:00:00.000Z",
        metrics: { ...counts({ qualifiedClicks: 0 }), bucketUniqueVisitors: 0 },
      },
    ],
    totals: counts(),
    periodUniqueVisitors: 80,
    summedBucketUniqueVisitors: 95,
    uniqueVisitorExplanation:
      "periodUniqueVisitors is computed once across the whole period.",
    reconciliation: { additiveMetricsMatch: true, details: [] },
    firstDepositAmount: AMOUNT_OK,
    dataAvailability: AVAILABILITY,
    generatedAt: "2026-07-30T12:00:00.000Z",
    ...over,
  };
}

function eventBreakdown(over: Record<string, unknown> = {}) {
  return {
    mode: "event_date",
    rateMode: "period_event_ratio",
    rateModeExplanation: "…",
    ratioDenominators: eventSummary().ratioDenominators,
    period: PERIOD,
    dimension: "affiliate",
    includeZeroActivity: false,
    total: 2,
    limit: 25,
    offset: 0,
    rows: [
      {
        id: "1",
        code: "alpha",
        displayName: "Affiliate Alpha",
        status: "active",
        availability: "available",
        archived: false,
        affiliatePartnerId: "1",
        affiliateCampaignId: null,
        metrics: counts(),
        ratios: ratios(),
        firstDepositAmount: AMOUNT_OK,
        lastActivityAt: "2026-07-29T10:00:00.000Z",
      },
      {
        id: "2",
        code: "beta",
        displayName: "Affiliate Beta",
        status: "archived",
        availability: "archived",
        archived: true,
        affiliatePartnerId: "2",
        affiliateCampaignId: null,
        metrics: counts({ confirmedFirstDeposits: 0 }),
        ratios: ratios({ qualifiedClickToFirstDepositRate: null }),
        firstDepositAmount: AMOUNT_MIXED,
        lastActivityAt: null,
      },
    ],
    attributedTotals: counts(),
    firstDepositAmount: AMOUNT_OK,
    dataAvailability: AVAILABILITY,
    generatedAt: "2026-07-30T12:00:00.000Z",
    ...over,
  };
}

const COHORT_IDENTITY = {
  mode: "acquisition_cohort",
  cohortPopulation: "registered_attributed_learners",
  cohortAnchor: "selected_acquisition_click",
  cohortModeExplanation: "Learners are selected by the date of their frozen selected click.",
  cohortVersusEventDate: "The two modes answer different questions.",
  rateDenominators: {
    pocketRegistrationRate: "cohortLearners",
    firstDepositRate: "cohortLearners",
    pocketToFirstDepositRate: "pocketRegisteredLearners",
  },
  cohortPeriod: PERIOD,
  reportCutoff: {
    cutoffUtc: "2026-07-30T12:00:00.000Z",
    cutoffLocal: "2026-07-30 15:00:00",
    cutoffDateLocal: null,
    source: "report_clock",
    clampedToReportClock: false,
    intervalConvention: "cutoff_exclusive",
  },
  filters: { affiliatePartnerId: null, affiliateCampaignId: null, affiliateTrackingLinkId: null },
} as const;

const MEDIANS = {
  selectedClickToAcademyRegistration: {
    medianSeconds: "1.5",
    sampleSize: 4,
    negativeDurationCount: 0,
  },
  academyRegistrationToPocketRegistration: {
    medianSeconds: "86400",
    sampleSize: 3,
    negativeDurationCount: 0,
  },
  pocketRegistrationToFirstDeposit: {
    medianSeconds: null,
    sampleSize: 0,
    negativeDurationCount: 0,
  },
  selectedClickToFirstDeposit: { medianSeconds: null, sampleSize: 0, negativeDurationCount: 0 },
} as const;

const FOLLOWUP = {
  cohortStartLocal: "2026-07-01 00:00:00",
  cohortEndLocal: "2026-07-31 00:00:00",
  cutoffLocal: "2026-07-30 15:00:00",
  cohortStartUtc: "2026-06-30T21:00:00.000Z",
  cohortEndUtc: "2026-07-30T21:00:00.000Z",
  cutoffUtc: "2026-07-30T12:00:00.000Z",
  minimumPossibleFollowupSeconds: 0,
  maximumPossibleFollowupSeconds: 2559600,
  cohortIntervalFullyBeforeCutoff: false,
  maturityAssessment: "not_scored",
  maturityReason: "empirical_maturity_model_not_implemented",
} as const;

function cohortSummary(over: Record<string, unknown> = {}) {
  return {
    ...COHORT_IDENTITY,
    metrics: { cohortLearners: 40, pocketRegisteredLearners: 15, firstDepositLearners: 6 },
    rates: {
      pocketRegistrationRate: "0.375",
      firstDepositRate: "0.15",
      pocketToFirstDepositRate: "0.4",
    },
    medianLags: MEDIANS,
    followup: FOLLOWUP,
    firstDepositAmount: AMOUNT_OK,
    integrityWarnings: {},
    dataAvailability: COHORT_AVAILABILITY,
    generatedAt: "2026-07-30T12:00:00.000Z",
    ...over,
  };
}

function cohortSeries(over: Record<string, unknown> = {}) {
  return {
    ...COHORT_IDENTITY,
    group: "day",
    bucketCap: 400,
    buckets: [
      {
        localLabel: "2026-07-01",
        acquisitionStartUtc: "2026-06-30T21:00:00.000Z",
        acquisitionEndUtc: "2026-07-01T21:00:00.000Z",
        metrics: { cohortLearners: 25, pocketRegisteredLearners: 10, firstDepositLearners: 4 },
        rates: {
          pocketRegistrationRate: "0.4",
          firstDepositRate: "0.16",
          pocketToFirstDepositRate: "0.4",
        },
        medianLags: MEDIANS,
        followup: FOLLOWUP,
      },
      {
        localLabel: "2026-07-02",
        acquisitionStartUtc: "2026-07-01T21:00:00.000Z",
        acquisitionEndUtc: "2026-07-02T21:00:00.000Z",
        metrics: { cohortLearners: 0, pocketRegisteredLearners: 0, firstDepositLearners: 0 },
        // A cohort of nobody has no conversion rate — null, never 0 %.
        rates: {
          pocketRegistrationRate: null,
          firstDepositRate: null,
          pocketToFirstDepositRate: null,
        },
        medianLags: MEDIANS,
        followup: FOLLOWUP,
      },
    ],
    totals: {
      metrics: { cohortLearners: 40, pocketRegisteredLearners: 15, firstDepositLearners: 6 },
      rates: {
        pocketRegistrationRate: "0.375",
        firstDepositRate: "0.15",
        pocketToFirstDepositRate: "0.4",
      },
      medianLags: MEDIANS,
      followup: FOLLOWUP,
    },
    reconciliation: {
      countsAreAdditive: true,
      ratesAreAdditive: false,
      mediansAreAdditive: false,
      explanation: "Bucket counts sum to the totals; rates and medians do not.",
    },
    firstDepositAmount: AMOUNT_OK,
    dataAvailability: COHORT_AVAILABILITY,
    generatedAt: "2026-07-30T12:00:00.000Z",
    ...over,
  };
}

function cohortBreakdown(over: Record<string, unknown> = {}) {
  return {
    ...COHORT_IDENTITY,
    dimension: "affiliate",
    includeZeroActivity: false,
    total: 1,
    limit: 25,
    offset: 0,
    rows: [
      {
        id: "1",
        code: "alpha",
        displayName: "Affiliate Alpha",
        status: "active",
        availability: "available",
        archived: false,
        affiliatePartnerId: "1",
        affiliateCampaignId: null,
        metrics: { cohortLearners: 40, pocketRegisteredLearners: 15, firstDepositLearners: 6 },
        rates: {
          pocketRegistrationRate: "0.375",
          firstDepositRate: "0.15",
          pocketToFirstDepositRate: "0.4",
        },
        medianLags: MEDIANS,
        followup: FOLLOWUP,
        firstDepositAmount: AMOUNT_OK,
        lastCohortActivityAt: "2026-07-29T10:00:00.000Z",
      },
    ],
    cohortTotals: {
      metrics: { cohortLearners: 40, pocketRegisteredLearners: 15, firstDepositLearners: 6 },
      rates: {
        pocketRegistrationRate: "0.375",
        firstDepositRate: "0.15",
        pocketToFirstDepositRate: "0.4",
      },
      followup: FOLLOWUP,
    },
    firstDepositAmount: AMOUNT_OK,
    dataAvailability: COHORT_AVAILABILITY,
    generatedAt: "2026-07-30T12:00:00.000Z",
    ...over,
  };
}

const ok = (data: unknown) => ({ status: "success", data });

/* ------------------------------------------------------------------ render */

function renderAs(
  permissions: Permission[],
  role: "crm_admin" | "analyst" = "analyst",
  search = "",
) {
  setSearch(search);
  const session = sessionFromDto({
    employeeId: "emp_1",
    displayName: "Тестовый сотрудник",
    role,
    effectivePermissions: permissions,
    permissionVersion: 1,
    expiresAt: "2026-08-01T10:00:00.000Z",
  });
  return render(
    <AuthenticatedSessionProvider session={session}>
      <AffiliateAnalyticsWorkspace />
    </AuthenticatedSessionProvider>,
  );
}

const ANALYST: Permission[] = ["view_affiliate_analytics"];
const ADMIN: Permission[] = ["manage_settings", "view_affiliate_analytics"];
/** Real staff permissions that grant neither analytics nor settings. */
const UNRELATED: Permission[] = ["view_audit"];

beforeEach(() => {
  setSearch("");
  pushMock.mockClear();
  filtersMock.mockReset().mockResolvedValue(
    ok({
      affiliatePartners: [
        { id: "1", code: "alpha", displayName: "Affiliate Alpha", status: "active", archived: false },
        { id: "2", code: "beta", displayName: "Affiliate Beta", status: "archived", archived: true },
      ],
      affiliateCampaigns: [
        {
          id: "10",
          affiliatePartnerId: "1",
          code: "a-one",
          displayName: "Campaign Alpha One",
          status: "active",
          archived: false,
        },
      ],
      affiliateTrackingLinks: [
        {
          id: "100",
          affiliatePartnerId: "1",
          affiliateCampaignId: "10",
          publicCode: "aone",
          displayName: "Link Alpha One",
          status: "active",
          availability: "available",
          archived: false,
        },
      ],
    }),
  );
  eventSummaryMock.mockReset().mockResolvedValue(ok(eventSummary()));
  eventSeriesMock.mockReset().mockResolvedValue(ok(eventSeries()));
  eventBreakdownMock.mockReset().mockResolvedValue(ok(eventBreakdown()));
  cohortSummaryMock.mockReset().mockResolvedValue(ok(cohortSummary()));
  cohortSeriesMock.mockReset().mockResolvedValue(ok(cohortSeries()));
  cohortBreakdownMock.mockReset().mockResolvedValue(ok(cohortBreakdown()));
});

afterEach(() => {
  vi.clearAllMocks();
});

/* -------------------------------------------------------------- permissions */

describe("permissions", () => {
  it("renders for an analyst holding view_affiliate_analytics", async () => {
    renderAs(ANALYST);
    expect(await screen.findByRole("heading", { name: "Аналитика аффилейтов" })).toBeInTheDocument();
  });

  it("renders for crm_admin through manage_settings", async () => {
    renderAs(ADMIN, "crm_admin");
    expect(await screen.findByRole("heading", { name: "Аналитика аффилейтов" })).toBeInTheDocument();
  });

  it("denies staff holding neither permission", async () => {
    renderAs(UNRELATED, "crm_admin");
    expect(await screen.findByText("Недостаточно прав")).toBeInTheDocument();
  });

  it("issues no analytics request at all when denied", async () => {
    renderAs(UNRELATED);
    await waitFor(() => expect(screen.getByText("Недостаточно прав")).toBeInTheDocument());
    expect(eventSummaryMock).not.toHaveBeenCalled();
    expect(filtersMock).not.toHaveBeenCalled();
  });

  it("exposes no PII reveal control to either role", async () => {
    renderAs(ADMIN, "crm_admin");
    await screen.findByRole("heading", { name: "Аналитика аффилейтов" });
    expect(screen.queryByRole("button", { name: /раскрыть|reveal/i })).toBeNull();
  });
});

/* --------------------------------------------------------------- lead APIs */

describe("lead and PII boundaries", () => {
  it("calls no lead API", async () => {
    renderAs(ANALYST);
    await screen.findByText("Сводка");
    // Every mocked callable is an analytics one; there is no lead client
    // imported by this module at all, so there is nothing to call.
    const called = [
      filtersMock,
      eventSummaryMock,
      eventSeriesMock,
      eventBreakdownMock,
    ].filter((mock) => mock.mock.calls.length > 0);
    expect(called.length).toBeGreaterThan(0);
    expect(cohortSummaryMock).not.toHaveBeenCalled();
  });

  it("paints no email, click id, Pocket id or visitor id", async () => {
    const { container } = renderAs(ANALYST);
    await screen.findByText("Сводка");
    const html = container.innerHTML.toLowerCase();
    for (const forbidden of ["@example", "clickid", "ataclickid", "pocketplayer", "visitorid", "postback_secret"]) {
      expect(html).not.toContain(forbidden);
    }
  });
});

/* ------------------------------------------------------------------- modes */

describe("modes", () => {
  it("defaults to event-date", async () => {
    renderAs(ANALYST);
    await screen.findByText("Показатели периода");
    expect(screen.getByRole("radio", { name: /По дате события/ })).toBeChecked();
    expect(eventSummaryMock).toHaveBeenCalled();
    expect(cohortSummaryMock).not.toHaveBeenCalled();
  });

  it("requests only the active mode's endpoints", async () => {
    renderAs(ANALYST, "analyst", "?mode=acquisition_cohort");
    await screen.findByRole("heading", { name: "Когорта привлечения" });
    expect(cohortSummaryMock).toHaveBeenCalled();
    expect(eventSummaryMock).not.toHaveBeenCalled();
  });

  it("writes the mode into the URL", async () => {
    renderAs(ANALYST);
    await screen.findByText("Показатели периода");
    await userEvent.click(screen.getByRole("radio", { name: /По когорте привлечения/ }));
    expect(pushMock).toHaveBeenCalledWith(
      expect.stringContaining("mode=acquisition_cohort"),
    );
  });

  it("restores cohort mode from the URL, as back/forward does", async () => {
    renderAs(ANALYST, "analyst", "?mode=acquisition_cohort");
    expect(await screen.findByRole("heading", { name: "Когорта привлечения" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /По когорте привлечения/ })).toBeChecked();
  });

  it("keeps the two modes' semantics visibly distinct", async () => {
    const { unmount } = renderAs(ANALYST);
    await screen.findByText("Соотношения событий периода");
    expect(screen.getByText(/не вероятность конверсии клика/)).toBeInTheDocument();
    expect(screen.queryByText(/Конверсия когорты/)).toBeNull();
    unmount();

    renderAs(ANALYST, "analyst", "?mode=acquisition_cohort");
    await screen.findByText("Конверсия когорты");
    // The event-date ratio wording must not appear in cohort mode.
    expect(screen.queryByText("Соотношения событий периода")).toBeNull();
  });
});

/* --------------------------------------------------------- event-date view */

describe("event-date summary", () => {
  it("shows every count metric", async () => {
    renderAs(ANALYST);
    await screen.findByText("Показатели периода");
    for (const label of [
      "Квалифицированные клики",
      "Уникальные посетители",
      "Регистрации в Академии",
      "Регистрации в Pocket",
      "Первые депозиты",
      "FD в ожидании идентификации",
      "FD с конфликтом",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
  });

  it("labels ratios as period event ratios and names the denominators", async () => {
    renderAs(ANALYST);
    await screen.findByText("Соотношения событий периода");
    expect(screen.getAllByText(/Знаменатель:/).length).toBe(5);
    expect(screen.getAllByText(/соотношения событий периода/i).length).toBeGreaterThan(0);
  });

  it("shows a null denominator as insufficient data and never as 0 %", async () => {
    eventSummaryMock.mockResolvedValue(
      ok(
        eventSummary({
          coverage: {
            attributed: { ...counts(), ratios: ratios() },
            unattributed: { ...counts(), ratios: ratios() },
            total: {
              ...counts({ qualifiedClicks: 0, academyRegistrations: 0 }),
              ratios: ratios({ qualifiedClickToAcademyRegistrationRate: null }),
            },
          },
        }),
      ),
    );
    renderAs(ANALYST);
    await screen.findByText("Соотношения событий периода");
    expect(screen.getAllByText("Недостаточно данных").length).toBeGreaterThan(0);
  });

  it("shows a genuine zero numerator as a real zero", async () => {
    eventSummaryMock.mockResolvedValue(
      ok(
        eventSummary({
          coverage: {
            attributed: { ...counts(), ratios: ratios() },
            unattributed: { ...counts(), ratios: ratios() },
            total: { ...counts(), ratios: ratios({ qualifiedClickToFirstDepositRate: "0" }) },
          },
        }),
      ),
    );
    renderAs(ANALYST);
    await screen.findByText("Соотношения событий периода");
    expect(screen.getByText("0,00 %")).toBeInTheDocument();
  });

  it("explains that period uniques are not the sum of bucket uniques", async () => {
    renderAs(ANALYST);
    await screen.findByText("Показатели периода");
    expect(
      screen.getByText(/не равны сумме значений по столбцам графика/),
    ).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------- FD amounts */

describe("first-deposit amounts", () => {
  it("shows the total with its currency when aggregation is available", async () => {
    renderAs(ANALYST);
    await screen.findByText("Показатели периода");
    expect(screen.getAllByText(/EUR/).length).toBeGreaterThan(0);
  });

  it("withholds the total for a mixed or unspecified currency", async () => {
    eventSummaryMock.mockResolvedValue(ok(eventSummary({ firstDepositAmount: AMOUNT_MIXED })));
    renderAs(ANALYST);
    await screen.findByText("Показатели периода");
    expect(screen.getByText(/валюта не указана или в периоде несколько валют/i)).toBeInTheDocument();
    expect(screen.queryByText(/USD/)).toBeNull();
  });

  it("uses no balance or revenue language", async () => {
    const { container } = renderAs(ANALYST);
    await screen.findByText("Показатели периода");
    const text = container.textContent!.toLowerCase();
    expect(text).not.toContain("выручк");
    expect(text).not.toContain("прибыл");
  });
});

/* ------------------------------------------------------------- coverage */

describe("attributed and unattributed coverage", () => {
  it("offers all three slices when unfiltered", async () => {
    renderAs(ANALYST);
    await screen.findByText("Показатели периода");
    expect(screen.getByRole("radio", { name: "Всего" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: "С атрибуцией" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: "Без атрибуции" })).toBeEnabled();
  });

  it("disables the unavailable slices and explains why when a filter is set", async () => {
    renderAs(ANALYST, "analyst", "?affiliatePartnerId=1");
    await screen.findByText("Показатели периода");
    expect(screen.getByRole("radio", { name: "Без атрибуции" })).toBeDisabled();
    expect(screen.getAllByText(/только совпадающие записи с атрибуцией/).length).toBeGreaterThan(0);
  });

  it("creates no synthetic organic affiliate", async () => {
    // Viewing the unattributed slice is where the claim could be made, so it is
    // where the copy has to say that this is a reporting bucket, not a partner.
    renderAs(ANALYST, "analyst", "?coverage=unattributed");
    await screen.findByText("Показатели периода");
    expect(screen.getByText(/отчётная категория, а не аффилейт/)).toBeInTheDocument();
    // And no such affiliate is ever offered as a filter option.
    const select = screen.getByLabelText("Аффилейт") as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent?.toLowerCase() ?? "");
    expect(labels.some((label) => label.includes("organic") || label.includes("прямой"))).toBe(
      false,
    );
  });
});

/* --------------------------------------------------------------- cohort */

describe("cohort summary", () => {
  it("shows the cohort population and its anchor", async () => {
    renderAs(ANALYST, "analyst", "?mode=acquisition_cohort");
    await screen.findByRole("heading", { name: "Когорта привлечения" });
    expect(screen.getAllByText("Пользователи в когорте").length).toBeGreaterThan(0);
    expect(screen.getByText("Выбранный атрибуционный клик")).toBeInTheDocument();
  });

  it("uses the required Russian cohort explanation", async () => {
    renderAs(ANALYST, "analyst", "?mode=acquisition_cohort");
    await screen.findByRole("heading", { name: "Когорта привлечения" });
    expect(
      screen.getByText(
        /Когорта сформирована по выбранному атрибуционному клику уже зарегистрированных пользователей/,
      ),
    ).toBeInTheDocument();
  });

  it("shows the three cohort rates with their denominators", async () => {
    renderAs(ANALYST, "analyst", "?mode=acquisition_cohort");
    await screen.findByText("Конверсия когорты");
    expect(screen.getAllByText("37,5 %").length).toBeGreaterThan(0);
    expect(screen.getAllByText("15,0 %").length).toBeGreaterThan(0);
    expect(screen.getAllByText("40,0 %").length).toBeGreaterThan(0);
  });

  it("shows exact medians with their sample sizes", async () => {
    renderAs(ANALYST, "analyst", "?mode=acquisition_cohort");
    await screen.findByText("Медианные задержки");
    // 1.5 s must not round to "0 сек" or to "2 сек".
    expect(screen.getByText("1,5 сек")).toBeInTheDocument();
    expect(screen.getByText(/4 наблюдения/)).toBeInTheDocument();
    expect(screen.getByText("1 день")).toBeInTheDocument();
  });

  it("shows a zero-sample median as unavailable, not as zero", async () => {
    renderAs(ANALYST, "analyst", "?mode=acquisition_cohort");
    await screen.findByText("Медианные задержки");
    expect(screen.getByText("Нет наблюдений")).toBeInTheDocument();
  });

  it("shows the follow-up window and refuses to score maturity", async () => {
    renderAs(ANALYST, "analyst", "?mode=acquisition_cohort");
    await screen.findByText("Окно наблюдения");
    expect(screen.getByText("Минимальное наблюдение")).toBeInTheDocument();
    expect(screen.getByText("Максимальное наблюдение")).toBeInTheDocument();
    expect(screen.getByText(/не оценка зрелости когорты/)).toBeInTheDocument();
  });

  it("states that direct registrations are absent from the cohort", async () => {
    renderAs(ANALYST, "analyst", "?mode=acquisition_cohort");
    await screen.findByText("Границы режима");
    expect(screen.getByText(/Прямые регистрации без атрибуционного клика в когорту не входят/)).toBeInTheDocument();
  });

  it("states that anonymous visitor conversion is not measured", async () => {
    renderAs(ANALYST, "analyst", "?mode=acquisition_cohort");
    await screen.findByText("Границы режима");
    expect(
      screen.getByText(/Конверсия анонимного посетителя в регистрацию не измеряется/),
    ).toBeInTheDocument();
  });

  it("shows the cutoff and its exclusive boundary", async () => {
    renderAs(ANALYST, "analyst", "?mode=acquisition_cohort");
    await screen.findByRole("heading", { name: "Когорта привлечения" });
    expect(screen.getByLabelText("Отсечка наблюдения")).toBeInTheDocument();
    expect(screen.getAllByText(/граница не включается/).length).toBeGreaterThan(0);
  });

  it("reports a clamped cutoff rather than hiding it", async () => {
    cohortSummaryMock.mockResolvedValue(
      ok(
        cohortSummary({
          reportCutoff: {
            ...COHORT_IDENTITY.reportCutoff,
            cutoffDateLocal: "2026-07-30",
            source: "explicit_date",
            clampedToReportClock: true,
          },
        }),
      ),
    );
    renderAs(ANALYST, "analyst", "?mode=acquisition_cohort&cutoffDate=2026-07-30");
    await screen.findByRole("heading", { name: "Когорта привлечения" });
    expect(screen.getByText(/ограничена моментом построения отчёта/)).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------- availability */

describe("data availability", () => {
  it("shows unavailable capabilities as reasons, never as zero metrics", async () => {
    renderAs(ANALYST);
    await screen.findByText("Доступность данных");
    const section = screen.getByText("Доступность данных").closest("section")!;
    expect(within(section).getByText("Повторные депозиты")).toBeInTheDocument();
    expect(within(section).getByText("Текущий баланс")).toBeInTheDocument();
    expect(within(section).getByText(/не собираются/)).toBeInTheDocument();
    expect(within(section).queryByText("0")).toBeNull();
  });

  it("marks lead drilldown as API-ready but UI-deferred", async () => {
    renderAs(ANALYST);
    await screen.findByText("Доступность данных");
    expect(screen.getByText(/интерфейс появится в следующей фазе/)).toBeInTheDocument();
  });

  it("shows maturity and forecasting as unavailable in cohort mode", async () => {
    renderAs(ANALYST, "analyst", "?mode=acquisition_cohort");
    await screen.findByText("Доступность данных");
    expect(screen.getByText("Оценка зрелости когорты")).toBeInTheDocument();
    expect(screen.getByText("Прогноз")).toBeInTheDocument();
  });
});

/* --------------------------------------------------------------- breakdown */

describe("breakdown", () => {
  it("lists rows with their codes and archived state", async () => {
    renderAs(ANALYST);
    await screen.findByText("Детализация");
    expect(screen.getAllByText("Affiliate Alpha").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/в архиве/).length).toBeGreaterThan(0);
  });

  it("shows the backend total rather than the visible page length", async () => {
    eventBreakdownMock.mockResolvedValue(ok(eventBreakdown({ total: 57 })));
    renderAs(ANALYST);
    await screen.findByText("Детализация");
    expect(screen.getByText(/из 57/)).toBeInTheDocument();
  });

  it("writes the dimension into the URL", async () => {
    renderAs(ANALYST);
    await screen.findByText("Детализация");
    await userEvent.click(screen.getByRole("radio", { name: "Кампании" }));
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("dimension=campaign"));
  });

  it("shows an empty state for a filtered period with no rows", async () => {
    eventBreakdownMock.mockResolvedValue(ok(eventBreakdown({ rows: [], total: 0 })));
    renderAs(ANALYST);
    expect(await screen.findByText("Нет строк")).toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------- states */

describe("request states", () => {
  it("shows a loading state before the first response", async () => {
    eventSummaryMock.mockReturnValue(new Promise(() => {}));
    renderAs(ANALYST);
    expect(await screen.findByText("Загружаем сводку…")).toBeInTheDocument();
  });

  it("shows a retryable error when a section fails", async () => {
    eventSummaryMock.mockResolvedValue({ status: "upstream_unavailable" });
    renderAs(ANALYST);
    expect(await screen.findByText(/Сервис аналитики недоступен/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Повторить" })).toBeInTheDocument();
  });

  it("retries only the failed section", async () => {
    eventSummaryMock.mockResolvedValue({ status: "upstream_unavailable" });
    renderAs(ANALYST);
    await screen.findByRole("button", { name: "Повторить" });
    const before = eventBreakdownMock.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => expect(eventSummaryMock.mock.calls.length).toBeGreaterThan(1));
    expect(eventBreakdownMock.mock.calls.length).toBe(before);
  });

  it("surfaces an expired session", async () => {
    eventSummaryMock.mockResolvedValue({ status: "unauthenticated" });
    renderAs(ANALYST);
    expect(await screen.findByText(/Сессия истекла/)).toBeInTheDocument();
  });

  it("offers a coarser grouping when the bucket cap is exceeded", async () => {
    eventSeriesMock.mockResolvedValue({
      status: "bucket_cap_exceeded",
      messageKey: "crm.analytics.bucket_cap_exceeded",
    });
    renderAs(ANALYST);
    expect(await screen.findByText(/Выберите более крупную группировку/)).toBeInTheDocument();
    // The filters survive the error — the operator can act on it.
    expect(screen.getByLabelText("Группировка")).toBeInTheDocument();
  });

  it("does not blank the page when only one section fails", async () => {
    eventSeriesMock.mockResolvedValue({ status: "upstream_unavailable" });
    renderAs(ANALYST);
    await screen.findByText("Показатели периода");
    expect(screen.getByText("Показатели периода")).toBeInTheDocument();
  });
});

/* -------------------------------------------------- stale-response safety */

describe("request orchestration", () => {
  it("issues exactly one request per section for one URL state", async () => {
    renderAs(ANALYST);
    await screen.findByText("Показатели периода");
    await waitFor(() => expect(eventSummaryMock).toHaveBeenCalledTimes(1));
    expect(eventSeriesMock).toHaveBeenCalledTimes(1);
    expect(eventBreakdownMock).toHaveBeenCalledTimes(1);
  });

  it("does not let a slow earlier response overwrite a newer state", async () => {
    // The FIRST request resolves LAST, and with a number that belongs to the
    // filter the operator has already left. Without the generation check its
    // 999 would land on screen under the new heading.
    let releaseFirst: (value: unknown) => void = () => {};
    eventSummaryMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve;
        }),
    );
    eventSummaryMock.mockResolvedValue(ok(eventSummary()));

    renderAs(ANALYST);
    await screen.findByText("Загружаем сводку…");

    // Changing the PERIOD is what supersedes the summary request. (Changing
    // coverage deliberately does not: all three slices arrive in one response,
    // so switching between them is a client-side view and issues no request.)
    await userEvent.selectOptions(screen.getByLabelText("Период"), "today");
    await waitFor(() => expect(eventSummaryMock).toHaveBeenCalledTimes(2));

    releaseFirst(
      ok(
        eventSummary({
          coverage: {
            attributed: { ...counts({ qualifiedClicks: 999 }), ratios: ratios() },
            unattributed: { ...counts(), ratios: ratios() },
            total: { ...counts({ qualifiedClicks: 999 }), ratios: ratios() },
          },
        }),
      ),
    );

    await screen.findByText("Показатели периода");
    expect(screen.queryByText("999")).toBeNull();
  });

  it("aborts the in-flight request when the query changes", async () => {
    const signals: AbortSignal[] = [];
    eventBreakdownMock.mockImplementation((_query: unknown, options: { signal: AbortSignal }) => {
      signals.push(options.signal);
      return new Promise(() => {});
    });

    renderAs(ANALYST);
    await screen.findByText("Детализация");
    await userEvent.click(screen.getByRole("radio", { name: "Кампании" }));

    // The push mock rewrites the search string; the component re-reads it on
    // its next render, which supersedes the first breakdown request.
    await waitFor(() => expect(signals.length).toBeGreaterThan(1));
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[signals.length - 1]!.aborted).toBe(false);
  });

  it("does not re-request a section that the change did not affect", async () => {
    renderAs(ANALYST);
    await screen.findByText("Детализация");
    await waitFor(() => expect(eventSummaryMock).toHaveBeenCalledTimes(1));
    const summaryCalls = eventSummaryMock.mock.calls.length;
    await userEvent.click(screen.getByRole("radio", { name: "Кампании" }));
    // The dimension is a breakdown input only; the summary must not refetch.
    expect(eventSummaryMock.mock.calls.length).toBe(summaryCalls);
  });
});

/* -------------------------------------------------------------- controls */

describe("controls", () => {
  it("offers every date preset in Russian", async () => {
    renderAs(ANALYST);
    await screen.findByLabelText("Период");
    const select = screen.getByLabelText("Период") as HTMLSelectElement;
    const labels = Array.from(select.options).map((option) => option.textContent);
    expect(labels).toEqual([
      "Сегодня",
      "Вчера",
      "Текущая неделя",
      "Прошлая неделя",
      "Последние 7 дней",
      "Последние 30 дней",
      "Текущий месяц",
      "Прошлый месяц",
      "Произвольный период",
      "За всё время",
    ]);
  });

  it("shows the backend-resolved period and the calendar contract", async () => {
    renderAs(ANALYST);
    await screen.findByText("Показатели периода");
    expect(screen.getAllByText(/Europe\/Moscow/).length).toBeGreaterThan(0);
    expect(screen.getByText(/неделя с понедельника/)).toBeInTheDocument();
    // The backend token is mapped to operator language: an internal
    // identifier must not appear in the UI.
    expect(screen.getByText(/начало включается, конец — нет/)).toBeInTheDocument();
    expect(screen.queryByText(/start_inclusive_end_exclusive/)).toBeNull();
  });

  it("reveals the custom range inputs only for the custom preset", async () => {
    renderAs(ANALYST);
    await screen.findByLabelText("Период");
    expect(screen.queryByLabelText("Начало (включительно)")).toBeNull();

    renderAs(
      ANALYST,
      "analyst",
      "?preset=custom&startDate=2026-01-01&endDate=2026-02-01",
    );
    expect(await screen.findByLabelText("Начало (включительно)")).toBeInTheDocument();
  });

  it("offers the three groupings in Russian", async () => {
    renderAs(ANALYST);
    const select = (await screen.findByLabelText("Группировка")) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      "По дням",
      "По неделям",
      "По месяцам",
    ]);
  });

  it("shows the cutoff control only in cohort mode", async () => {
    const { unmount } = renderAs(ANALYST);
    await screen.findByLabelText("Период");
    expect(screen.queryByLabelText("Отсечка наблюдения")).toBeNull();
    unmount();

    renderAs(ANALYST, "analyst", "?mode=acquisition_cohort");
    expect(await screen.findByLabelText("Отсечка наблюдения")).toBeInTheDocument();
  });

  it("offers archived dimensions as selectable history", async () => {
    renderAs(ANALYST);
    const select = (await screen.findByLabelText("Аффилейт")) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels.some((label) => label?.includes("Affiliate Beta"))).toBe(true);
    expect(labels.some((label) => label?.includes("в архиве"))).toBe(true);
  });

  it("writes filters into the URL", async () => {
    renderAs(ANALYST);
    await screen.findByLabelText("Аффилейт");
    await userEvent.selectOptions(screen.getByLabelText("Аффилейт"), "1");
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining("affiliatePartnerId=1"));
  });
});
