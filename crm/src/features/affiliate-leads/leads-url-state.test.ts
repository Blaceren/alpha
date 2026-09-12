/**
 * AFD-5C2 — the lead URL grammar.
 *
 * The properties that matter here are privacy properties as much as routing
 * ones: what CAN be written to a shareable link, what is silently dropped, and
 * that no revealed identity has any representation at all.
 */
import { describe, expect, it } from "vitest";
import {
  applyLeadsChange,
  DEFAULT_LEAD_STATE,
  hasDimensionFilter,
  isLeadsFiltered,
  isValidDateOnly,
  leadListQueryFrom,
  LEADS_DEFAULT_PAGE_SIZE,
  LEADS_MAX_PAGE_SIZE,
  parseLeadsUrlState,
  serializeLeadsUrlState,
} from "./leads-url-state";

describe("parseLeadsUrlState", () => {
  it("returns the default state for an empty query", () => {
    expect(parseLeadsUrlState("")).toEqual(DEFAULT_LEAD_STATE);
  });

  it("defaults BOTH periods to absent rather than to a window", () => {
    const state = parseLeadsUrlState("");
    expect(state.registration.preset).toBeNull();
    expect(state.acquisition.preset).toBeNull();
  });

  it("reads every supported filter", () => {
    const state = parseLeadsUrlState(
      "?affiliatePartnerId=1&affiliateCampaignId=10&affiliateTrackingLinkId=100" +
        "&attributionState=attributed&journeyStage=pocket_registered&depositState=conflict" +
        "&sort=first_deposit_desc&pageSize=50",
    );
    expect(state.affiliatePartnerId).toBe("1");
    expect(state.affiliateCampaignId).toBe("10");
    expect(state.affiliateTrackingLinkId).toBe("100");
    expect(state.attributionState).toBe("attributed");
    expect(state.journeyStage).toBe("pocket_registered");
    expect(state.depositState).toBe("conflict");
    expect(state.sort).toBe("first_deposit_desc");
    expect(state.pageSize).toBe(50);
  });

  it("keeps the two periods separate and never merges them", () => {
    const state = parseLeadsUrlState(
      "?registrationPreset=custom&registrationStartDate=2026-07-01&registrationEndDate=2026-08-01" +
        "&acquisitionPreset=last_7_days",
    );
    expect(state.registration).toEqual({
      preset: "custom",
      startDate: "2026-07-01",
      endDate: "2026-08-01",
    });
    expect(state.acquisition).toEqual({
      preset: "last_7_days",
      startDate: null,
      endDate: null,
    });
  });

  it("normalises an unknown enum to the default instead of throwing", () => {
    const state = parseLeadsUrlState(
      "?journeyStage=churned&depositState=refunded&attributionState=maybe&sort=email_asc",
    );
    expect(state.journeyStage).toBeNull();
    expect(state.depositState).toBeNull();
    expect(state.attributionState).toBeNull();
    expect(state.sort).toBe(DEFAULT_LEAD_STATE.sort);
  });

  it("drops a non-numeric or zero dimension id", () => {
    const state = parseLeadsUrlState(
      "?affiliatePartnerId=abc&affiliateCampaignId=0&affiliateTrackingLinkId=-4",
    );
    expect(state.affiliatePartnerId).toBeNull();
    expect(state.affiliateCampaignId).toBeNull();
    expect(state.affiliateTrackingLinkId).toBeNull();
  });

  it("drops a custom period that is missing a boundary", () => {
    expect(parseLeadsUrlState("?registrationPreset=custom").registration.preset).toBeNull();
    expect(
      parseLeadsUrlState("?registrationPreset=custom&registrationStartDate=2026-07-01")
        .registration.preset,
    ).toBeNull();
  });

  it("rejects an impossible calendar date", () => {
    const state = parseLeadsUrlState(
      "?registrationPreset=custom&registrationStartDate=2026-02-31&registrationEndDate=2026-03-01",
    );
    expect(state.registration.preset).toBeNull();
  });

  it("drops the acquisition period when the caller asked for direct leads", () => {
    // The backend refuses the combination outright, so carrying it would
    // guarantee a 400 the operator did not cause.
    const state = parseLeadsUrlState(
      "?attributionState=unattributed&acquisitionPreset=last_7_days",
    );
    expect(state.attributionState).toBe("unattributed");
    expect(state.acquisition.preset).toBeNull();
  });

  it("clamps a page size outside the backend bounds to the default", () => {
    expect(parseLeadsUrlState("?pageSize=0").pageSize).toBe(LEADS_DEFAULT_PAGE_SIZE);
    expect(parseLeadsUrlState(`?pageSize=${LEADS_MAX_PAGE_SIZE + 1}`).pageSize).toBe(
      LEADS_DEFAULT_PAGE_SIZE,
    );
    expect(parseLeadsUrlState("?pageSize=abc").pageSize).toBe(LEADS_DEFAULT_PAGE_SIZE);
    expect(parseLeadsUrlState(`?pageSize=${LEADS_MAX_PAGE_SIZE}`).pageSize).toBe(
      LEADS_MAX_PAGE_SIZE,
    );
  });

  it("accepts an opaque cursor without decoding it", () => {
    const cursor = "eyJ2IjoxLCJmIjoiYWJjIn0";
    expect(parseLeadsUrlState(`?cursor=${cursor}`).cursor).toBe(cursor);
  });

  it("drops a cursor that is not in the opaque alphabet", () => {
    expect(parseLeadsUrlState("?cursor=has%20space").cursor).toBeNull();
    expect(parseLeadsUrlState(`?cursor=${"x".repeat(600)}`).cursor).toBeNull();
  });

  it("drops every key it does not know", () => {
    const state = parseLeadsUrlState(
      "?email=nina@example.invalid&userId=34&pocketPlayerId=99&clickId=abc&token=secret",
    );
    expect(serializeLeadsUrlState(state)).toBe("");
  });
});

describe("serializeLeadsUrlState", () => {
  it("omits defaults so a fresh page has an empty query", () => {
    expect(serializeLeadsUrlState(DEFAULT_LEAD_STATE)).toBe("");
  });

  it("round-trips to a stable string", () => {
    const raw =
      "?affiliatePartnerId=1&attributionState=attributed&journeyStage=pocket_registered" +
      "&depositState=confirmed&registrationPreset=custom&registrationStartDate=2026-07-01" +
      "&registrationEndDate=2026-08-01&acquisitionPreset=last_30_days&sort=acquisition_asc" +
      "&pageSize=50";
    const once = serializeLeadsUrlState(parseLeadsUrlState(raw));
    const twice = serializeLeadsUrlState(parseLeadsUrlState(once));
    expect(twice).toBe(once);
  });

  it("never emits a key outside the closed list", () => {
    const query = serializeLeadsUrlState({
      ...DEFAULT_LEAD_STATE,
      affiliatePartnerId: "1",
      attributionState: "attributed",
      journeyStage: "academy_registered",
      depositState: "pending_identity",
      registration: { preset: "today", startDate: null, endDate: null },
      acquisition: { preset: "yesterday", startDate: null, endDate: null },
      sort: "acquisition_desc",
      pageSize: 50,
      cursor: "abc",
    });
    const keys = [...new URLSearchParams(query.slice(1)).keys()].sort();
    expect(keys).toEqual([
      "acquisitionPreset",
      "affiliatePartnerId",
      "attributionState",
      "cursor",
      "depositState",
      "journeyStage",
      "pageSize",
      "registrationPreset",
      "sort",
    ]);
  });

  it("has no representation for an email, a name or any identifier", () => {
    // The state TYPE has no such field, so this is really a statement about the
    // serializer: even a state object contaminated at runtime cannot emit one.
    const contaminated = {
      ...DEFAULT_LEAD_STATE,
      email: "nina@example.invalid",
      displayName: "Нина",
      userId: 34,
      pocketPlayerId: "99",
      revealedEmail: "nina@example.invalid",
    } as unknown as typeof DEFAULT_LEAD_STATE;
    expect(serializeLeadsUrlState(contaminated)).toBe("");
  });

  it("omits custom dates when the preset is not custom", () => {
    const query = serializeLeadsUrlState({
      ...DEFAULT_LEAD_STATE,
      registration: { preset: "today", startDate: "2026-07-01", endDate: "2026-08-01" },
    });
    expect(query).toBe("?registrationPreset=today");
  });
});

describe("applyLeadsChange", () => {
  it("clears campaign and link when the affiliate changes", () => {
    const state = parseLeadsUrlState(
      "?affiliatePartnerId=1&affiliateCampaignId=10&affiliateTrackingLinkId=100",
    );
    const next = applyLeadsChange(state, { affiliatePartnerId: "2" });
    expect(next.affiliateCampaignId).toBeNull();
    expect(next.affiliateTrackingLinkId).toBeNull();
  });

  it("clears the link when the campaign changes but keeps the affiliate", () => {
    const state = parseLeadsUrlState(
      "?affiliatePartnerId=1&affiliateCampaignId=10&affiliateTrackingLinkId=100",
    );
    const next = applyLeadsChange(state, { affiliateCampaignId: "11" });
    expect(next.affiliatePartnerId).toBe("1");
    expect(next.affiliateTrackingLinkId).toBeNull();
  });

  it("resets the cursor on any change that is not paging", () => {
    const state = parseLeadsUrlState("?cursor=abc&sort=registration_asc");
    expect(applyLeadsChange(state, { depositState: "confirmed" }).cursor).toBeNull();
    expect(applyLeadsChange(state, { sort: "first_deposit_desc" }).cursor).toBeNull();
    expect(
      applyLeadsChange(state, { registration: { preset: "today", startDate: null, endDate: null } })
        .cursor,
    ).toBeNull();
  });

  it("keeps a cursor set by paging alone", () => {
    const state = parseLeadsUrlState("?sort=registration_asc");
    expect(applyLeadsChange(state, { cursor: "next" }).cursor).toBe("next");
  });

  it("drops an acquisition period when switching to direct leads", () => {
    const state = parseLeadsUrlState("?acquisitionPreset=last_7_days");
    const next = applyLeadsChange(state, { attributionState: "unattributed" });
    expect(next.acquisition.preset).toBeNull();
  });
});

describe("leadListQueryFrom", () => {
  it("sends only the keys the backend accepts", () => {
    const query = leadListQueryFrom(
      parseLeadsUrlState(
        "?affiliatePartnerId=1&attributionState=attributed&journeyStage=pocket_registered" +
          "&depositState=confirmed&registrationPreset=custom&registrationStartDate=2026-07-01" +
          "&registrationEndDate=2026-08-01&acquisitionPreset=last_7_days&sort=acquisition_desc" +
          "&pageSize=50&cursor=abc",
      ),
    );
    expect(query).toEqual({
      affiliatePartnerId: "1",
      attributionState: "attributed",
      journeyStage: "pocket_registered",
      depositState: "confirmed",
      registrationPreset: "custom",
      registrationStartDate: "2026-07-01",
      registrationEndDate: "2026-08-01",
      acquisitionPreset: "last_7_days",
      sort: "acquisition_desc",
      limit: 50,
      cursor: "abc",
    });
  });

  it("omits an absent period entirely rather than sending an empty value", () => {
    const query = leadListQueryFrom(DEFAULT_LEAD_STATE);
    expect(query).toEqual({ sort: "registration_desc", limit: LEADS_DEFAULT_PAGE_SIZE });
  });

  it("never sends dates beside a named preset", () => {
    const query = leadListQueryFrom({
      ...DEFAULT_LEAD_STATE,
      registration: { preset: "today", startDate: "2026-07-01", endDate: "2026-08-01" },
    });
    expect(query).not.toHaveProperty("registrationStartDate");
    expect(query).not.toHaveProperty("registrationEndDate");
  });
});

describe("predicates", () => {
  it("reports a filtered state for every narrowing dimension", () => {
    expect(isLeadsFiltered(DEFAULT_LEAD_STATE)).toBe(false);
    expect(isLeadsFiltered(parseLeadsUrlState("?depositState=conflict"))).toBe(true);
    expect(isLeadsFiltered(parseLeadsUrlState("?registrationPreset=today"))).toBe(true);
    expect(isLeadsFiltered(parseLeadsUrlState("?affiliatePartnerId=1"))).toBe(true);
    // A sort or a page size narrows nothing.
    expect(isLeadsFiltered(parseLeadsUrlState("?sort=acquisition_asc&pageSize=50"))).toBe(false);
  });

  it("separates dimension filters from state filters", () => {
    expect(hasDimensionFilter(parseLeadsUrlState("?depositState=conflict"))).toBe(false);
    expect(hasDimensionFilter(parseLeadsUrlState("?affiliateTrackingLinkId=100"))).toBe(true);
  });
});

describe("isValidDateOnly", () => {
  it("accepts a real date and rejects an impossible one", () => {
    expect(isValidDateOnly("2026-07-01")).toBe(true);
    expect(isValidDateOnly("2024-02-29")).toBe(true);
    expect(isValidDateOnly("2026-02-31")).toBe(false);
    expect(isValidDateOnly("2026-13-01")).toBe(false);
    expect(isValidDateOnly("2026-7-1")).toBe(false);
    expect(isValidDateOnly("")).toBe(false);
  });
});
