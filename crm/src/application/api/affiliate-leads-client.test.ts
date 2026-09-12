/**
 * AFD-5C2 — the lead API client.
 *
 * The properties under test are the ones that make the reveal safe: it is POST,
 * it is tokened, it refuses to proceed untokened, it carries no body, and it
 * targets exactly one lead named in the path. Plus the ordinary orchestration
 * contract — cancellation, strict parsing, and an exhaustive status mapping.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLeadQuery,
  fetchLeadDetail,
  fetchLeadList,
  LEAD_ENDPOINT_SHAPES,
  LEAD_LIST_ENDPOINT,
  leadDetailEndpoint,
  leadRevealEndpoint,
  revealLeadPii,
} from "./affiliate-leads-client";

/* -------------------------------------------------------------- CSRF double */

const csrfHeadersMock = vi.fn();

vi.mock("@/application/api/auth-client", () => ({
  csrfHeaders: (...args: unknown[]) => csrfHeadersMock(...args),
}));

/* ---------------------------------------------------------------- fixtures */

const LEAD_ID = "v1_abcdefghijklmnopqrstuvwxyz234567";

const ROW = {
  leadId: LEAD_ID,
  maskedEmail: "n***@e***.invalid",
  displayName: null,
  piiState: "redacted",
  academyRegisteredAt: "2026-07-01T10:00:00.000Z",
  selectedAcquisitionAt: null,
  pocketRegisteredAt: null,
  firstDepositAt: null,
  journeyStage: "academy_registered",
  depositState: "none",
  attributionState: "unattributed",
  affiliate: null,
  campaign: null,
  trackingLink: null,
  integrityFlags: [],
  canRevealPii: false,
};

const LIST_BODY = {
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
  supportedSorts: ["registration_desc"],
  pageSize: 25,
  defaultPageSize: 25,
  maxPageSize: 100,
  hasMore: false,
  nextCursor: null,
  rows: [ROW],
  generatedAt: "2026-08-02T10:00:00.000Z",
};

const REVEAL_BODY = {
  identity: {
    leadId: LEAD_ID,
    email: "nina@example.invalid",
    displayName: "Нина",
    piiState: "revealed",
  },
  revealedAt: "2026-08-02T10:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  csrfHeadersMock.mockReset().mockResolvedValue({ "x-csrf-token": "tok_1" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------- the surface */

describe("the endpoint surface", () => {
  it("names exactly three path shapes", () => {
    expect(LEAD_ENDPOINT_SHAPES).toEqual([
      "/api/crm/v1/affiliates/leads",
      "/api/crm/v1/affiliates/leads/{leadId}",
      "/api/crm/v1/affiliates/leads/{leadId}/reveal",
    ]);
  });

  it("builds per-lead paths under the list path", () => {
    expect(leadDetailEndpoint(LEAD_ID)).toBe(`${LEAD_LIST_ENDPOINT}/${LEAD_ID}`);
    expect(leadRevealEndpoint(LEAD_ID)).toBe(`${LEAD_LIST_ENDPOINT}/${LEAD_ID}/reveal`);
  });

  it("escapes a reference that would otherwise traverse the path", () => {
    expect(leadDetailEndpoint("../../users/34")).toBe(
      `${LEAD_LIST_ENDPOINT}/..%2F..%2Fusers%2F34`,
    );
    expect(leadRevealEndpoint("a/b")).toBe(`${LEAD_LIST_ENDPOINT}/a%2Fb/reveal`);
  });
});

describe("buildLeadQuery", () => {
  it("emits a fixed key order so identical requests share a URL", () => {
    const a = buildLeadQuery({ sort: "registration_desc", affiliatePartnerId: "1", limit: 25 });
    const b = buildLeadQuery({ limit: 25, affiliatePartnerId: "1", sort: "registration_desc" });
    expect(a).toBe(b);
    expect(a).toBe("?affiliatePartnerId=1&sort=registration_desc&limit=25");
  });

  it("omits an unset filter entirely rather than sending an empty value", () => {
    expect(buildLeadQuery({})).toBe("");
    expect(buildLeadQuery({ attributionState: undefined })).toBe("");
  });

  it("carries both periods independently", () => {
    const query = buildLeadQuery({
      registrationPreset: "custom",
      registrationStartDate: "2026-07-01",
      registrationEndDate: "2026-08-01",
      acquisitionPreset: "last_7_days",
    });
    expect(query).toBe(
      "?registrationPreset=custom&registrationStartDate=2026-07-01" +
        "&registrationEndDate=2026-08-01&acquisitionPreset=last_7_days",
    );
  });
});

/* ---------------------------------------------------------------- the list */

describe("fetchLeadList", () => {
  it("issues a GET with no body and no CSRF header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(LIST_BODY));
    const outcome = await fetchLeadList({ sort: "registration_desc" }, { fetchImpl });

    expect(outcome.status).toBe("success");
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${LEAD_LIST_ENDPOINT}?sort=registration_desc`);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
    expect(csrfHeadersMock).not.toHaveBeenCalled();
  });

  it("never constructs an Authorization header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(LIST_BODY));
    await fetchLeadList({}, { fetchImpl });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.stringify(init.headers ?? {})).not.toMatch(/authorization/i);
  });

  it("rejects a response carrying a full email rather than rendering it", async () => {
    const leaked = { ...LIST_BODY, rows: [{ ...ROW, email: "nina@example.invalid" }] };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(leaked));
    const outcome = await fetchLeadList({}, { fetchImpl });
    expect(outcome.status).toBe("malformed_response");
  });

  it("maps a rejected cursor to its own recoverable outcome", async () => {
    for (const messageKey of ["crm.leads.cursor_invalid", "crm.leads.cursor_filter_mismatch"]) {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ code: "invalid_input", messageKey, requestId: "req_1" }, 400),
        );
      const outcome = await fetchLeadList({ cursor: "bad" }, { fetchImpl });
      expect(outcome.status).toBe("cursor_invalid");
    }
  });

  it("maps other 400s to invalid_input", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ code: "invalid_input", messageKey: "crm.leads.sort_invalid" }, 400),
      );
    expect((await fetchLeadList({}, { fetchImpl })).status).toBe("invalid_input");
  });

  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "not_found"],
    [429, "rate_limited"],
    [502, "upstream_unavailable"],
  ])("maps HTTP %s", async (status, expected) => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ code: "x", messageKey: "crm.leads.x" }, status));
    expect((await fetchLeadList({}, { fetchImpl })).status).toBe(expected);
  });

  it("reports a caller-cancelled request as cancelled, not as a failure", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn().mockRejectedValue(new Error("aborted"));
    const outcome = await fetchLeadList({}, { fetchImpl, signal: controller.signal });
    expect(outcome.status).toBe("cancelled");
  });

  it("reports a transport failure as upstream_unavailable", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network"));
    expect((await fetchLeadList({}, { fetchImpl })).status).toBe("upstream_unavailable");
  });

  it("reports an unparseable body as malformed rather than empty success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    } as unknown as Response);
    expect((await fetchLeadList({}, { fetchImpl })).status).toBe("malformed_response");
  });
});

/* -------------------------------------------------------------- the detail */

describe("fetchLeadDetail", () => {
  it("issues a GET with no query string at all", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    await fetchLeadDetail(LEAD_ID, { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(leadDetailEndpoint(LEAD_ID));
    expect(url).not.toContain("?");
    expect(init.method).toBe("GET");
    expect(csrfHeadersMock).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------- the reveal */

describe("revealLeadPii", () => {
  it("is a POST to exactly one lead, with the canonical CSRF header and no body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(REVEAL_BODY));
    const outcome = await revealLeadPii(LEAD_ID, { fetchImpl });

    expect(outcome.status).toBe("success");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${LEAD_LIST_ENDPOINT}/${LEAD_ID}/reveal`);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["x-csrf-token"]).toBe("tok_1");
    expect(init.cache).toBe("no-store");
    expect(init.credentials).toBe("same-origin");
  });

  it("never falls back to GET", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 405));
    await revealLeadPii(LEAD_ID, { fetchImpl });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
  });

  it("carries no identifier other than the one in the path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(REVEAL_BODY));
    await revealLeadPii(LEAD_ID, { fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    // No id array, no wildcard, no filter: there is no body to put one in.
    expect(init.body).toBeUndefined();
    expect(url.split("/").filter((part) => part.startsWith("v1_"))).toHaveLength(1);
  });

  it("ABANDONS the reveal locally when no CSRF token can be obtained", async () => {
    csrfHeadersMock.mockResolvedValue({});
    const fetchImpl = vi.fn();
    const outcome = await revealLeadPii(LEAD_ID, { fetchImpl });

    expect(outcome.status).toBe("csrf_unavailable");
    // The decisive assertion: nothing was sent at all.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps a permission refusal to forbidden", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { code: "forbidden", messageKey: "crm.leads.pii_forbidden", requestId: "req_2" },
          403,
        ),
      );
    const outcome = await revealLeadPii(LEAD_ID, { fetchImpl });
    expect(outcome).toMatchObject({
      status: "forbidden",
      messageKey: "crm.leads.pii_forbidden",
      requestId: "req_2",
    });
  });

  it("maps a CSRF refusal to forbidden with the backend's own key", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ code: "forbidden", messageKey: "crm.affiliates.csrf_invalid" }, 403),
      );
    const outcome = await revealLeadPii(LEAD_ID, { fetchImpl });
    expect(outcome).toMatchObject({
      status: "forbidden",
      messageKey: "crm.affiliates.csrf_invalid",
    });
  });

  it("refuses a reveal response carrying more than the two approved fields", async () => {
    const leaked = {
      ...REVEAL_BODY,
      identity: { ...REVEAL_BODY.identity, ipAddress: "203.0.113.4" },
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(leaked));
    expect((await revealLeadPii(LEAD_ID, { fetchImpl })).status).toBe("malformed_response");
  });

  it("does not retry after a failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: "x", messageKey: "y" }, 500));
    await revealLeadPii(LEAD_ID, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
