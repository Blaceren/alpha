/**
 * AFD-5C2 — the lead wire contracts.
 *
 * These are the privacy tests. The schemas are the CRM's own refusal to render
 * something the backend should never have sent, so the cases that matter most
 * are the ones where a plausible-looking response carries one extra field.
 */
import { describe, expect, it } from "vitest";
import {
  isWellFormedLeadId,
  leadAcquisitionSummarySchema,
  leadDataAvailabilitySchema,
  leadDetailResponseSchema,
  leadListRowSchema,
  leadListSchema,
  leadRevealResponseSchema,
  leadTimelineItemSchema,
  redactedLeadIdentitySchema,
  revealedLeadIdentitySchema,
} from "./affiliate-leads";

/* ---------------------------------------------------------------- fixtures */

const ROW = {
  leadId: "v1_abcdefghijklmnopqrstuvwxyz234567",
  maskedEmail: "n***@e***.invalid",
  displayName: null,
  piiState: "redacted",
  academyRegisteredAt: "2026-07-01T10:00:00.000Z",
  selectedAcquisitionAt: "2026-06-30T09:00:00.000Z",
  pocketRegisteredAt: "2026-07-02T11:00:00.000Z",
  firstDepositAt: "2026-07-03T12:00:00.000Z",
  journeyStage: "first_deposit_confirmed",
  depositState: "confirmed",
  attributionState: "attributed",
  affiliate: { id: "1", code: "alpha", displayName: "Affiliate Alpha" },
  campaign: { id: "10", code: "a-one", displayName: "Campaign Alpha One" },
  trackingLink: { id: "100", code: "lnk-a1", displayName: "Link Alpha One" },
  integrityFlags: [],
  canRevealPii: false,
} as const;

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
  acquisition: { available: true },
  academyRegistration: { available: true },
  pocketRegistration: { available: true },
  firstDeposit: { state: "available" },
  redeposit: { available: false, reason: "provider_transaction_identifier_missing" },
  currentBalance: { available: false, reason: "prohibited_not_collected" },
  educationTimeline: {
    available: false,
    reason: "authoritative_product_event_catalog_not_implemented",
  },
  trafficSubParameters: {
    available: false,
    reason: "sensitive_acquisition_metadata_not_exposed",
  },
} as const;

const TIMELINE_ITEM = {
  eventType: "academy_registration",
  occurredAt: "2026-07-01T10:00:00.000Z",
  localOccurredAt: "2026-07-01 13:00:00",
  titleKey: "crm.leads.timeline.academy_registration",
  state: "recorded",
  sourceCategory: "academy",
  roles: null,
  dimension: null,
  integrityFlags: [],
} as const;

const DETAIL = {
  lead: {
    leadId: ROW.leadId,
    maskedEmail: ROW.maskedEmail,
    displayName: null,
    piiState: "redacted",
    acquisition: {
      attributionState: "attributed",
      affiliate: ROW.affiliate,
      campaign: ROW.campaign,
      trackingLink: ROW.trackingLink,
      firstTouchAt: "2026-06-29T08:00:00.000Z",
      lastTouchAt: "2026-06-30T09:00:00.000Z",
      selectedTouchAt: "2026-06-30T09:00:00.000Z",
      acquisitionModel: "last_click",
      selectionReason: "last_qualified_click",
      frozenAt: "2026-07-01T10:00:00.000Z",
    },
    journey: {
      journeyStage: "first_deposit_confirmed",
      academyRegisteredAt: "2026-07-01T10:00:00.000Z",
      pocketRegisteredAt: "2026-07-02T11:00:00.000Z",
      firstDepositConfirmedAt: "2026-07-03T12:00:00.000Z",
    },
    deposit: {
      depositState: "confirmed",
      firstReceivedAt: "2026-07-03T12:00:00.000Z",
      confirmedAt: "2026-07-03T12:00:00.000Z",
      conflictDetectedAt: null,
      amountAvailability: { available: true },
      providerAmount: "50.00",
      currencyCode: "USD",
      currencyStatus: "configured",
      conflictCategory: null,
      replayObserved: false,
    },
    timeline: { items: [TIMELINE_ITEM], truncated: false, maxItems: 50, integrityFlags: [] },
    integrityFlags: [],
    canRevealPii: true,
  },
  dataAvailability: AVAILABILITY,
  generatedAt: "2026-08-02T10:00:00.000Z",
} as const;

/* ----------------------------------------------------------------- the list */

describe("leadListRowSchema", () => {
  it("accepts a complete redacted row", () => {
    expect(leadListRowSchema.safeParse(ROW).success).toBe(true);
  });

  it("REFUSES a row carrying a full email", () => {
    const leaked = { ...ROW, email: "nina@example.invalid" };
    expect(leadListRowSchema.safeParse(leaked).success).toBe(false);
  });

  it.each([
    ["userId", 34],
    ["pocketPlayerId", "99887766"],
    ["pocketClickId", "cl_abc"],
    ["ataClickId", "ata_abc"],
    ["anonymousVisitorId", "vis_abc"],
    ["ipAddress", "203.0.113.4"],
    ["userAgent", "Mozilla/5.0"],
    ["currentBalance", "120.00"],
    ["sub1", "campaign-x"],
  ])("REFUSES a row carrying %s", (key, value) => {
    expect(leadListRowSchema.safeParse({ ...ROW, [key]: value }).success).toBe(false);
  });

  it("REFUSES a row whose displayName is a real name", () => {
    // The backend drops the name entirely rather than masking it; a string here
    // means something changed upstream and must not be rendered.
    expect(leadListRowSchema.safeParse({ ...ROW, displayName: "Нина" }).success).toBe(false);
  });

  it("REFUSES a row claiming to be revealed", () => {
    expect(leadListRowSchema.safeParse({ ...ROW, piiState: "revealed" }).success).toBe(false);
  });

  it("REFUSES a row carrying a timeline array", () => {
    // A list carrying full histories is the shape in which a page quietly
    // becomes a bulk export.
    const withTimeline = { ...ROW, timeline: { items: [], truncated: false, maxItems: 50 } };
    expect(leadListRowSchema.safeParse(withTimeline).success).toBe(false);
  });

  it("accepts a direct row with every dimension null", () => {
    const direct = {
      ...ROW,
      attributionState: "unattributed",
      affiliate: null,
      campaign: null,
      trackingLink: null,
      selectedAcquisitionAt: null,
    };
    expect(leadListRowSchema.safeParse(direct).success).toBe(true);
  });

  it("refuses an unknown integrity flag rather than rendering a raw token", () => {
    expect(
      leadListRowSchema.safeParse({ ...ROW, integrityFlags: ["something_new"] }).success,
    ).toBe(false);
  });
});

describe("leadListSchema", () => {
  const LIST = {
    filters: {
      affiliatePartnerId: null,
      affiliateCampaignId: null,
      affiliateTrackingLinkId: null,
      attributionState: null,
      journeyStage: null,
      depositState: null,
    },
    periods: { registration: null, acquisition: null },
    sort: "registration_desc",
    supportedSorts: ["registration_desc", "registration_asc"],
    pageSize: 25,
    defaultPageSize: 25,
    maxPageSize: 100,
    hasMore: true,
    nextCursor: "eyJ2IjoxfQ",
    rows: [ROW],
    generatedAt: "2026-08-02T10:00:00.000Z",
  } as const;

  it("accepts a complete page", () => {
    expect(leadListSchema.safeParse(LIST).success).toBe(true);
  });

  it("accepts both resolved periods side by side", () => {
    const both = { ...LIST, periods: { registration: PERIOD, acquisition: PERIOD } };
    expect(leadListSchema.safeParse(both).success).toBe(true);
  });

  it("refuses a period that is not Monday-week, half-open", () => {
    const wrong = {
      ...LIST,
      periods: {
        registration: { ...PERIOD, weekStart: "sunday" },
        acquisition: null,
      },
    };
    expect(leadListSchema.safeParse(wrong).success).toBe(false);
  });

  it("accepts a null cursor on the last page", () => {
    expect(leadListSchema.safeParse({ ...LIST, hasMore: false, nextCursor: null }).success).toBe(
      true,
    );
  });

  it("refuses an unexpected top-level field", () => {
    expect(leadListSchema.safeParse({ ...LIST, totalCount: 400 }).success).toBe(false);
  });
});

/* --------------------------------------------------------------- identity */

describe("identity schemas", () => {
  it("keeps redacted and revealed as separate shapes", () => {
    const redacted = {
      leadId: ROW.leadId,
      maskedEmail: ROW.maskedEmail,
      displayName: null,
      piiState: "redacted",
    };
    const revealed = {
      leadId: ROW.leadId,
      email: "nina@example.invalid",
      displayName: "Нина",
      piiState: "revealed",
    };

    expect(redactedLeadIdentitySchema.safeParse(redacted).success).toBe(true);
    expect(revealedLeadIdentitySchema.safeParse(revealed).success).toBe(true);
    // Neither widens into the other.
    expect(revealedLeadIdentitySchema.safeParse(redacted).success).toBe(false);
    expect(redactedLeadIdentitySchema.safeParse(revealed).success).toBe(false);
  });

  it("REFUSES a reveal carrying anything beyond email and name", () => {
    const base = {
      leadId: ROW.leadId,
      email: "nina@example.invalid",
      displayName: "Нина",
      piiState: "revealed",
    };
    for (const extra of [
      { phone: "+70000000000" },
      { ipAddress: "203.0.113.4" },
      { userAgent: "Mozilla/5.0" },
      { pocketPlayerId: "998877" },
      { userId: 34 },
      { currentBalance: "120.00" },
      { passwordHash: "x" },
    ]) {
      expect(revealedLeadIdentitySchema.safeParse({ ...base, ...extra }).success).toBe(false);
    }
  });

  it("accepts a reveal whose display name is absent", () => {
    const parsed = leadRevealResponseSchema.safeParse({
      identity: {
        leadId: ROW.leadId,
        email: "nina@example.invalid",
        displayName: null,
        piiState: "revealed",
      },
      revealedAt: "2026-08-02T10:00:00.000Z",
    });
    expect(parsed.success).toBe(true);
  });
});

/* ------------------------------------------------------------ acquisition */

describe("leadAcquisitionSummarySchema", () => {
  it("accepts an attributed lead", () => {
    expect(leadAcquisitionSummarySchema.safeParse(DETAIL.lead.acquisition).success).toBe(true);
  });

  it("accepts a direct lead with everything null", () => {
    const direct = {
      attributionState: "unattributed",
      affiliate: null,
      campaign: null,
      trackingLink: null,
      firstTouchAt: null,
      lastTouchAt: null,
      selectedTouchAt: null,
      acquisitionModel: null,
      selectionReason: null,
      frozenAt: null,
    };
    expect(leadAcquisitionSummarySchema.safeParse(direct).success).toBe(true);
  });

  it("makes a direct lead with an affiliate UNREPRESENTABLE", () => {
    const synthetic = {
      attributionState: "unattributed",
      affiliate: { id: "0", code: "direct", displayName: "(прямые)" },
      campaign: null,
      trackingLink: null,
      firstTouchAt: null,
      lastTouchAt: null,
      selectedTouchAt: null,
      acquisitionModel: null,
      selectionReason: null,
      frozenAt: null,
    };
    expect(leadAcquisitionSummarySchema.safeParse(synthetic).success).toBe(false);
  });

  it("refuses a raw click identifier on the acquisition summary", () => {
    const leaked = { ...DETAIL.lead.acquisition, selectedClickId: "cl_abc", sub1: "x" };
    expect(leadAcquisitionSummarySchema.safeParse(leaked).success).toBe(false);
  });
});

/* --------------------------------------------------------------- timeline */

describe("leadTimelineItemSchema", () => {
  it("accepts a factual item", () => {
    expect(leadTimelineItemSchema.safeParse(TIMELINE_ITEM).success).toBe(true);
  });

  it("accepts one item carrying several touch roles", () => {
    const merged = {
      ...TIMELINE_ITEM,
      eventType: "acquisition_selected",
      sourceCategory: "acquisition",
      roles: ["first_touch", "last_touch", "selected"],
      dimension: { trackingLinkPublicCode: "lnk-a1", displayName: "Link Alpha One" },
    };
    expect(leadTimelineItemSchema.safeParse(merged).success).toBe(true);
  });

  it("refuses a dimension carrying a click identifier", () => {
    const leaked = {
      ...TIMELINE_ITEM,
      dimension: {
        trackingLinkPublicCode: "lnk-a1",
        displayName: "Link Alpha One",
        clickId: "cl_abc",
      },
    };
    expect(leadTimelineItemSchema.safeParse(leaked).success).toBe(false);
  });

  it("refuses an event type outside the catalog", () => {
    expect(
      leadTimelineItemSchema.safeParse({ ...TIMELINE_ITEM, eventType: "lesson_completed" })
        .success,
    ).toBe(false);
  });
});

/* ---------------------------------------------------------- availability */

describe("leadDataAvailabilitySchema", () => {
  it("accepts the four first-deposit outcomes", () => {
    for (const firstDeposit of [
      { state: "available" },
      { state: "pending", reason: "provider_identity_not_yet_reconciled" },
      { state: "conflict", reason: "provider_delivery_disagreed" },
      { state: "absent", reason: "no_provider_deposit_event" },
    ]) {
      expect(leadDataAvailabilitySchema.safeParse({ ...AVAILABILITY, firstDeposit }).success).toBe(
        true,
      );
    }
  });

  it("makes an unavailable capability with a numeric value UNREPRESENTABLE", () => {
    const zeroed = {
      ...AVAILABILITY,
      redeposit: { available: false, reason: "provider_transaction_identifier_missing", count: 0 },
    };
    expect(leadDataAvailabilitySchema.safeParse(zeroed).success).toBe(false);
  });

  it("refuses an unavailable state with no reason", () => {
    const bare = { ...AVAILABILITY, currentBalance: { available: false } };
    expect(leadDataAvailabilitySchema.safeParse(bare).success).toBe(false);
  });
});

/* ------------------------------------------------------------ the detail */

describe("leadDetailResponseSchema", () => {
  it("accepts a complete redacted detail", () => {
    expect(leadDetailResponseSchema.safeParse(DETAIL).success).toBe(true);
  });

  it("REFUSES a detail carrying a full email even when canRevealPii is true", () => {
    const leaked = {
      ...DETAIL,
      lead: { ...DETAIL.lead, email: "nina@example.invalid" },
    };
    expect(leadDetailResponseSchema.safeParse(leaked).success).toBe(false);
  });

  it("REFUSES a detail carrying a current balance", () => {
    const leaked = {
      ...DETAIL,
      lead: { ...DETAIL.lead, currentBalance: "120.00" },
    };
    expect(leadDetailResponseSchema.safeParse(leaked).success).toBe(false);
  });

  it("keeps journey stage and deposit state independent", () => {
    // A counted deposit whose provider row was later quarantined: both are true
    // and the contract must allow the combination.
    const both = {
      ...DETAIL,
      lead: {
        ...DETAIL.lead,
        journey: { ...DETAIL.lead.journey, journeyStage: "first_deposit_confirmed" },
        deposit: {
          ...DETAIL.lead.deposit,
          depositState: "conflict",
          conflictDetectedAt: "2026-07-04T12:00:00.000Z",
          conflictCategory: "amount_mismatch",
        },
      },
    };
    expect(leadDetailResponseSchema.safeParse(both).success).toBe(true);
  });
});

/* ------------------------------------------------------------- lead ids */

describe("isWellFormedLeadId", () => {
  it("accepts the v1 base32 reference", () => {
    expect(isWellFormedLeadId("v1_abcdefghijklmnopqrstuvwxyz234567")).toBe(true);
  });

  it("rejects a different version, a short body and a numeric id", () => {
    expect(isWellFormedLeadId("v2_abcdefghijklmnopqrstuvwxyz234567")).toBe(false);
    expect(isWellFormedLeadId("v1_short")).toBe(false);
    expect(isWellFormedLeadId("34")).toBe(false);
    expect(isWellFormedLeadId("")).toBe(false);
    // Base32 excludes 0, 1, 8 and 9.
    expect(isWellFormedLeadId("v1_0000000000000000000000000000000a")).toBe(false);
  });
});
