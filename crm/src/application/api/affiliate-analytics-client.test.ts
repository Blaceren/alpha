/**
 * AFD-5C1 — the analytics client's request and outcome contract.
 *
 * The security assertions here are the ones §39 and §24 ask for, and they are
 * written against the ACTUAL request the client builds rather than against a
 * comment: GET only, no Authorization header, no Basic-Auth credential, no
 * cookie header constructed by hand, no lead path, and no generic proxy.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_ENDPOINTS,
  buildQuery,
  fetchAnalyticsFilters,
  fetchCohortBreakdown,
  fetchCohortSummary,
  fetchCohortTimeseries,
  fetchEventDateBreakdown,
  fetchEventDateSummary,
  fetchEventDateTimeseries,
} from "./affiliate-analytics-client";

const OK_FILTERS = {
  affiliatePartners: [],
  affiliateCampaigns: [],
  affiliateTrackingLinks: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/* ------------------------------------------------------------------ paths */

describe("endpoints", () => {
  it("names exactly seven analytics paths", () => {
    expect(ANALYTICS_ENDPOINTS).toHaveLength(7);
  });

  it("targets only the reviewed analytics namespace", () => {
    for (const endpoint of ANALYTICS_ENDPOINTS) {
      expect(endpoint.startsWith("/api/crm/v1/affiliates/analytics")).toBe(true);
    }
  });

  it("contains no lead, reveal or timeline path", () => {
    // AFD-5C1 implements no lead surface. The client cannot reach one.
    for (const endpoint of ANALYTICS_ENDPOINTS) {
      expect(endpoint).not.toContain("/leads");
      expect(endpoint).not.toContain("/reveal");
      expect(endpoint).not.toContain("/timeline");
    }
  });

  it("uses relative paths only, so the backend origin never reaches the browser", () => {
    for (const endpoint of ANALYTICS_ENDPOINTS) {
      expect(endpoint.startsWith("/")).toBe(true);
      expect(endpoint).not.toContain("http://");
      expect(endpoint).not.toContain("https://");
    }
  });
});

/* ------------------------------------------------------------ query building */

describe("buildQuery", () => {
  it("omits undefined values rather than sending empty parameters", () => {
    expect(buildQuery({ preset: "today", affiliatePartnerId: undefined })).toBe("?preset=today");
  });

  it("returns an empty string for an empty query", () => {
    expect(buildQuery({})).toBe("");
  });

  it("is deterministic regardless of object key order", () => {
    const a = buildQuery({ group: "week", preset: "today", dimension: "campaign" });
    const b = buildQuery({ dimension: "campaign", preset: "today", group: "week" });
    expect(a).toBe(b);
  });

  it("serializes booleans and numbers as strings", () => {
    expect(buildQuery({ includeZeroActivity: true, limit: 25, offset: 50 })).toBe(
      "?includeZeroActivity=true&limit=25&offset=50",
    );
  });
});

/* ---------------------------------------------------------------- transport */

describe("transport", () => {
  it("issues a GET with no body", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OK_FILTERS));
    await fetchAnalyticsFilters({}, { fetchImpl: fetchImpl as unknown as typeof fetch });

    const [, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("sends no Authorization header and no hand-built credential", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OK_FILTERS));
    await fetchAnalyticsFilters({}, { fetchImpl: fetchImpl as unknown as typeof fetch });

    const [, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    // Authentication is the existing host-only session cookie, forwarded by the
    // browser. Nothing here constructs a token or a Basic-Auth value.
    expect(init.headers).toBeUndefined();
    expect(JSON.stringify(init)).not.toMatch(/authorization|basic |bearer /i);
    expect(init.credentials).toBe("same-origin");
  });

  it("never caches a response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OK_FILTERS));
    await fetchAnalyticsFilters({}, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const [, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(init.cache).toBe("no-store");
  });

  it("forwards an abort signal", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(OK_FILTERS));
    await fetchAnalyticsFilters({}, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const [, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a caller-cancelled request as cancelled, not as a failure", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    const outcome = await fetchAnalyticsFilters(
      {},
      { fetchImpl: fetchImpl as unknown as typeof fetch, signal: controller.signal },
    );
    // A superseded request must not flash an error the operator did not cause.
    expect(outcome.status).toBe("cancelled");
  });

  it("reports a network failure as upstream_unavailable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network");
    });
    const outcome = await fetchAnalyticsFilters(
      {},
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(outcome.status).toBe("upstream_unavailable");
  });

  it("reports a timeout as upstream_unavailable when the caller did not cancel", async () => {
    const fetchImpl = vi.fn(
      (_path: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const outcome = await fetchAnalyticsFilters(
      {},
      { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 5 },
    );
    expect(outcome.status).toBe("upstream_unavailable");
  });
});

/* ------------------------------------------------------------------ outcomes */

describe("status mapping", () => {
  const cases: [number, string, string][] = [
    [400, "crm.analytics.preset_invalid", "invalid_input"],
    [401, "crm.session.unauthenticated", "unauthenticated"],
    [403, "crm.affiliates.forbidden", "forbidden"],
    [404, "crm.analytics.partner_not_found", "not_found"],
    [429, "x", "rate_limited"],
    [502, "x", "upstream_unavailable"],
  ];

  for (const [status, messageKey, expected] of cases) {
    it(`maps ${status} to ${expected}`, async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse({ code: "e", messageKey, requestId: "req_1" }, status),
      );
      const outcome = await fetchEventDateSummary(
        { preset: "today" },
        { fetchImpl: fetchImpl as unknown as typeof fetch },
      );
      expect(outcome.status).toBe(expected);
    });
  }

  it("lifts the bucket cap out of the generic 400 so the UI can offer a fix", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { code: "invalid_period", messageKey: "crm.analytics.bucket_cap_exceeded" },
        400,
      ),
    );
    const outcome = await fetchEventDateTimeseries(
      { preset: "all_time", group: "day" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(outcome.status).toBe("bucket_cap_exceeded");
  });

  it("maps a timezone misconfiguration to its own outcome", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { code: "analytics_misconfigured", messageKey: "crm.analytics.timezone_invalid" },
        500,
      ),
    );
    const outcome = await fetchEventDateSummary(
      { preset: "today" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(outcome.status).toBe("misconfigured");
  });

  it("refuses a response that fails the strict contract", async () => {
    // An unexpected field is a semantic change, not a cosmetic one: the page
    // must not render half of a payload it does not understand.
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ...OK_FILTERS, learnerEmail: "someone@example.invalid" }),
    );
    const outcome = await fetchAnalyticsFilters(
      {},
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(outcome.status).toBe("malformed_response");
  });

  it("refuses a body that is not JSON", async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => {
            throw new Error("not json");
          },
        }) as unknown as Response,
    );
    const outcome = await fetchAnalyticsFilters(
      {},
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(outcome.status).toBe("malformed_response");
  });
});

/* -------------------------------------------------------- endpoint targeting */

describe("each callable targets exactly its own endpoint", () => {
  const calls: [string, (f: typeof fetch) => Promise<unknown>][] = [
    ["/filters", (f) => fetchAnalyticsFilters({}, { fetchImpl: f })],
    ["/summary", (f) => fetchEventDateSummary({ preset: "today" }, { fetchImpl: f })],
    ["/timeseries", (f) => fetchEventDateTimeseries({ preset: "today" }, { fetchImpl: f })],
    ["/breakdown", (f) => fetchEventDateBreakdown({ preset: "today" }, { fetchImpl: f })],
    ["/cohorts/summary", (f) => fetchCohortSummary({ preset: "today" }, { fetchImpl: f })],
    ["/cohorts/timeseries", (f) => fetchCohortTimeseries({ preset: "today" }, { fetchImpl: f })],
    ["/cohorts/breakdown", (f) => fetchCohortBreakdown({ preset: "today" }, { fetchImpl: f })],
  ];

  for (const [suffix, call] of calls) {
    it(`requests ${suffix}`, async () => {
      const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
      await call(fetchImpl as unknown as typeof fetch);
      const [url] = fetchImpl.mock.calls[0]! as unknown as [string];
      expect(url.startsWith(`/api/crm/v1/affiliates/analytics${suffix}`)).toBe(true);
    });
  }
});
