/**
 * AFD-5C1 — the URL grammar.
 *
 * These tests are the enforcement of §23. The state is shareable, so a URL is a
 * contract with whoever receives it: it must parse to the same screen, it must
 * survive a hand edit without throwing, and it must never carry an identifier
 * this phase is forbidden to expose.
 */
import { describe, expect, it } from "vitest";
import {
  applyAnalyticsChange,
  DEFAULT_ANALYTICS_STATE,
  filterQuery,
  isFiltered,
  isValidDateOnly,
  parseAnalyticsUrlState,
  periodQuery,
  serializeAnalyticsUrlState,
} from "./analytics-url-state";

describe("defaults", () => {
  it("opens in event-date mode", () => {
    expect(parseAnalyticsUrlState("").mode).toBe("event_date");
  });

  it("opens on last_30_days grouped by day, unfiltered, total coverage", () => {
    const state = parseAnalyticsUrlState("");
    expect(state.preset).toBe("last_30_days");
    expect(state.group).toBe("day");
    expect(state.coverage).toBe("total");
    expect(state.dimension).toBe("affiliate");
    expect(state.offset).toBe(0);
    expect(isFiltered(state)).toBe(false);
  });

  it("serializes the default state to an empty query", () => {
    expect(serializeAnalyticsUrlState(DEFAULT_ANALYTICS_STATE)).toBe("");
  });
});

describe("mode", () => {
  it("round-trips cohort mode", () => {
    const state = parseAnalyticsUrlState("?mode=acquisition_cohort");
    expect(state.mode).toBe("acquisition_cohort");
    expect(serializeAnalyticsUrlState(state)).toContain("mode=acquisition_cohort");
  });

  it("falls back to event_date for an unknown mode", () => {
    expect(parseAnalyticsUrlState("?mode=magic").mode).toBe("event_date");
  });
});

describe("presets", () => {
  const presets = [
    "today",
    "yesterday",
    "current_week",
    "previous_week",
    "last_7_days",
    "last_30_days",
    "current_month",
    "previous_month",
    "all_time",
  ] as const;

  for (const preset of presets) {
    it(`round-trips ${preset}`, () => {
      const state = parseAnalyticsUrlState(`?preset=${preset}`);
      expect(state.preset).toBe(preset);
      expect(parseAnalyticsUrlState(serializeAnalyticsUrlState(state)).preset).toBe(preset);
    });
  }

  it("falls back to the default for an unknown preset", () => {
    expect(parseAnalyticsUrlState("?preset=fortnight").preset).toBe("last_30_days");
  });

  it("drops dates that accompany a named preset", () => {
    // The backend refuses the combination outright; normalising here keeps the
    // UI from sending a request it knows will 400.
    const state = parseAnalyticsUrlState("?preset=today&startDate=2026-01-01&endDate=2026-02-01");
    expect(state.startDate).toBeNull();
    expect(state.endDate).toBeNull();
  });
});

describe("custom range", () => {
  it("keeps a complete valid range", () => {
    const state = parseAnalyticsUrlState(
      "?preset=custom&startDate=2026-01-01&endDate=2026-02-01",
    );
    expect(state.preset).toBe("custom");
    expect(state.startDate).toBe("2026-01-01");
    expect(state.endDate).toBe("2026-02-01");
  });

  it("falls back to the default preset when only one date is present", () => {
    const state = parseAnalyticsUrlState("?preset=custom&startDate=2026-01-01");
    expect(state.preset).toBe("last_30_days");
    expect(state.startDate).toBeNull();
  });

  it("rejects an impossible calendar date", () => {
    // The regex alone would accept 2026-02-31; it is not a day.
    expect(isValidDateOnly("2026-02-31")).toBe(false);
    expect(isValidDateOnly("2026-13-01")).toBe(false);
    expect(isValidDateOnly("2026-1-1")).toBe(false);
    expect(isValidDateOnly("2026-02-28")).toBe(true);
    expect(isValidDateOnly("2024-02-29")).toBe(true);
  });

  it("falls back when a date is syntactically valid but impossible", () => {
    const state = parseAnalyticsUrlState(
      "?preset=custom&startDate=2026-02-31&endDate=2026-03-01",
    );
    expect(state.preset).toBe("last_30_days");
  });

  it("emits both dates only for a custom preset", () => {
    const custom = serializeAnalyticsUrlState({
      ...DEFAULT_ANALYTICS_STATE,
      preset: "custom",
      startDate: "2026-01-01",
      endDate: "2026-02-01",
    });
    expect(custom).toContain("startDate=2026-01-01");
    expect(custom).toContain("endDate=2026-02-01");

    const named = serializeAnalyticsUrlState({
      ...DEFAULT_ANALYTICS_STATE,
      preset: "today",
      startDate: "2026-01-01",
      endDate: "2026-02-01",
    });
    expect(named).not.toContain("startDate");
  });
});

describe("cohort cutoff", () => {
  it("is kept in cohort mode", () => {
    const state = parseAnalyticsUrlState("?mode=acquisition_cohort&cutoffDate=2026-03-01");
    expect(state.cutoffDate).toBe("2026-03-01");
  });

  it("is dropped in event-date mode", () => {
    // A cohort-only input carried into an event-date URL would suggest it did
    // something. It does not.
    expect(parseAnalyticsUrlState("?cutoffDate=2026-03-01").cutoffDate).toBeNull();
  });

  it("is dropped when the mode changes away from cohort", () => {
    const cohort = parseAnalyticsUrlState("?mode=acquisition_cohort&cutoffDate=2026-03-01");
    expect(applyAnalyticsChange(cohort, { mode: "event_date" }).cutoffDate).toBeNull();
  });

  it("stays independent of the cohort period", () => {
    const state = parseAnalyticsUrlState(
      "?mode=acquisition_cohort&preset=previous_month&cutoffDate=2026-03-01",
    );
    const moved = applyAnalyticsChange(state, { preset: "current_month" });
    expect(moved.cutoffDate).toBe("2026-03-01");
    expect(moved.preset).toBe("current_month");
  });

  it("ignores an invalid cutoff rather than throwing", () => {
    expect(
      parseAnalyticsUrlState("?mode=acquisition_cohort&cutoffDate=not-a-date").cutoffDate,
    ).toBeNull();
  });
});

describe("grouping", () => {
  for (const group of ["day", "week", "month"] as const) {
    it(`round-trips ${group}`, () => {
      const state = parseAnalyticsUrlState(`?group=${group}`);
      expect(state.group).toBe(group);
      expect(parseAnalyticsUrlState(serializeAnalyticsUrlState(state)).group).toBe(group);
    });
  }

  it("falls back to day for an unknown grouping", () => {
    expect(parseAnalyticsUrlState("?group=hour").group).toBe("day");
  });
});

describe("filter hierarchy", () => {
  it("parses all three dimension ids", () => {
    const state = parseAnalyticsUrlState(
      "?affiliatePartnerId=1&affiliateCampaignId=2&affiliateTrackingLinkId=3",
    );
    expect(state.affiliatePartnerId).toBe("1");
    expect(state.affiliateCampaignId).toBe("2");
    expect(state.affiliateTrackingLinkId).toBe("3");
    expect(isFiltered(state)).toBe(true);
  });

  it("rejects a non-numeric or zero id", () => {
    expect(parseAnalyticsUrlState("?affiliatePartnerId=abc").affiliatePartnerId).toBeNull();
    expect(parseAnalyticsUrlState("?affiliatePartnerId=0").affiliatePartnerId).toBeNull();
    expect(parseAnalyticsUrlState("?affiliatePartnerId=-1").affiliatePartnerId).toBeNull();
  });

  it("clears campaign and link when the affiliate changes", () => {
    const state = parseAnalyticsUrlState(
      "?affiliatePartnerId=1&affiliateCampaignId=2&affiliateTrackingLinkId=3",
    );
    const next = applyAnalyticsChange(state, { affiliatePartnerId: "9" });
    expect(next.affiliateCampaignId).toBeNull();
    expect(next.affiliateTrackingLinkId).toBeNull();
  });

  it("clears only the link when the campaign changes", () => {
    const state = parseAnalyticsUrlState(
      "?affiliatePartnerId=1&affiliateCampaignId=2&affiliateTrackingLinkId=3",
    );
    const next = applyAnalyticsChange(state, { affiliateCampaignId: "7" });
    expect(next.affiliatePartnerId).toBe("1");
    expect(next.affiliateTrackingLinkId).toBeNull();
  });

  it("clears children when the affiliate is cleared", () => {
    const state = parseAnalyticsUrlState("?affiliatePartnerId=1&affiliateCampaignId=2");
    const next = applyAnalyticsChange(state, { affiliatePartnerId: null });
    expect(next.affiliateCampaignId).toBeNull();
  });
});

describe("coverage", () => {
  it("is forced to attributed whenever a filter is set", () => {
    // The backend returns null for the other two slices of a filtered request,
    // so any other value would name a slice that is not in the response.
    const state = parseAnalyticsUrlState("?coverage=total&affiliatePartnerId=1");
    expect(state.coverage).toBe("attributed");
  });

  it("keeps an explicit unattributed view when unfiltered", () => {
    expect(parseAnalyticsUrlState("?coverage=unattributed").coverage).toBe("unattributed");
  });

  it("switches to attributed when a filter is applied", () => {
    const state = parseAnalyticsUrlState("?coverage=unattributed");
    expect(applyAnalyticsChange(state, { affiliatePartnerId: "1" }).coverage).toBe("attributed");
  });
});

describe("paging", () => {
  it("resets the offset for any non-paging change", () => {
    const state = parseAnalyticsUrlState("?offset=50");
    expect(applyAnalyticsChange(state, { preset: "today" }).offset).toBe(0);
    expect(applyAnalyticsChange(state, { dimension: "campaign" }).offset).toBe(0);
  });

  it("keeps an explicit paging change", () => {
    const state = parseAnalyticsUrlState("");
    expect(applyAnalyticsChange(state, { offset: 25 }).offset).toBe(25);
  });

  it("ignores a malformed offset", () => {
    expect(parseAnalyticsUrlState("?offset=abc").offset).toBe(0);
    expect(parseAnalyticsUrlState("?offset=-5").offset).toBe(0);
  });
});

describe("normalisation and safety", () => {
  it("never throws on a hand-edited URL", () => {
    for (const query of [
      "?mode=&preset=&group=",
      "?%%%",
      "?affiliatePartnerId=999999999999999",
      "?coverage=&dimension=&offset=",
      "?mode=acquisition_cohort&cutoffDate=2026-99-99",
    ]) {
      expect(() => parseAnalyticsUrlState(query)).not.toThrow();
    }
  });

  it("drops unknown keys instead of carrying them", () => {
    const state = parseAnalyticsUrlState("?mode=event_date&leadId=42&email=a%40b.c&token=secret");
    const serialized = serializeAnalyticsUrlState(state);
    expect(serialized).not.toContain("leadId");
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("token");
  });

  it("cannot express any forbidden identifier", () => {
    // §23/§39: no token, no PII, no Pocket id, no click id, no visitor id.
    const serialized = serializeAnalyticsUrlState({
      ...DEFAULT_ANALYTICS_STATE,
      mode: "acquisition_cohort",
      preset: "custom",
      startDate: "2026-01-01",
      endDate: "2026-02-01",
      cutoffDate: "2026-03-01",
      affiliatePartnerId: "1",
      affiliateCampaignId: "2",
      affiliateTrackingLinkId: "3",
      dimension: "tracking_link",
      offset: 25,
    });
    for (const forbidden of [
      "token",
      "email",
      "leadId",
      "userId",
      "pocket",
      "clickId",
      "ataClickId",
      "visitor",
      "cookie",
      "session",
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("is idempotent — parse ∘ serialize ∘ parse is stable", () => {
    const query =
      "?mode=acquisition_cohort&preset=custom&startDate=2026-01-01&endDate=2026-02-01" +
      "&cutoffDate=2026-03-01&group=week&affiliatePartnerId=1&dimension=campaign&offset=25";
    const once = serializeAnalyticsUrlState(parseAnalyticsUrlState(query));
    const twice = serializeAnalyticsUrlState(parseAnalyticsUrlState(once));
    expect(twice).toBe(once);
  });

  it("serializes keys in a deterministic order", () => {
    const a = serializeAnalyticsUrlState(
      parseAnalyticsUrlState("?group=week&mode=acquisition_cohort&affiliatePartnerId=1"),
    );
    const b = serializeAnalyticsUrlState(
      parseAnalyticsUrlState("?affiliatePartnerId=1&mode=acquisition_cohort&group=week"),
    );
    expect(a).toBe(b);
  });
});

describe("query projection", () => {
  it("omits absent filters entirely rather than sending empty values", () => {
    expect(filterQuery(parseAnalyticsUrlState(""))).toEqual({});
    expect(filterQuery(parseAnalyticsUrlState("?affiliatePartnerId=1"))).toEqual({
      affiliatePartnerId: "1",
    });
  });

  it("sends custom dates only for a custom preset", () => {
    expect(periodQuery(parseAnalyticsUrlState("?preset=today"))).toEqual({ preset: "today" });
    expect(
      periodQuery(parseAnalyticsUrlState("?preset=custom&startDate=2026-01-01&endDate=2026-02-01")),
    ).toEqual({ preset: "custom", startDate: "2026-01-01", endDate: "2026-02-01" });
  });
});
