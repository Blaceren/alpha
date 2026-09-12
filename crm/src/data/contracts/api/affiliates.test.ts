import { describe, expect, it } from "vitest";
import {
  affiliateCampaignSchema,
  affiliatePartnerSchema,
  affiliateTrackingLinkSchema,
} from "./affiliates";

/**
 * AFD-5A — the contract tests that make "no traffic analytics" a mechanism
 * rather than a promise.
 */

const partner = {
  id: "1",
  code: "alpha",
  displayName: "Affiliate Alpha",
  description: null,
  status: "active",
  availability: "available",
  defaultAttributionWindowDays: 30,
  inventory: { campaigns: 2, trackingLinks: 3, activeTrackingLinks: 1 },
  createdBy: { employeeId: "emp_1", displayName: "Staff crm_admin" },
  createdAt: "2026-07-31T10:00:00.000Z",
  updatedAt: "2026-07-31T10:00:00.000Z",
  archivedAt: null,
};

const link = {
  id: "7",
  affiliatePartnerId: "1",
  affiliatePartnerCode: "alpha",
  affiliateCampaignId: null,
  affiliateCampaignCode: null,
  publicCode: "abcdefghijklmnopqrstuvwxyz234567",
  displayName: "Link Alpha One",
  status: "draft",
  availability: "paused",
  landingKey: "academy_registration",
  externalClickParameter: "clickid",
  subParameters: { sub1: "utm_source", sub2: null, sub3: null, sub4: null, sub5: null },
  attributionWindowDays: null,
  effectiveAttributionWindowDays: 30,
  publicRouteState: "not_active",
  activationState: "blocked",
  publicPath: "/go/abcdefghijklmnopqrstuvwxyz234567",
  publicUrl: null,
  publicUrlUnavailableReason: "public_origin_unavailable",
  createdBy: null,
  createdAt: "2026-07-31T10:00:00.000Z",
  updatedAt: "2026-07-31T10:00:00.000Z",
  archivedAt: null,
};

describe("affiliate partner contract", () => {
  it("accepts a canonical partner", () => {
    expect(affiliatePartnerSchema.safeParse(partner).success).toBe(true);
  });

  it("rejects an unknown field, so a new backend column cannot leak in", () => {
    for (const extra of [
      { clicks: 0 },
      { uniqueVisitors: 0 },
      { registrations: 0 },
      { firstDeposits: 0 },
      { firstDepositAmount: "0.00" },
      { conversionRate: 0 },
      { revenue: 0 },
      { currentBalance: 0 },
      { redeposits: 0 },
      { createdByUserId: 3 },
      { email: "a@b.test" },
    ]) {
      const result = affiliatePartnerSchema.safeParse({ ...partner, ...extra });
      expect(result.success, `expected ${JSON.stringify(extra)} to be rejected`).toBe(false);
    }
  });

  it("requires the inventory counts and rejects a traffic count smuggled into them", () => {
    expect(affiliatePartnerSchema.safeParse({ ...partner, inventory: undefined }).success).toBe(false);
    expect(
      affiliatePartnerSchema.safeParse({
        ...partner,
        inventory: { ...partner.inventory, clicks: 5 },
      }).success,
    ).toBe(false);
  });

  it("keeps createdBy to an opaque id plus a display label", () => {
    expect(
      affiliatePartnerSchema.safeParse({
        ...partner,
        createdBy: { employeeId: "emp_1", displayName: "X", email: "a@b.test" },
      }).success,
    ).toBe(false);
    expect(affiliatePartnerSchema.safeParse({ ...partner, createdBy: null }).success).toBe(true);
  });
});

describe("affiliate campaign contract", () => {
  const campaign = {
    id: "2",
    affiliatePartnerId: "1",
    affiliatePartnerCode: "alpha",
    code: "alpha-one",
    displayName: "Campaign Alpha One",
    notes: null,
    status: "active",
    availability: "available",
    inventory: { trackingLinks: 1, activeTrackingLinks: 0 },
    createdBy: null,
    createdAt: "2026-07-31T10:00:00.000Z",
    updatedAt: "2026-07-31T10:00:00.000Z",
    archivedAt: null,
  };

  it("accepts a canonical campaign", () => {
    expect(affiliateCampaignSchema.safeParse(campaign).success).toBe(true);
  });

  it("has no campaigns count of its own", () => {
    expect(
      affiliateCampaignSchema.safeParse({
        ...campaign,
        inventory: { ...campaign.inventory, campaigns: 0 },
      }).success,
    ).toBe(false);
  });
});

describe("affiliate tracking link contract", () => {
  it("accepts a link with no canonical URL and an explicit reason", () => {
    expect(affiliateTrackingLinkSchema.safeParse(link).success).toBe(true);
  });

  it("accepts a link whose canonical URL the backend resolved", () => {
    const result = affiliateTrackingLinkSchema.safeParse({
      ...link,
      publicUrl: "https://affiliate-test.example/go/abcdefghijklmnopqrstuvwxyz234567",
      publicUrlUnavailableReason: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a publicPath that is not exactly /go/{publicCode}", () => {
    for (const publicPath of [
      "/go/short",
      "https://evil.example/go/abcdefghijklmnopqrstuvwxyz234567",
      "/redirect/abcdefghijklmnopqrstuvwxyz234567",
      "/go/ABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
      "/go/abcdefghijklmnopqrstuvwxyz234567?clickid=1",
    ]) {
      expect(
        affiliateTrackingLinkSchema.safeParse({ ...link, publicPath }).success,
        publicPath,
      ).toBe(false);
    }
  });

  it("rejects any arbitrary destination or secret field", () => {
    for (const extra of [
      { url: "https://evil.example" },
      { destination: "https://evil.example" },
      { redirectUrl: "https://evil.example" },
      { targetUrl: "https://evil.example" },
      { pocketUrl: "https://po.cash/x" },
      { callbackUrl: "https://x/callback" },
      { postbackSecret: "s" },
      { attributionToken: "t" },
      { ataClickId: "c" },
      { anonymousVisitorId: "v" },
      { externalAffiliateClickId: "e" },
      { pocketPlayerId: "p" },
      { clicks: 0 },
      { currentBalance: 0 },
    ]) {
      expect(
        affiliateTrackingLinkSchema.safeParse({ ...link, ...extra }).success,
        `expected ${JSON.stringify(extra)} to be rejected`,
      ).toBe(false);
    }
  });

  it("pins landingKey to the single supported literal", () => {
    expect(
      affiliateTrackingLinkSchema.safeParse({ ...link, landingKey: "https://evil.example" }).success,
    ).toBe(false);
    expect(affiliateTrackingLinkSchema.safeParse({ ...link, landingKey: "other" }).success).toBe(
      false,
    );
  });
});
